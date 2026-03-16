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

  static func resourceDirectories(
    resourcesURL: URL?,
    fileManager: FileManager = .default
  ) -> (ghostty: URL, terminfo: URL)? {
    guard let resourcesURL else { return nil }

    let ghosttyURL = resourcesURL.appendingPathComponent("ghostty", isDirectory: true)
    let terminfoURL = resourcesURL.appendingPathComponent("terminfo", isDirectory: true)

    var isDirectory = ObjCBool(false)
    guard fileManager.fileExists(atPath: ghosttyURL.path, isDirectory: &isDirectory),
      isDirectory.boolValue
    else {
      return nil
    }

    isDirectory = ObjCBool(false)
    guard fileManager.fileExists(atPath: terminfoURL.path, isDirectory: &isDirectory),
      isDirectory.boolValue
    else {
      return nil
    }

    return (ghosttyURL, terminfoURL)
  }

  static func initialize() {
    guard let resourceDirectories = resourceDirectories(resourcesURL: Bundle.main.resourceURL) else {
      preconditionFailure("Missing bundled Ghostty resources")
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
