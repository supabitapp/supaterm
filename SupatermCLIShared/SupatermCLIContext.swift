import Foundation

public enum SupatermCLIEnvironment {
  public static let surfaceIDKey = "SUPATERM_SURFACE_ID"
  public static let tabIDKey = "SUPATERM_TAB_ID"
  public static let paneSessionNameKey = "SUPATERM_PANE_SESSION"
  public static let socketPathKey = "SUPATERM_SOCKET_PATH"
}

public struct SupatermCLIEnvironmentVariable: Equatable, Sendable {
  public let key: String
  public let value: String

  public init(key: String, value: String) {
    self.key = key
    self.value = value
  }
}

public struct SupatermCLIContext: Equatable, Sendable {
  public let surfaceID: UUID
  public let tabID: UUID
  public let paneSessionName: String?

  public init(surfaceID: UUID, tabID: UUID, paneSessionName: String? = nil) {
    self.surfaceID = surfaceID
    self.tabID = tabID
    self.paneSessionName = paneSessionName
  }

  public init?(environment: [String: String]) {
    guard
      let surfaceID = environment[SupatermCLIEnvironment.surfaceIDKey]
        .flatMap(UUID.init(uuidString:)),
      let tabID = environment[SupatermCLIEnvironment.tabIDKey]
        .flatMap(UUID.init(uuidString:))
    else {
      return nil
    }

    self.init(
      surfaceID: surfaceID,
      tabID: tabID,
      paneSessionName: environment[SupatermCLIEnvironment.paneSessionNameKey]
    )
  }

  public static var current: Self? {
    Self(environment: ProcessInfo.processInfo.environment)
  }

  public var environmentVariables: [SupatermCLIEnvironmentVariable] {
    var variables: [SupatermCLIEnvironmentVariable] = [
      .init(
        key: SupatermCLIEnvironment.surfaceIDKey,
        value: surfaceID.uuidString
      ),
      .init(
        key: SupatermCLIEnvironment.tabIDKey,
        value: tabID.uuidString
      ),
    ]
    if let paneSessionName, !paneSessionName.isEmpty {
      variables.append(
        .init(
          key: SupatermCLIEnvironment.paneSessionNameKey,
          value: paneSessionName
        )
      )
    }
    return variables
  }
}
