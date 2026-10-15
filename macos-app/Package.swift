// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AatceKiosk",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "AATCEKiosk", targets: ["AATCEKiosk"]),
        .library(name: "KioskCore", targets: ["KioskCore"]),
        .library(name: "KioskNetworking", targets: ["KioskNetworking"])
    ],
    targets: [
        .target(name: "KioskNetworking"),
        .target(name: "KioskCore", dependencies: ["KioskNetworking"]),
        .executableTarget(name: "AATCEKiosk", dependencies: ["KioskCore", "KioskNetworking"]),
        .testTarget(name: "KioskNetworkingTests", dependencies: ["KioskNetworking"]),
        .testTarget(name: "KioskCoreTests", dependencies: ["KioskCore", "KioskNetworking"])
    ]
)
