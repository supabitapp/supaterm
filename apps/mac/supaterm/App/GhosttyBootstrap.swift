import Foundation
import GhosttyKit
import SupatermSupport

enum GhosttyBootstrapError: Equatable, LocalizedError {
  case configSeedFailed(String)
  case coreInitializationFailed(Int32)
  case environmentSetFailed(String)
  case missingResources

  var errorDescription: String? {
    switch self {
    case .configSeedFailed(let message):
      "The terminal configuration could not be prepared. \(message)"
    case .coreInitializationFailed(let status):
      "The terminal core could not initialize. Status: \(status)."
    case .environmentSetFailed(let name):
      "The terminal environment could not set \(name)."
    case .missingResources:
      "Required terminal resources are missing."
    }
  }
}

enum GhosttyBootstrap {
  private static let argv: [UnsafeMutablePointer<CChar>?] = {
    [
      strdup(CommandLine.arguments.first ?? "supaterm"),
      nil,
    ]
  }()

  static func initialize() throws {
    try initialize(
      resourceDirectories: {
        GhosttySupport.resourceDirectories(resourcesURL: Bundle.main.resourceURL)
      },
      seedDefaultConfig: {
        try GhosttySupport.seedDefaultConfigIfNeeded()
      },
      setEnvironment: { name, value in
        setenv(name, value, 1) == 0
      },
      initializeCore: {
        initializeCore()
      }
    )
  }

  static func initialize(
    resourceDirectories: () -> (ghostty: URL, terminfo: URL)?,
    seedDefaultConfig: () throws -> Void,
    setEnvironment: (String, String) -> Bool,
    initializeCore: () -> Int32
  ) throws {
    guard let resourceDirectories = resourceDirectories() else {
      throw GhosttyBootstrapError.missingResources
    }
    do {
      try seedDefaultConfig()
    } catch {
      throw GhosttyBootstrapError.configSeedFailed(error.localizedDescription)
    }
    guard setEnvironment("GHOSTTY_RESOURCES_DIR", resourceDirectories.ghostty.path) else {
      throw GhosttyBootstrapError.environmentSetFailed("GHOSTTY_RESOURCES_DIR")
    }
    guard setEnvironment("TERMINFO_DIRS", resourceDirectories.terminfo.path) else {
      throw GhosttyBootstrapError.environmentSetFailed("TERMINFO_DIRS")
    }
    let result = initializeCore()
    guard result == GHOSTTY_SUCCESS else {
      throw GhosttyBootstrapError.coreInitializationFailed(result)
    }
  }

  private static func initializeCore() -> Int32 {
    argv.withUnsafeBufferPointer { buffer in
      let argc = UInt(max(0, buffer.count - 1))
      let argv = UnsafeMutablePointer(mutating: buffer.baseAddress)
      return ghostty_init(argc, argv)
    }
  }
}
