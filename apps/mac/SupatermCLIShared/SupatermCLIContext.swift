import Foundation

public enum SupatermCLIEnvironment {
  public static let cliPathKey = "SUPATERM_CLI_PATH"
  public static let instanceNameKey = "SUPATERM_INSTANCE_NAME"
  public static let stateHomeKey = "SUPATERM_STATE_HOME"
  public static let surfaceIDKey = "SUPATERM_SURFACE_ID"
  public static let tabIDKey = "SUPATERM_TAB_ID"
  public static let windowIDKey = "SUPATERM_WINDOW_ID"
  public static let socketPathKey = "SUPATERM_SOCKET_PATH"
  public static let testCodexEnableHooksKey = "SUPATERM_TEST_CODEX_ENABLE_HOOKS"
  public static let testHomeKey = "SUPATERM_TEST_HOME"
}

public struct SupatermCLIEnvironmentVariable: Equatable, Sendable {
  public let key: String
  public let value: String

  public init(key: String, value: String) {
    self.key = key
    self.value = value
  }
}

public struct SupatermCLIContext: Equatable, Sendable, Codable {
  public let windowID: UUID
  public let surfaceID: UUID
  public let tabID: UUID

  public init(windowID: UUID, surfaceID: UUID, tabID: UUID) {
    self.windowID = windowID
    self.surfaceID = surfaceID
    self.tabID = tabID
  }

  public init?(environment: [String: String]) {
    guard
      let windowID = environment[SupatermCLIEnvironment.windowIDKey]
        .flatMap(UUID.init(uuidString:)),
      let surfaceID = environment[SupatermCLIEnvironment.surfaceIDKey]
        .flatMap(UUID.init(uuidString:)),
      let tabID = environment[SupatermCLIEnvironment.tabIDKey]
        .flatMap(UUID.init(uuidString:))
    else {
      return nil
    }

    self.init(windowID: windowID, surfaceID: surfaceID, tabID: tabID)
  }

  public static var current: Self? {
    Self(environment: ProcessInfo.processInfo.environment)
  }

  public var environmentVariables: [SupatermCLIEnvironmentVariable] {
    [
      .init(
        key: SupatermCLIEnvironment.windowIDKey,
        value: windowID.uuidString
      ),
      .init(
        key: SupatermCLIEnvironment.surfaceIDKey,
        value: surfaceID.uuidString
      ),
      .init(
        key: SupatermCLIEnvironment.tabIDKey,
        value: tabID.uuidString
      ),
    ]
  }
}
