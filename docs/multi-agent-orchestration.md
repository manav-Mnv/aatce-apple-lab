# Multi-Agent Build Orchestration (LangGraph)
## AATCE — Apple Lab Attendance System

This design uses LangGraph's **supervisor + specialist subgraphs** pattern (the standard 2026 multi-agent architecture) to parallelize and self-correct the Phase 1-5 build from SRS v2.1, instead of doing it as one long linear opencode session.

---

## 1. Why this fits here

Your repo already has natural specialist boundaries — `backend`, `macos-app`, `ml-training`, `admin-portal`. Each one:
- Has its own tech stack (Go/Apps Script, Swift, Python, Next.js)
- Can be built semi-independently once the API contract (Apps Script endpoints) is fixed
- Benefits from its own review/fix loop without blocking the others

That's exactly the shape LangGraph is built for: a **Supervisor** node routes work to **specialist** nodes, each specialist runs its own internal **build → test → review → fix** loop (a cycle, not a straight line), and control returns to the supervisor when a specialist reports done or stuck.

## 2. The graph

```
                    ┌─────────────┐
            ┌──────▶│  Supervisor │◀──────┐
            │       └──────┬──────┘       │
            │              │ routes to    │
            │   ┌──────────┼──────────┬───┴────────┐
            │   ▼          ▼          ▼            ▼
      ┌──────────┐  ┌──────────┐ ┌──────────┐ ┌──────────┐
      │ Backend  │  │  Kiosk   │ │    ML    │ │  Admin   │
      │  Agent   │  │  Agent   │ │  Agent   │ │  Portal  │
      │          │  │          │ │          │ │  Agent   │
      │ build→   │  │ build→   │ │ build→   │ │ build→   │
      │ test→    │  │ test→    │ │ test→    │ │ test→    │
      │ review↺  │  │ review↺  │ │ review↺  │ │ review↺  │
      └────┬─────┘  └────┬─────┘ └────┬─────┘ └────┬─────┘
           │             │            │            │
           └─────────────┴────────────┴────────────┘
                          │ report status back
                          ▼
                   ┌─────────────┐
                   │  Supervisor │── all done? ──▶ END
                   └─────────────┘
```

Each specialist node is itself a small loop (this is the "cyclic graph" part LangGraph is actually for): write code → run tests/build → an internal **Reviewer** sub-step checks the diff against the SRS requirements for that component → if it fails, loop back to "write code" with the failure as context; if it passes, report back to the Supervisor.

## 3. Build order (respects your Phase 1-5 roadmap)

The Supervisor doesn't fan out to all four at once on day one — it follows SRS section 8:
1. **Backend Agent only** — Phase 1 (Apps Script core loop). Nothing else can start until the API contract (endpoint shapes, request/response JSON) is real.
2. **Kiosk Agent + ML Agent in parallel** — Phase 1's kiosk half, and Phase 4's embedding generation, can both proceed once the backend's contract is known — they don't depend on each other.
3. **Admin Portal Agent** — Phase 3, once Backend is stable enough to read from.
4. **Hardening pass** — Supervisor re-invokes all four with the NFR hardening list (LockService, offline queue, secret rotation, versioned embeddings) as follow-up tasks.

## 4. Agent prompts

**Supervisor system prompt:**
```
You are the build supervisor for the AATCE Apple Lab Attendance System. 
You have the full SRS (v2.1) and PRD as context. Your job is only to 
decide which specialist agent works next, pass them their scoped task 
and any context from prior agents' output, and decide when the overall 
build is done. You never write code yourself. Current phase: {phase}. 
Agents available: backend, kiosk, ml, admin_portal. Completed so far: 
{completed_tasks}. Decide the next agent and task, or END if the 
current phase's goals are met.
```

**Backend Agent system prompt:**
```
You own /backend only. Build a Google Apps Script web app per SRS v2.1 
section 4.1-4.6 and NFR-4, NFR-7, NFR-9. Implement doPost /enroll and 
/scan, LockService-wrapped Sheet writes, shared-secret header check. 
Do not modify any other folder. After writing code, run/describe your 
test plan (curl examples). Report back: files changed, what works, 
what's still missing, any blockers for other agents (e.g. "the /scan 
response shape is: {...}" — other agents need this).
```

**Kiosk Agent system prompt:**
```
You own /macos-app only. Build the Swift/SwiftUI kiosk app per SRS 
section 4.1-4.2, 4.6 and NFR-2, NFR-5, NFR-9. You depend on the 
Backend Agent's reported /enroll and /scan response shapes — if not 
yet available, build against the SRS's documented shape and flag the 
assumption. Implement local matching, liveness check, and the durable 
offline queue (NFR-2) as a distinct, testable module. Report back: 
files changed, assumptions made, test coverage for the offline-queue 
crash case specifically.
```

**ML Agent system prompt:**
```
You own /ml-training only. Build the Python embedding-generation and 
retraining pipeline per SRS section 4.6, 6, 8 (Phase 4). Output format 
must match embeddings.json's documented schema exactly (version, 
generated_at, model_version, entries[]) since the Kiosk Agent depends 
on it. Report back: schema produced, how versioning increments, any 
GitHub Actions workflow file written.
```

**Admin Portal Agent system prompt:**
```
You own /admin-portal only. Build the Next.js + Tailwind app per SRS 
section 4.5, FR-18 through FR-20. Depends on the Backend Agent's API 
shape for reads. Implement Firebase Auth per NFR-4's domain-restriction 
note. Report back: pages built, what's mocked vs. real, Vercel deploy 
readiness.
```

**Reviewer sub-step prompt (used inside every specialist's loop):**
```
Compare this agent's diff against its assigned SRS requirement IDs. 
List any requirement not satisfied, any NFR violated, and any scope 
violation (files touched outside the agent's owned folder). Output 
PASS or FAIL with a specific, actionable reason list if FAIL.
```

---

## 5. Orchestrator skeleton (Python, LangGraph)

See `orchestrator.py` — a runnable starting skeleton. It defines the graph shape above; you fill in each node's actual LLM call (Anthropic API) and file-write logic against your repo clone.

## 6. A simpler fallback, if full LangGraph is more setup than you want right now

You don't strictly need the Python framework to get the *pattern* — you can run this manually in opencode today by treating each specialist prompt above as a separate opencode session scoped to one folder, and playing "supervisor" yourself between them (read each agent's report, decide what's next, paste the next prompt). LangGraph's value-add is automating that routing/looping and giving you checkpointed, resumable state — worth adding once the manual version feels like it needs it, not before.
