import Foundation

public enum SupatermSocketMethod {
  public static let appOnboarding = "app.onboarding"
  public static let appDebug = "app.debug"
  public static let appTree = "app.tree"
  public static let systemIdentity = "system.identity"
  public static let systemPing = "system.ping"
  public static let terminalAgentHook = "terminal.agent_hook"
  public static let terminalCapturePane = "terminal.capture_pane"
  public static let terminalClosePane = "terminal.close_pane"
  public static let terminalCloseSpace = "terminal.close_space"
  public static let terminalCloseTab = "terminal.close_tab"
  public static let terminalCreateSpace = "terminal.create_space"
  public static let terminalEqualizePanes = "terminal.equalize_panes"
  public static let terminalFocusPane = "terminal.focus_pane"
  public static let terminalLastPane = "terminal.last_pane"
  public static let terminalLastSpace = "terminal.last_space"
  public static let terminalLastTab = "terminal.last_tab"
  public static let terminalNewTab = "terminal.new_tab"
  public static let terminalNewPane = "terminal.new_pane"
  public static let terminalNextSpace = "terminal.next_space"
  public static let terminalNextTab = "terminal.next_tab"
  public static let terminalNotify = "terminal.notify"
  public static let terminalPreviousSpace = "terminal.previous_space"
  public static let terminalPreviousTab = "terminal.previous_tab"
  public static let terminalRenameSpace = "terminal.rename_space"
  public static let terminalRenameTab = "terminal.rename_tab"
  public static let terminalResizePane = "terminal.resize_pane"
  public static let terminalSelectSpace = "terminal.select_space"
  public static let terminalSelectTab = "terminal.select_tab"
  public static let terminalSendText = "terminal.send_text"
  public static let terminalTilePanes = "terminal.tile_panes"
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

  public static func notify(
    _ payload: SupatermNotifyRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalNotify,
      params: try JSONObject(payload)
    )
  }

  public static func agentHook(
    _ payload: SupatermAgentHookRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalAgentHook,
      params: try JSONObject(payload)
    )
  }

  public static func capturePane(
    _ payload: SupatermCapturePaneRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalCapturePane,
      params: try JSONObject(payload)
    )
  }

  public static func closePane(
    _ payload: SupatermPaneTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalClosePane,
      params: try JSONObject(payload)
    )
  }

  public static func closeSpace(
    _ payload: SupatermSpaceTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalCloseSpace,
      params: try JSONObject(payload)
    )
  }

  public static func closeTab(
    _ payload: SupatermTabTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalCloseTab,
      params: try JSONObject(payload)
    )
  }

  public static func createSpace(
    _ payload: SupatermCreateSpaceRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalCreateSpace,
      params: try JSONObject(payload)
    )
  }

  public static func focusPane(
    _ payload: SupatermPaneTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalFocusPane,
      params: try JSONObject(payload)
    )
  }

  public static func equalizePanes(
    _ payload: SupatermTabTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalEqualizePanes,
      params: try JSONObject(payload)
    )
  }

  public static func tilePanes(
    _ payload: SupatermTabTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalTilePanes,
      params: try JSONObject(payload)
    )
  }

  public static func lastSpace(
    _ payload: SupatermSpaceNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalLastSpace,
      params: try JSONObject(payload)
    )
  }

  public static func lastPane(
    _ payload: SupatermPaneTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalLastPane,
      params: try JSONObject(payload)
    )
  }

  public static func lastTab(
    _ payload: SupatermTabNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalLastTab,
      params: try JSONObject(payload)
    )
  }

  public static func nextSpace(
    _ payload: SupatermSpaceNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalNextSpace,
      params: try JSONObject(payload)
    )
  }

  public static func nextTab(
    _ payload: SupatermTabNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalNextTab,
      params: try JSONObject(payload)
    )
  }

  public static func previousSpace(
    _ payload: SupatermSpaceNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalPreviousSpace,
      params: try JSONObject(payload)
    )
  }

  public static func previousTab(
    _ payload: SupatermTabNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalPreviousTab,
      params: try JSONObject(payload)
    )
  }

  public static func renameSpace(
    _ payload: SupatermRenameSpaceRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalRenameSpace,
      params: try JSONObject(payload)
    )
  }

  public static func renameTab(
    _ payload: SupatermRenameTabRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalRenameTab,
      params: try JSONObject(payload)
    )
  }

  public static func resizePane(
    _ payload: SupatermResizePaneRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalResizePane,
      params: try JSONObject(payload)
    )
  }

  public static func selectSpace(
    _ payload: SupatermSpaceTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalSelectSpace,
      params: try JSONObject(payload)
    )
  }

  public static func selectTab(
    _ payload: SupatermTabTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalSelectTab,
      params: try JSONObject(payload)
    )
  }

  public static func sendText(
    _ payload: SupatermSendTextRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    Self(
      id: id,
      method: SupatermSocketMethod.terminalSendText,
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
    public let panes: [Pane]

    public init(index: Int, id: UUID, title: String, isSelected: Bool, panes: [Pane]) {
      self.index = index
      self.id = id
      self.title = title
      self.isSelected = isSelected
      self.panes = panes
    }
  }

  public struct Pane: Equatable, Sendable, Codable {
    public let index: Int
    public let id: UUID
    public let isFocused: Bool

    public init(index: Int, id: UUID, isFocused: Bool) {
      self.index = index
      self.id = id
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
  public let spaceID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let paneIndex: Int
  public let paneID: UUID

  public init(
    isFocused: Bool,
    isSelectedSpace: Bool,
    isSelectedTab: Bool,
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    tabIndex: Int,
    tabID: UUID,
    paneIndex: Int,
    paneID: UUID
  ) {
    self.isFocused = isFocused
    self.isSelectedSpace = isSelectedSpace
    self.isSelectedTab = isSelectedTab
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.paneIndex = paneIndex
    self.paneID = paneID
  }
}

public enum SupatermNotificationAttentionState: String, Equatable, Sendable, Codable {
  case unread
}

public enum SupatermDesktopNotificationDisposition: String, Equatable, Sendable, Codable {
  case deliver
  case suppressAgent
  case suppressFocused

  public var shouldDeliver: Bool {
    self == .deliver
  }
}

public struct SupatermNotifyRequest: Equatable, Sendable, Codable {
  public let body: String
  public let contextPaneID: UUID?
  public let subtitle: String
  public let targetPaneIndex: Int?
  public let targetSpaceIndex: Int?
  public let targetTabIndex: Int?
  public let targetWindowIndex: Int?
  public let title: String?

  public init(
    body: String = "",
    contextPaneID: UUID? = nil,
    subtitle: String = "",
    targetPaneIndex: Int? = nil,
    targetSpaceIndex: Int? = nil,
    targetTabIndex: Int? = nil,
    targetWindowIndex: Int? = nil,
    title: String? = nil
  ) {
    self.body = body
    self.contextPaneID = contextPaneID
    self.subtitle = subtitle
    self.targetPaneIndex = targetPaneIndex
    self.targetSpaceIndex = targetSpaceIndex
    self.targetTabIndex = targetTabIndex
    self.targetWindowIndex = targetWindowIndex
    self.title = Self.normalizedTitle(title)
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      body: try container.decodeIfPresent(String.self, forKey: .body) ?? "",
      contextPaneID: try container.decodeIfPresent(UUID.self, forKey: .contextPaneID),
      subtitle: try container.decodeIfPresent(String.self, forKey: .subtitle) ?? "",
      targetPaneIndex: try container.decodeIfPresent(Int.self, forKey: .targetPaneIndex),
      targetSpaceIndex: try container.decodeIfPresent(Int.self, forKey: .targetSpaceIndex),
      targetTabIndex: try container.decodeIfPresent(Int.self, forKey: .targetTabIndex),
      targetWindowIndex: try container.decodeIfPresent(Int.self, forKey: .targetWindowIndex),
      title: try container.decodeIfPresent(String.self, forKey: .title)
    )
  }

  private enum CodingKeys: String, CodingKey {
    case body
    case contextPaneID
    case subtitle
    case targetPaneIndex
    case targetSpaceIndex
    case targetTabIndex
    case targetWindowIndex
    case title
  }

  private static func normalizedTitle(_ title: String?) -> String? {
    let title = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return title.isEmpty ? nil : title
  }
}

public struct SupatermNewPaneRequest: Equatable, Sendable, Codable {
  public let command: String?
  public let contextPaneID: UUID?
  public let direction: SupatermPaneDirection
  public let focus: Bool
  public let equalize: Bool
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?
  public let targetTabIndex: Int?
  public let targetPaneIndex: Int?

  public init(
    command: String? = nil,
    contextPaneID: UUID? = nil,
    direction: SupatermPaneDirection,
    focus: Bool,
    equalize: Bool,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil,
    targetTabIndex: Int? = nil,
    targetPaneIndex: Int? = nil
  ) {
    self.command = command
    self.contextPaneID = contextPaneID
    self.direction = direction
    self.focus = focus
    self.equalize = equalize
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
    self.targetTabIndex = targetTabIndex
    self.targetPaneIndex = targetPaneIndex
  }
}

public struct SupatermSpaceTargetRequest: Equatable, Sendable, Codable {
  public let contextPaneID: UUID?
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?

  public init(
    contextPaneID: UUID? = nil,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil
  ) {
    self.contextPaneID = contextPaneID
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
  }
}

public struct SupatermTabTargetRequest: Equatable, Sendable, Codable {
  public let contextPaneID: UUID?
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?
  public let targetTabIndex: Int?

  public init(
    contextPaneID: UUID? = nil,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil,
    targetTabIndex: Int? = nil
  ) {
    self.contextPaneID = contextPaneID
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
    self.targetTabIndex = targetTabIndex
  }
}

public struct SupatermPaneTargetRequest: Equatable, Sendable, Codable {
  public let contextPaneID: UUID?
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?
  public let targetTabIndex: Int?
  public let targetPaneIndex: Int?

  public init(
    contextPaneID: UUID? = nil,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil,
    targetTabIndex: Int? = nil,
    targetPaneIndex: Int? = nil
  ) {
    self.contextPaneID = contextPaneID
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
    self.targetTabIndex = targetTabIndex
    self.targetPaneIndex = targetPaneIndex
  }
}

public struct SupatermSendTextRequest: Equatable, Sendable, Codable {
  public let target: SupatermPaneTargetRequest
  public let text: String

  public init(
    target: SupatermPaneTargetRequest,
    text: String
  ) {
    self.target = target
    self.text = text
  }
}

public enum SupatermCapturePaneScope: String, Equatable, Sendable, Codable {
  case scrollback
  case visible
}

public struct SupatermCapturePaneRequest: Equatable, Sendable, Codable {
  public let lines: Int?
  public let scope: SupatermCapturePaneScope
  public let target: SupatermPaneTargetRequest

  public init(
    lines: Int? = nil,
    scope: SupatermCapturePaneScope = .visible,
    target: SupatermPaneTargetRequest
  ) {
    self.lines = lines
    self.scope = scope
    self.target = target
  }
}

public enum SupatermResizePaneDirection: String, Equatable, Sendable, Codable {
  case down
  case left
  case right
  case up
}

public struct SupatermResizePaneRequest: Equatable, Sendable, Codable {
  public let amount: UInt16
  public let direction: SupatermResizePaneDirection
  public let target: SupatermPaneTargetRequest

  public init(
    amount: UInt16,
    direction: SupatermResizePaneDirection,
    target: SupatermPaneTargetRequest
  ) {
    self.amount = amount
    self.direction = direction
    self.target = target
  }
}

public struct SupatermRenameTabRequest: Equatable, Sendable, Codable {
  public let target: SupatermTabTargetRequest
  public let title: String?

  public init(
    target: SupatermTabTargetRequest,
    title: String?
  ) {
    self.target = target
    self.title = title?.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

public struct SupatermCreateSpaceRequest: Equatable, Sendable, Codable {
  public let name: String?
  public let target: SupatermSpaceNavigationRequest

  public init(
    name: String? = nil,
    target: SupatermSpaceNavigationRequest = .init()
  ) {
    self.name = name?.trimmingCharacters(in: .whitespacesAndNewlines)
    self.target = target
  }
}

public struct SupatermRenameSpaceRequest: Equatable, Sendable, Codable {
  public let target: SupatermSpaceTargetRequest
  public let name: String

  public init(
    target: SupatermSpaceTargetRequest,
    name: String
  ) {
    self.target = target
    self.name = name
  }
}

public struct SupatermSpaceNavigationRequest: Equatable, Sendable, Codable {
  public let contextPaneID: UUID?
  public let targetWindowIndex: Int?

  public init(
    contextPaneID: UUID? = nil,
    targetWindowIndex: Int? = nil
  ) {
    self.contextPaneID = contextPaneID
    self.targetWindowIndex = targetWindowIndex
  }
}

public struct SupatermTabNavigationRequest: Equatable, Sendable, Codable {
  public let contextPaneID: UUID?
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?

  public init(
    contextPaneID: UUID? = nil,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil
  ) {
    self.contextPaneID = contextPaneID
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
  }
}

public struct SupatermNotifyResult: Equatable, Sendable, Codable {
  public let attentionState: SupatermNotificationAttentionState
  public let desktopNotificationDisposition: SupatermDesktopNotificationDisposition
  public let resolvedTitle: String
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let paneIndex: Int
  public let paneID: UUID

  public init(
    attentionState: SupatermNotificationAttentionState,
    desktopNotificationDisposition: SupatermDesktopNotificationDisposition,
    resolvedTitle: String,
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    tabIndex: Int,
    tabID: UUID,
    paneIndex: Int,
    paneID: UUID
  ) {
    self.attentionState = attentionState
    self.desktopNotificationDisposition = desktopNotificationDisposition
    self.resolvedTitle = resolvedTitle
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.paneIndex = paneIndex
    self.paneID = paneID
  }
}

public struct SupatermSpaceTarget: Equatable, Sendable, Codable {
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID
  public let name: String

  public init(
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    name: String
  ) {
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.name = name
  }
}

public struct SupatermTabTarget: Equatable, Sendable, Codable {
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let title: String

  public init(
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    tabIndex: Int,
    tabID: UUID,
    title: String
  ) {
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.title = title
  }
}

public struct SupatermPaneTarget: Equatable, Sendable, Codable {
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let paneIndex: Int
  public let paneID: UUID

  public init(
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    tabIndex: Int,
    tabID: UUID,
    paneIndex: Int,
    paneID: UUID
  ) {
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.paneIndex = paneIndex
    self.paneID = paneID
  }
}

public struct SupatermFocusPaneResult: Equatable, Sendable, Codable {
  public let isFocused: Bool
  public let isSelectedTab: Bool
  public let target: SupatermPaneTarget

  public init(
    isFocused: Bool,
    isSelectedTab: Bool,
    target: SupatermPaneTarget
  ) {
    self.isFocused = isFocused
    self.isSelectedTab = isSelectedTab
    self.target = target
  }
}

public struct SupatermSelectTabResult: Equatable, Sendable, Codable {
  public let isFocused: Bool
  public let isSelectedSpace: Bool
  public let isSelectedTab: Bool
  public let isTitleLocked: Bool
  public let paneIndex: Int
  public let paneID: UUID
  public let target: SupatermTabTarget

  public init(
    isFocused: Bool,
    isSelectedSpace: Bool,
    isSelectedTab: Bool,
    isTitleLocked: Bool,
    paneIndex: Int,
    paneID: UUID,
    target: SupatermTabTarget
  ) {
    self.isFocused = isFocused
    self.isSelectedSpace = isSelectedSpace
    self.isSelectedTab = isSelectedTab
    self.isTitleLocked = isTitleLocked
    self.paneIndex = paneIndex
    self.paneID = paneID
    self.target = target
  }
}

public struct SupatermSelectSpaceResult: Equatable, Sendable, Codable {
  public let isFocused: Bool
  public let isSelectedSpace: Bool
  public let isSelectedTab: Bool
  public let paneIndex: Int
  public let paneID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let target: SupatermSpaceTarget

  public init(
    isFocused: Bool,
    isSelectedSpace: Bool,
    isSelectedTab: Bool,
    paneIndex: Int,
    paneID: UUID,
    tabIndex: Int,
    tabID: UUID,
    target: SupatermSpaceTarget
  ) {
    self.isFocused = isFocused
    self.isSelectedSpace = isSelectedSpace
    self.isSelectedTab = isSelectedTab
    self.paneIndex = paneIndex
    self.paneID = paneID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.target = target
  }
}

public struct SupatermCapturePaneResult: Equatable, Sendable, Codable {
  public let target: SupatermPaneTarget
  public let text: String

  public init(
    target: SupatermPaneTarget,
    text: String
  ) {
    self.target = target
    self.text = text
  }
}

public struct SupatermRenameTabResult: Equatable, Sendable, Codable {
  public let isTitleLocked: Bool
  public let target: SupatermTabTarget

  public init(
    isTitleLocked: Bool,
    target: SupatermTabTarget
  ) {
    self.isTitleLocked = isTitleLocked
    self.target = target
  }
}

public typealias SupatermClosePaneResult = SupatermPaneTarget
public typealias SupatermCloseSpaceResult = SupatermSpaceTarget
public typealias SupatermCloseTabResult = SupatermTabTarget
public typealias SupatermCreateSpaceResult = SupatermSelectSpaceResult
public typealias SupatermEqualizePanesResult = SupatermTabTarget
public typealias SupatermResizePaneResult = SupatermPaneTarget
public typealias SupatermSendTextResult = SupatermPaneTarget
public typealias SupatermTilePanesResult = SupatermTabTarget

public struct SupatermNewPaneResult: Equatable, Sendable, Codable {
  public let direction: SupatermPaneDirection
  public let isFocused: Bool
  public let isSelectedTab: Bool
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let paneIndex: Int
  public let paneID: UUID

  public init(
    direction: SupatermPaneDirection,
    isFocused: Bool,
    isSelectedTab: Bool,
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    tabIndex: Int,
    tabID: UUID,
    paneIndex: Int,
    paneID: UUID
  ) {
    self.direction = direction
    self.isFocused = isFocused
    self.isSelectedTab = isSelectedTab
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.paneIndex = paneIndex
    self.paneID = paneID
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
