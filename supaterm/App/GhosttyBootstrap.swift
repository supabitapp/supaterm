import Foundation
import GhosttyKit

enum GhosttyBootstrap {
  static let extraCLIArguments: [String] = []

  private static let argv: [UnsafeMutablePointer<CChar>?] = {
    var args: [UnsafeMutablePointer<CChar>?] = []
    let executable = CommandLine.arguments.first ?? "supaterm"
    args.append(strdup(executable))
    for argument in extraCLIArguments {
      args.append(strdup(argument))
    }
    args.append(nil)
    return args
  }()

  static func initialize() {
    if let resourcesURL = Bundle.main.resourceURL?.appendingPathComponent("ghostty") {
      setenv("GHOSTTY_RESOURCES_DIR", resourcesURL.path, 1)
    }
    if let terminfoURL = Bundle.main.resourceURL?.appendingPathComponent("terminfo") {
      setenv("TERMINFO_DIRS", terminfoURL.path, 1)
    }
    argv.withUnsafeBufferPointer { buffer in
      let argc = UInt(max(0, buffer.count - 1))
      let argv = UnsafeMutablePointer(mutating: buffer.baseAddress)
      if ghostty_init(argc, argv) != GHOSTTY_SUCCESS {
        preconditionFailure("ghostty_init failed")
      }
    }
  }
}
