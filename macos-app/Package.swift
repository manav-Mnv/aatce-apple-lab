// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AatceKiosk",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .library(name: "KioskNetworking", targets: ["KioskNetworking"])
    ],
    targets: [
        .target(name: "KioskNetworking"),
        .testTarget(name: "KioskNetworkingTests", dependencies: ["KioskNetworking"])
    ]
)
