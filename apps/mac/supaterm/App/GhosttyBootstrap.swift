import Foundation
import GhosttyKit

enum GhosttyBootstrap {
  private static let argv: [UnsafeMutablePointer<CChar>?] = {
    [
      strdup(CommandLine.arguments.first ?? "supaterm"),
      nil,
    ]
  }()

  static func initialize() {
    guard
      let resourceDirectories = GhosttySupport.resourceDirectories(resourcesURL: Bundle.main.resourceURL)
    else {
      assertionFailure("Missing bundled Ghostty resources")
      return
    }
    do {
      try GhosttySupport.seedDefaultConfigIfNeeded()
    } catch {
      assertionFailure("Failed to seed Ghostty config: \(error)")
    }
    setenv("GHOSTTY_RESOURCES_DIR", resourceDirectories.ghostty.path, 1)
    setenv("TERMINFO_DIRS", resourceDirectories.terminfo.path, 1)

    argv.withUnsafeBufferPointer { buffer in
      let argc = UInt(max(0, buffer.count - 1))
      let argv = UnsafeMutablePointer(mutating: buffer.baseAddress)
      if ghostty_init(argc, argv) != GHOSTTY_SUCCESS {
        preconditionFailure("ghostty_init failed")
      }
    }
  }
}
