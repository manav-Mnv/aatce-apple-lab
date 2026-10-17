import Foundation
import KioskCore
import KioskNetworking

/// The kiosk's scan flow (FR-7 to FR-11, NFR-2):
///
///   idle → identifying (frontal frames, last 3 averaged, up to 8 tries) → liveness (head turn)
///        → submitting → result → idle
///                       └→ unrecognized (offer enrollment or manual entry)
///
/// The face model runs off the main thread and frames arriving meanwhile are skipped,
/// so the screen never stalls. Scans that cannot reach the backend go to the durable
/// ScanQueue and are replayed with their original time. Every attempt is reported to
/// the admin portal with the next heartbeat.
@MainActor
final class KioskModel: ObservableObject {
    enum Route: Equatable { case scan, manualEntry, enrollment }

    enum Phase: Equatable {
        case starting
        case needsSetup([String])
        case idle(FaceHint)
        case identifying
        case liveness(progress: Double)
        /// Recognised and live: shown instantly while the backend records the scan.
        case recognized(firstName: String?)
        case submitting
        case result(ScanResult)
        case unrecognized
    }

    enum FaceHint: Equatable { case searching, tooFar, offCenter, multiple, ready }

    struct ScanResult: Equatable {
        enum Kind: Equatable { case checkIn, checkOut, workshop, queued, notice, failure }
        let kind: Kind
        let title: String
        let detail: String
    }

    struct Status: Equatable {
        var online: Bool?
        var queued = 0
        var faces = 0
        var embeddingsVersion = 0
        var problem: String?
    }

    @Published private(set) var phase: Phase = .starting
    @Published private(set) var status = Status()
    @Published var route: Route = .scan
    @Published private(set) var enrollment: EnrollmentModel?

    let camera = CameraService()
    private(set) var settings = KioskSettings.load()
    private(set) var embedder: FaceEmbedder?
    private var store: EmbeddingStore?
    private let queue = ScanQueue(fileURL: KioskPaths.directory.appendingPathComponent("scan-queue.json"))
    private var matcher = FaceMatcher(templates: [:])
    private var client: BackendClient?

    private var probes: [[Float]] = []
    private var embedding = false
    private var closestSeen: FaceMatch?
    private var runnerUpSeen: Float = -1
    private var events: [KioskEvent] = []
    private var match: FaceMatch?
    private var livenessBaseline: Double?
    private var phaseStartedAt = Date()
    private var lastFaceAt = Date()
    private var nextIdentifyAt = Date()
    private var recentScans: [String: Date] = [:]
    private var resetTask: Task<Void, Never>?
    private var started = false

    static let probeCount = 3
    static let maxProbes = 8
    static let frontalYaw = 0.35           // ≈ 20°: templates are mostly frontal
    static let identifyTimeout: TimeInterval = 4
    static let unrecognizedPause: TimeInterval = 5
    static let heartbeatInterval: UInt64 = 30
    static let livenessYaw = 0.26          // ≈ 15° head turn
    static let livenessTimeout: TimeInterval = 7
    static let resultDuration: TimeInterval = 4
    static let localCooldown: TimeInterval = 120  // mirrors the backend's FR-11 cooldown

    // MARK: - Lifecycle

    func start() {
        guard !started else { return }
        started = true
        camera.onReading = { [weak self] reading in self?.handle(reading) }
        reload()
        camera.start()

        Task {
            var tick = 0
            while !Task.isCancelled {
                await flushQueue()
                await sendHeartbeat()
                if tick % 20 == 0 { await syncEmbeddings() }  // every 10 minutes
                tick += 1
                try? await Task.sleep(nanoseconds: Self.heartbeatInterval * 1_000_000_000)
            }
        }
    }

    /// (Re)loads settings, model and stored embeddings. Called at launch and after Settings → Save.
    func reload() {
        settings = KioskSettings.load()
        client = settings.backendConfiguration.map { BackendClient(configuration: $0) }

        var problems: [String] = []
        do {
            if embedder == nil { embedder = try FaceEmbedder.load() }
        } catch {
            problems.append(error.localizedDescription)
        }
        do {
            if store == nil { store = try EmbeddingStore(directory: KioskPaths.directory) }
        } catch {
            problems.append("Cannot open \(KioskPaths.directory.path): \(error.localizedDescription)")
        }
        if client == nil {
            problems.append("Supabase URL, publishable key or kiosk secret is not set. Open Settings (⌘,).")
        }
        rebuildMatcher()
        phase = problems.isEmpty ? .idle(.searching) : .needsSetup(problems)
        if client != nil { Task { await syncEmbeddings() } }
    }

    func rebuildMatcher() {
        matcher = FaceMatcher(templates: store?.templates ?? [:], threshold: Float(settings.matchThreshold))
        status.faces = matcher.count
        status.embeddingsVersion = store?.publishedVersion ?? 0
    }

    // MARK: - Camera frames

    private func handle(_ reading: FaceReading) {
        if route == .enrollment {
            enrollment?.handle(reading)
            return
        }
        guard route == .scan else { return }

        if case .face = reading { lastFaceAt = Date() }

        switch phase {
        case .idle:
            setPhase(.idle(hint(for: reading)))
            if case .face(let sample) = reading, Date() >= nextIdentifyAt {
                probes = []
                closestSeen = nil
                runnerUpSeen = -1
                phaseStartedAt = Date()
                phase = .identifying
                addProbe(sample)
            }
        case .identifying:
            if case .face(let sample) = reading {
                addProbe(sample)
            } else if Date().timeIntervalSince(lastFaceAt) > 1 {
                phase = .idle(hint(for: reading))
            }
            if case .identifying = phase, Date().timeIntervalSince(phaseStartedAt) > Self.identifyTimeout {
                // Not enough clear frontal frames: start over quietly unless we had a real look.
                if probes.count >= Self.probeCount { finishUnrecognized() } else { phase = .idle(.ready) }
            }
        case .liveness:
            checkLiveness(reading)
        default:
            break
        }
    }

    private func hint(for reading: FaceReading) -> FaceHint {
        switch reading {
        case .noFace: return .searching
        case .tooFar: return .tooFar
        case .offCenter: return .offCenter
        case .multipleFaces: return .multiple
        case .face: return .ready
        }
    }

    /// Only phase changes redraw the screen; re-publishing the same value 10×/s made it stutter.
    private func setPhase(_ new: Phase) {
        if phase != new { phase = new }
    }

    private func addProbe(_ sample: FaceSample) {
        guard let embedder, !embedding, abs(sample.yaw) <= Self.frontalYaw else { return }
        embedding = true
        Task {
            defer { embedding = false }
            do {
                let vector = try await embedder.embeddings(for: [sample.crop])[0]
                guard case .identifying = phase else { return }
                probes.append(vector)
                evaluateProbes()
            } catch {
                record(KioskEvent(kind: .error, detail: "Face model: \(error.localizedDescription)"))
                show(ScanResult(kind: .failure, title: "Something went wrong", detail: error.localizedDescription))
            }
        }
    }

    private func evaluateProbes() {
        guard probes.count >= Self.probeCount, let probe = Vector.mean(Array(probes.suffix(Self.probeCount))) else { return }
        guard let found = matcher.bestMatch(for: probe) else {
            let result = matcher.evaluate(probe)
            if let closest = result.closest, closest.score > (closestSeen?.score ?? -1) {
                closestSeen = closest
                runnerUpSeen = result.runnerUp
            }
            if probes.count >= Self.maxProbes { finishUnrecognized() }  // otherwise keep trying with fresh frames
            return
        }
        if let last = recentScans[found.enrollmentNo], Date().timeIntervalSince(last) < Self.localCooldown {
            // Same person still standing there after their scan: stay quiet.
            nextIdentifyAt = Date().addingTimeInterval(3)
            phase = .idle(.ready)
            return
        }
        match = found
        livenessBaseline = nil
        phaseStartedAt = Date()
        phase = .liveness(progress: 0)
    }

    private func finishUnrecognized() {
        record(KioskEvent(kind: .unrecognized, enrollmentNo: closestSeen?.enrollmentNo, score: closestSeen?.score,
                          detail: closestSeen == nil ? "No faces loaded" : String(format: "Next best %.2f", runnerUpSeen)))
        phase = .unrecognized
        scheduleReset(after: Self.unrecognizedPause)
    }

    /// Passive photos can't turn their head: require a ~15° turn to either side.
    private func checkLiveness(_ reading: FaceReading) {
        if Date().timeIntervalSince(phaseStartedAt) > Self.livenessTimeout {
            record(KioskEvent(kind: .livenessFailed, enrollmentNo: match?.enrollmentNo, score: match?.score))
            show(ScanResult(kind: .notice, title: "Let's try that again", detail: "Turn your head slightly when asked."))
            return
        }
        guard case .face(let sample) = reading, let match else { return }
        let baseline = livenessBaseline ?? sample.yaw
        livenessBaseline = baseline
        let progress = (min(1, abs(sample.yaw - baseline) / Self.livenessYaw) * 20).rounded(.down) / 20
        setPhase(.liveness(progress: progress))
        if progress >= 1 {
            record(KioskEvent(kind: .recognized, enrollmentNo: match.enrollmentNo, score: match.score))
            // Set before the Task, so the next frame can't submit again.
            phase = .recognized(firstName: KnownNames.firstName(for: match.enrollmentNo))
            Task { await submit(enrollmentNo: match.enrollmentNo, manual: false) }
        }
    }

    // MARK: - Scans

    func submitManual(_ enrollmentNo: String) {
        route = .scan
        phase = .submitting
        Task { await submit(enrollmentNo: enrollmentNo, manual: true) }
    }

    private func submit(enrollmentNo: String, manual: Bool) async {
        if case .recognized = phase {} else { phase = .submitting }
        let scan = QueuedScan(enrollmentNo: enrollmentNo, scannedAt: Date(), manual: manual)
        recentScans[enrollmentNo] = scan.scannedAt

        guard let client else { return await enqueue(scan) }
        if await queue.isEmpty == false {
            // Keep order: earlier offline scans must reach the backend first.
            await enqueue(scan)
            return await flushQueue()
        }

        do {
            let response = try await client.scan(enrollmentNo: enrollmentNo, manual: manual,
                                                 workshopName: workshopName)
            status.online = true
            show(result(for: response))
        } catch let error as BackendError where error.isRetryable {
            status.online = false
            await enqueue(scan)
        } catch let error as BackendError {
            recentScans[enrollmentNo] = nil
            if error.code != .cooldown {
                record(KioskEvent(kind: .error, enrollmentNo: enrollmentNo, detail: "Scan rejected: \(error.code?.rawValue ?? "unknown")"))
            }
            show(result(for: error))
        } catch {
            show(ScanResult(kind: .failure, title: "Something went wrong", detail: error.localizedDescription))
        }
    }

    private func enqueue(_ scan: QueuedScan) async {
        do {
            try await queue.enqueue(scan)
            status.queued = await queue.pending.count
            record(KioskEvent(kind: .queued, enrollmentNo: scan.enrollmentNo, detail: "Saved offline"))
            show(ScanResult(kind: .queued, title: "Scan saved",
                            detail: "It syncs automatically — no need to scan again."))
        } catch {
            show(ScanResult(kind: .failure, title: "Couldn't save your scan", detail: error.localizedDescription))
        }
    }

    private func flushQueue() async {
        guard let client else { return }
        let workshopName = self.workshopName
        let result = await queue.flush { scan in
            _ = try await client.scan(enrollmentNo: scan.enrollmentNo, scannedAt: scan.scannedAt,
                                      manual: scan.manual, workshopName: workshopName)
        }
        if result.sent > 0 { status.online = true }
        status.queued = result.remaining
    }

    private var workshopName: String? {
        settings.workshopName.isEmpty ? nil : settings.workshopName
    }

    private func result(for response: ScanResponse) -> ScanResult {
        KnownNames.remember(fullName: response.name, for: response.enrollmentNo)
        let name = response.name.split(separator: " ").first.map(String.init) ?? ""
        let time = Date().formatted(date: .omitted, time: .shortened)
        switch response.action {
        case .entry:
            return ScanResult(kind: .checkIn, title: "Welcome, \(name)", detail: "Checked in at \(time)")
        case .exit:
            let duration = Self.durationText(minutes: response.durationMins ?? 0)
            let email = (response.durationMins ?? 0) >= 15 ? " · Check your email to log your work." : ""
            return ScanResult(kind: .checkOut, title: "See you, \(name)", detail: "Checked out · \(duration)\(email)")
        case .workshopAttendee:
            return ScanResult(kind: .workshop, title: "Welcome, \(name)",
                              detail: response.alreadyLogged ? "You're already on today's workshop list." : "You're on today's workshop list.")
        }
    }

    private func result(for error: BackendError) -> ScanResult {
        switch error.code {
        case .cooldown:
            if case .api(let api) = error, let seconds = api.cooldownRemainingSeconds {
                return ScanResult(kind: .notice, title: "You just scanned", detail: "Scan again in \(seconds) seconds to check out.")
            }
            return ScanResult(kind: .notice, title: "You just scanned", detail: "Wait two minutes before scanning again.")
        case .notEnrolled:
            return ScanResult(kind: .notice, title: "Not enrolled yet", detail: "Tap “Enroll your face” to get started.")
        case .authMissing, .authInvalid, .authMisconfigured, .forbidden:
            return ScanResult(kind: .failure, title: "Kiosk not authorised", detail: "Ask a lab admin to check the kiosk secret.")
        case .validationError:
            return ScanResult(kind: .failure, title: "That number isn't valid", detail: "Use letters, digits, “-” or “_”.")
        default:
            return ScanResult(kind: .failure, title: "Something went wrong", detail: "Please try again.")
        }
    }

    static func durationText(minutes: Int) -> String {
        minutes < 60 ? "\(minutes) min" : "\(minutes / 60) h \(minutes % 60) min"
    }

    private func show(_ result: ScanResult) {
        phase = .result(result)
        scheduleReset(after: Self.resultDuration)
    }

    private func scheduleReset(after seconds: TimeInterval) {
        resetTask?.cancel()
        resetTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self.resetToIdle()
        }
    }

    func resetToIdle() {
        resetTask?.cancel()
        probes = []
        match = nil
        nextIdentifyAt = Date().addingTimeInterval(1)
        if case .needsSetup = phase { return }
        phase = .idle(.searching)
    }

    // MARK: - Enrollment

    func beginEnrollment(prefill enrollmentNo: String = "") {
        guard let client, let embedder, let store else { return }
        enrollment = EnrollmentModel(client: client, embedder: embedder, store: store, prefill: enrollmentNo) { [weak self] in
            self?.endEnrollment()
        }
        route = .enrollment
    }

    func endEnrollment() {
        enrollment = nil
        route = .scan
        rebuildMatcher()
        resetToIdle()
    }

    var canEnroll: Bool { client != nil && embedder != nil && store != nil }

    // MARK: - Backend sync

    private func record(_ event: KioskEvent) {
        events.append(event)
        if events.count > 500 { events.removeFirst(events.count - 500) }
    }

    /// Health + scan attempts → admin portal. Events stay buffered until a heartbeat succeeds.
    private func sendHeartbeat() async {
        guard let client else { return }
        let batch = Array(events.prefix(200))
        let beat = KioskHeartbeat(appVersion: Self.appVersion, queued: status.queued, faces: status.faces,
                                  embeddingsVersion: status.embeddingsVersion, workshopName: settings.workshopName,
                                  matchThreshold: settings.matchThreshold, problem: status.problem ?? "")
        do {
            _ = try await client.heartbeat(beat, events: batch)
            events.removeFirst(min(batch.count, events.count))
            status.online = true
        } catch let error as BackendError where error.isRetryable {
            status.online = false
        } catch {
            status.online = true  // reachable, but the heartbeat was refused; keep scanning
        }
    }

    static let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"

    func syncEmbeddings() async {
        guard let client, let store, let embedder else { return }
        do {
            let info = try await client.embeddingsVersion()
            guard info.version > store.publishedVersion else { return }
            let file = try await client.downloadEmbeddings()
            guard file.modelVersion == embedder.modelVersion else {
                status.problem = "Embeddings use “\(file.modelVersion)” but this kiosk's model is “\(embedder.modelVersion)”. Re-export the model."
                return
            }
            try store.replacePublished(file)
            status.problem = nil
            rebuildMatcher()
        } catch let error as BackendError where error.isRetryable {
            status.online = false
        } catch {
            status.problem = "Embeddings sync failed: \(error.localizedDescription)"
        }
    }
}
