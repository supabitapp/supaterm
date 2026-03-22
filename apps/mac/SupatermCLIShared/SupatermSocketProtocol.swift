import Foundation

public enum SupatermSocketMethod {
  public static let appOnboarding = "app.onboarding"
  public static let appDebug = "app.debug"
  public static let appTree = "app.tree"
  public static let systemIdentity = "system.identity"
  public static let systemPing = "system.ping"
  public static let terminalNewTab = "terminal.new_tab"
  public static let terminalNewPane = "terminal.new_pane"
}

public enum SupatermSocketProtocolError: Error, Equatable, Sendable {
  case invalidJSONValue
  case missingResult
  case payloadMustBeJSONObject
}

extension SupatermSocketProtocolError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .invalidJSONValue:
      return "The socket payload contained an unsupported JSON value."
    case .missingResult:
      return "The socket response did not include a result payload."
    case .payloadMustBeJSONObject:
      return "The socket payload must encode to a JSON object."
    }
  }
}

public typealias JSONObject = [String: JSONValue]

public struct SupatermSocketEndpoint: Equatable, Sendable, Codable {
  public let id: UUID
  public let name: String
  public let path: String
  public let pid: Int32
  public let startedAt: Date

  public init(
    id: UUID,
    name: String,
    path: String,
    pid: Int32,
    startedAt: Date
  ) {
    self.id = id
    self.name = name
    self.path = path
    self.pid = pid
    self.startedAt = startedAt
  }
}

extension SupatermSocketEndpoint {
  public var displayString: String {
    "\(name) [\(String(id.uuidString.prefix(8)))] pid \(pid) socket \(path)"
  }
}

public struct SupatermSocketRequest: Equatable, Sendable, Codable {
  public let id: String
  public let method: String
  public let params: JSONObject

  public init(
    id: String,
    method: String,
    params: JSONObject = [:]
  ) {
    self.id = id
    self.method = method
    self.params = params
  }

  public static func ping(id: String = UUID().uuidString) -> Self {
    Self(id: id, method: SupatermSocketMethod.systemPing)
  }

  public static func identity(id: String = UUID().uuidString) -> Self {
    Self(id: id, method: SupatermSocketMethod.systemIdentity)
  }

  public static func tree(id: String = UUID().uuidString) -> Self {
    Self(id: id, method: SupatermSocketMethod.appTree)
  }

  public static func onboarding(id: String = UUID().uuidString) -> Self {
    Self(id: id, method: SupatermSocketMethod.appOnboarding)
  }

  public static func debug(
    _ payload: SupatermDebugRequest = .init(),
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.appDebug,
      params: try JSONObject(payload)
    )
  }

  public static func newPane(
    _ payload: SupatermNewPaneRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalNewPane,
      params: try JSONObject(payload)
    )
  }

  public static func newTab(
    _ payload: SupatermNewTabRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalNewTab,
      params: try JSONObject(payload)
    )
  }

  public func decodeParams<T: Decodable>(_ type: T.Type = T.self) throws -> T {
    try decodeJSONObject(params, as: type)
  }
}

public struct SupatermSocketResponse: Equatable, Sendable, Codable {
  public struct ErrorPayload: Equatable, Sendable, Codable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
      self.code = code
      self.message = message
    }
  }

  public let id: String?
  public let ok: Bool
  public let result: JSONObject?
  public let error: ErrorPayload?

  public init(
    id: String?,
    ok: Bool,
    result: JSONObject? = nil,
    error: ErrorPayload? = nil
  ) {
    self.id = id
    self.ok = ok
    self.result = result
    self.error = error
  }

  public static func ok(
    id: String,
    result: JSONObject = [:]
  ) -> Self {
    Self(id: id, ok: true, result: result)
  }

  public static func ok<T: Encodable>(
    id: String,
    encodableResult: T
  ) throws -> Self {
    Self(id: id, ok: true, result: try JSONObject(encodableResult))
  }

  public static func error(
    id: String? = nil,
    code: String,
    message: String
  ) -> Self {
    Self(id: id, ok: false, error: .init(code: code, message: message))
  }

  public func decodeResult<T: Decodable>(_ type: T.Type = T.self) throws -> T {
    guard let result else {
      throw SupatermSocketProtocolError.missingResult
    }
    return try decodeJSONObject(result, as: type)
  }
}

public struct SupatermDebugRequest: Equatable, Sendable, Codable {
  public let context: SupatermCLIContext?

  public init(context: SupatermCLIContext? = nil) {
    self.context = context
  }
}

public struct SupatermAppDebugSnapshot: Equatable, Sendable, Codable {
  public struct Build: Equatable, Sendable, Codable {
    public let version: String
    public let buildNumber: String
    public let isDevelopmentBuild: Bool
    public let usesStubUpdateChecks: Bool

    public init(
      version: String,
      buildNumber: String,
      isDevelopmentBuild: Bool,
      usesStubUpdateChecks: Bool
    ) {
      self.version = version
      self.buildNumber = buildNumber
      self.isDevelopmentBuild = isDevelopmentBuild
      self.usesStubUpdateChecks = usesStubUpdateChecks
    }
  }

  public struct Update: Equatable, Sendable, Codable {
    public let canCheckForUpdates: Bool
    public let phase: String
    public let detail: String

    public init(
      canCheckForUpdates: Bool,
      phase: String,
      detail: String
    ) {
      self.canCheckForUpdates = canCheckForUpdates
      self.phase = phase
      self.detail = detail
    }
  }

  public struct Summary: Equatable, Sendable, Codable {
    public let windowCount: Int
    public let spaceCount: Int
    public let tabCount: Int
    public let paneCount: Int
    public let keyWindowIndex: Int?

    public init(
      windowCount: Int,
      spaceCount: Int,
      tabCount: Int,
      paneCount: Int,
      keyWindowIndex: Int?
    ) {
      self.windowCount = windowCount
      self.spaceCount = spaceCount
      self.tabCount = tabCount
      self.paneCount = paneCount
      self.keyWindowIndex = keyWindowIndex
    }
  }

  public struct CurrentTarget: Equatable, Sendable, Codable {
    public let windowIndex: Int
    public let spaceIndex: Int
    public let spaceID: UUID
    public let spaceName: String
    public let tabIndex: Int
    public let tabID: UUID
    public let tabTitle: String
    public let paneIndex: Int?
    public let paneID: UUID?

    public init(
      windowIndex: Int,
      spaceIndex: Int,
      spaceID: UUID,
      spaceName: String,
      tabIndex: Int,
      tabID: UUID,
      tabTitle: String,
      paneIndex: Int?,
      paneID: UUID?
    ) {
      self.windowIndex = windowIndex
      self.spaceIndex = spaceIndex
      self.spaceID = spaceID
      self.spaceName = spaceName
      self.tabIndex = tabIndex
      self.tabID = tabID
      self.tabTitle = tabTitle
      self.paneIndex = paneIndex
      self.paneID = paneID
    }
  }

  public struct Window: Equatable, Sendable, Codable {
    public let index: Int
    public let isKey: Bool
    public let isVisible: Bool
    public let spaces: [Space]

    public init(
      index: Int,
      isKey: Bool,
      isVisible: Bool,
      spaces: [Space]
    ) {
      self.index = index
      self.isKey = isKey
      self.isVisible = isVisible
      self.spaces = spaces
    }
  }

  public struct Space: Equatable, Sendable, Codable {
    public let index: Int
    public let id: UUID
    public let name: String
    public let isSelected: Bool
    public let tabs: [Tab]

    public init(
      index: Int,
      id: UUID,
      name: String,
      isSelected: Bool,
      tabs: [Tab]
    ) {
      self.index = index
      self.id = id
      self.name = name
      self.isSelected = isSelected
      self.tabs = tabs
    }
  }

  public struct Tab: Equatable, Sendable, Codable {
    public let index: Int
    public let id: UUID
    public let title: String
    public let isSelected: Bool
    public let isPinned: Bool
    public let isDirty: Bool
    public let isTitleLocked: Bool
    public let hasRunningActivity: Bool
    public let hasBell: Bool
    public let hasReadOnly: Bool
    public let hasSecureInput: Bool
    public let panes: [Pane]

    public init(
      index: Int,
      id: UUID,
      title: String,
      isSelected: Bool,
      isPinned: Bool,
      isDirty: Bool,
      isTitleLocked: Bool,
      hasRunningActivity: Bool,
      hasBell: Bool,
      hasReadOnly: Bool,
      hasSecureInput: Bool,
      panes: [Pane]
    ) {
      self.index = index
      self.id = id
      self.title = title
      self.isSelected = isSelected
      self.isPinned = isPinned
      self.isDirty = isDirty
      self.isTitleLocked = isTitleLocked
      self.hasRunningActivity = hasRunningActivity
      self.hasBell = hasBell
      self.hasReadOnly = hasReadOnly
      self.hasSecureInput = hasSecureInput
      self.panes = panes
    }
  }

  public struct Pane: Equatable, Sendable, Codable {
    public let index: Int
    public let id: UUID
    public let isFocused: Bool
    public let displayTitle: String
    public let pwd: String?
    public let isReadOnly: Bool
    public let hasSecureInput: Bool
    public let bellCount: Int
    public let isRunning: Bool
    public let progressState: String?
    public let progressValue: Int?
    public let needsCloseConfirmation: Bool
    public let lastCommandExitCode: Int?
    public let lastCommandDurationMs: UInt64?
    public let lastChildExitCode: UInt32?
    public let lastChildExitTimeMs: UInt64?

    public init(
      index: Int,
      id: UUID,
      isFocused: Bool,
      displayTitle: String,
      pwd: String?,
      isReadOnly: Bool,
      hasSecureInput: Bool,
      bellCount: Int,
      isRunning: Bool,
      progressState: String?,
      progressValue: Int?,
      needsCloseConfirmation: Bool,
      lastCommandExitCode: Int?,
      lastCommandDurationMs: UInt64?,
      lastChildExitCode: UInt32?,
      lastChildExitTimeMs: UInt64?
    ) {
      self.index = index
      self.id = id
      self.isFocused = isFocused
      self.displayTitle = displayTitle
      self.pwd = pwd
      self.isReadOnly = isReadOnly
      self.hasSecureInput = hasSecureInput
      self.bellCount = bellCount
      self.isRunning = isRunning
      self.progressState = progressState
      self.progressValue = progressValue
      self.needsCloseConfirmation = needsCloseConfirmation
      self.lastCommandExitCode = lastCommandExitCode
      self.lastCommandDurationMs = lastCommandDurationMs
      self.lastChildExitCode = lastChildExitCode
      self.lastChildExitTimeMs = lastChildExitTimeMs
    }
  }

  public let build: Build
  public let update: Update
  public let summary: Summary
  public let currentTarget: CurrentTarget?
  public let windows: [Window]
  public let problems: [String]

  public init(
    build: Build,
    update: Update,
    summary: Summary,
    currentTarget: CurrentTarget?,
    windows: [Window],
    problems: [String]
  ) {
    self.build = build
    self.update = update
    self.summary = summary
    self.currentTarget = currentTarget
    self.windows = windows
    self.problems = problems
  }
}

public struct SupatermTreeSnapshot: Equatable, Sendable, Codable {
  public struct Window: Equatable, Sendable, Codable {
    public let index: Int
    public let isKey: Bool
    public let spaces: [Space]

    public init(index: Int, isKey: Bool, spaces: [Space]) {
      self.index = index
      self.isKey = isKey
      self.spaces = spaces
    }
  }

  public struct Space: Equatable, Sendable, Codable {
    public let index: Int
    public let name: String
    public let isSelected: Bool
    public let tabs: [Tab]

    public init(
      index: Int,
      name: String,
      isSelected: Bool,
      tabs: [Tab]
    ) {
      self.index = index
      self.name = name
      self.isSelected = isSelected
      self.tabs = tabs
    }
  }

  public struct Tab: Equatable, Sendable, Codable {
    public let index: Int
    public let title: String
    public let isSelected: Bool
    public let panes: [Pane]

    public init(index: Int, title: String, isSelected: Bool, panes: [Pane]) {
      self.index = index
      self.title = title
      self.isSelected = isSelected
      self.panes = panes
    }
  }

  public struct Pane: Equatable, Sendable, Codable {
    public let index: Int
    public let isFocused: Bool

    public init(index: Int, isFocused: Bool) {
      self.index = index
      self.isFocused = isFocused
    }
  }

  public let windows: [Window]

  public init(windows: [Window]) {
    self.windows = windows
  }
}

public struct SupatermOnboardingShortcut: Equatable, Sendable, Codable {
  public let shortcut: String
  public let title: String

  public init(
    shortcut: String,
    title: String
  ) {
    self.shortcut = shortcut
    self.title = title
  }
}

public struct SupatermOnboardingSnapshot: Equatable, Sendable, Codable {
  public let items: [SupatermOnboardingShortcut]

  public init(items: [SupatermOnboardingShortcut]) {
    self.items = items
  }
}

public enum SupatermPaneDirection: String, CaseIterable, Sendable, Codable {
  case down
  case left
  case right
  case up
}

public struct SupatermNewTabRequest: Equatable, Sendable, Codable {
  public let command: String?
  public let contextPaneID: UUID?
  public let cwd: String?
  public let focus: Bool
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?

  public init(
    command: String? = nil,
    contextPaneID: UUID? = nil,
    cwd: String? = nil,
    focus: Bool,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil
  ) {
    self.command = command
    self.contextPaneID = contextPaneID
    self.cwd = cwd
    self.focus = focus
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
  }
}

public struct SupatermNewTabResult: Equatable, Sendable, Codable {
  public let isFocused: Bool
  public let isSelectedSpace: Bool
  public let isSelectedTab: Bool
  public let windowIndex: Int
  public let spaceIndex: Int
  public let tabIndex: Int
  public let paneIndex: Int

  public init(
    isFocused: Bool,
    isSelectedSpace: Bool,
    isSelectedTab: Bool,
    windowIndex: Int,
    spaceIndex: Int,
    tabIndex: Int,
    paneIndex: Int
  ) {
    self.isFocused = isFocused
    self.isSelectedSpace = isSelectedSpace
    self.isSelectedTab = isSelectedTab
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.tabIndex = tabIndex
    self.paneIndex = paneIndex
  }
}

public struct SupatermNewPaneRequest: Equatable, Sendable, Codable {
  public let command: String?
  public let contextPaneID: UUID?
  public let direction: SupatermPaneDirection
  public let focus: Bool
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?
  public let targetTabIndex: Int?
  public let targetPaneIndex: Int?

  public init(
    command: String? = nil,
    contextPaneID: UUID? = nil,
    direction: SupatermPaneDirection,
    focus: Bool,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil,
    targetTabIndex: Int? = nil,
    targetPaneIndex: Int? = nil
  ) {
    self.command = command
    self.contextPaneID = contextPaneID
    self.direction = direction
    self.focus = focus
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
    self.targetTabIndex = targetTabIndex
    self.targetPaneIndex = targetPaneIndex
  }
}

public struct SupatermNewPaneResult: Equatable, Sendable, Codable {
  public let direction: SupatermPaneDirection
  public let isFocused: Bool
  public let isSelectedTab: Bool
  public let windowIndex: Int
  public let spaceIndex: Int
  public let tabIndex: Int
  public let paneIndex: Int

  public init(
    direction: SupatermPaneDirection,
    isFocused: Bool,
    isSelectedTab: Bool,
    windowIndex: Int,
    spaceIndex: Int,
    tabIndex: Int,
    paneIndex: Int
  ) {
    self.direction = direction
    self.isFocused = isFocused
    self.isSelectedTab = isSelectedTab
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.tabIndex = tabIndex
    self.paneIndex = paneIndex
  }
}

private func decodeJSONObject<T: Decodable>(
  _ object: JSONObject,
  as type: T.Type
) throws -> T {
  let encoder = JSONEncoder()
  let decoder = JSONDecoder()
  let data = try encoder.encode(object)
  return try decoder.decode(type, from: data)
}

extension JSONObject {
  fileprivate init<T: Encodable>(_ value: T) throws {
    let jsonValue = try JSONValue(value)
    guard case .object(let object) = jsonValue else {
      throw SupatermSocketProtocolError.payloadMustBeJSONObject
    }
    self = object
  }
}
