import Foundation

public enum SupatermSocketMethod {
  public static let appOnboarding = "app.onboarding"
  public static let appDebug = "app.debug"
  public static let appQuit = "app.quit"
  public static let appSettingsGet = "app.settings.get"
  public static let appSettingsList = "app.settings.list"
  public static let appSettingsReset = "app.settings.reset"
  public static let appSettingsSet = "app.settings.set"
  public static let appTree = "app.tree"
  public static let systemIdentity = "system.identity"
  public static let systemPing = "system.ping"
  public static let terminalAgentHook = "terminal.agent_hook"
  public static let terminalCapturePane = "terminal.capture_pane"
  public static let terminalClosePane = "terminal.close_pane"
  public static let terminalCloseSpace = "terminal.close_space"
  public static let terminalCloseTab = "terminal.close_tab"
  public static let terminalCloseTabGroup = "terminal.close_tab_group"
  public static let terminalCreateSpace = "terminal.create_space"
  public static let terminalCreateTabGroup = "terminal.create_tab_group"
  public static let terminalEqualizePanes = "terminal.equalize_panes"
  public static let terminalFocusPane = "terminal.focus_pane"
  public static let terminalLastPane = "terminal.last_pane"
  public static let terminalLastSpace = "terminal.last_space"
  public static let terminalLastTab = "terminal.last_tab"
  public static let terminalMainVerticalPanes = "terminal.main_vertical_panes"
  public static let terminalMoveTab = "terminal.move_tab"
  public static let terminalMoveTabGroup = "terminal.move_tab_group"
  public static let terminalNewTab = "terminal.new_tab"
  public static let terminalNewPane = "terminal.new_pane"
  public static let terminalPaneHealth = "terminal.pane_health"
  public static let terminalNextSpace = "terminal.next_space"
  public static let terminalNextTab = "terminal.next_tab"
  public static let terminalNotify = "terminal.notify"
  public static let terminalPinTab = "terminal.pin_tab"
  public static let terminalPinTabGroup = "terminal.pin_tab_group"
  public static let terminalPreviousSpace = "terminal.previous_space"
  public static let terminalPreviousTab = "terminal.previous_tab"
  public static let terminalRenameSpace = "terminal.rename_space"
  public static let terminalRenameTab = "terminal.rename_tab"
  public static let terminalRenameTabGroup = "terminal.rename_tab_group"
  public static let terminalResizePane = "terminal.resize_pane"
  public static let terminalSelectSpace = "terminal.select_space"
  public static let terminalSelectTab = "terminal.select_tab"
  public static let terminalSetPaneSize = "terminal.set_pane_size"
  public static let terminalSetTabGroupColor = "terminal.set_tab_group_color"
  public static let terminalCollapseTabGroup = "terminal.collapse_tab_group"
  public static let terminalExpandTabGroup = "terminal.expand_tab_group"
  public static let terminalSendKey = "terminal.send_key"
  public static let terminalSendText = "terminal.send_text"
  public static let terminalTilePanes = "terminal.tile_panes"
  public static let terminalUnpinTab = "terminal.unpin_tab"
  public static let terminalUnpinTabGroup = "terminal.unpin_tab_group"
  public static let terminalUngroupTabGroup = "terminal.ungroup_tab_group"
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

  private static func make(
    _ method: String,
    _ payload: some Encodable,
    id: String
  ) throws -> Self {
    Self(id: id, method: method, params: try JSONObject(payload))
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

  public static func quit(id: String = UUID().uuidString) -> Self {
    Self(id: id, method: SupatermSocketMethod.appQuit)
  }

  public static func debug(
    _ payload: SupatermDebugRequest = .init(),
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.appDebug, payload, id: id)
  }

  public static func settingsList(
    _ payload: SupatermSettingsListRequest = .init(),
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.appSettingsList, payload, id: id)
  }

  public static func settingsGet(
    _ payload: SupatermSettingsGetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.appSettingsGet, payload, id: id)
  }

  public static func settingsSet(
    _ payload: SupatermSettingsSetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.appSettingsSet, payload, id: id)
  }

  public static func settingsReset(
    _ payload: SupatermSettingsResetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.appSettingsReset, payload, id: id)
  }

  public static func newPane(
    _ payload: SupatermNewPaneRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalNewPane, payload, id: id)
  }

  public static func newTab(
    _ payload: SupatermNewTabRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalNewTab, payload, id: id)
  }

  public static func notify(
    _ payload: SupatermNotifyRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalNotify, payload, id: id)
  }

  public static func agentHook(
    _ payload: SupatermAgentHookRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalAgentHook, payload, id: id)
  }

  public static func capturePane(
    _ payload: SupatermCapturePaneRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalCapturePane, payload, id: id)
  }

  public static func paneHealth(
    _ payload: SupatermPaneHealthRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalPaneHealth, payload, id: id)
  }

  public static func closePane(
    _ payload: SupatermPaneTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalClosePane, payload, id: id)
  }

  public static func closeSpace(
    _ payload: SupatermSpaceTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalCloseSpace, payload, id: id)
  }

  public static func closeTab(
    _ payload: SupatermTabTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalCloseTab, payload, id: id)
  }

  public static func closeTabGroup(
    _ payload: SupatermTabGroupTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalCloseTabGroup, payload, id: id)
  }

  public static func createTabGroup(
    _ payload: SupatermCreateTabGroupRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalCreateTabGroup, payload, id: id)
  }

  public static func createSpace(
    _ payload: SupatermCreateSpaceRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalCreateSpace, payload, id: id)
  }

  public static func focusPane(
    _ payload: SupatermPaneTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalFocusPane, payload, id: id)
  }

  public static func equalizePanes(
    _ payload: SupatermTabTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalEqualizePanes, payload, id: id)
  }

  public static func tilePanes(
    _ payload: SupatermTabTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalTilePanes, payload, id: id)
  }

  public static func mainVerticalPanes(
    _ payload: SupatermTabTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalMainVerticalPanes, payload, id: id)
  }

  public static func moveTab(
    _ payload: SupatermMoveTabRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalMoveTab, payload, id: id)
  }

  public static func moveTabGroup(
    _ payload: SupatermMoveTabGroupRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalMoveTabGroup, payload, id: id)
  }

  public static func pinTabGroup(
    _ payload: SupatermTabGroupTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalPinTabGroup, payload, id: id)
  }

  public static func lastSpace(
    _ payload: SupatermSpaceNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalLastSpace, payload, id: id)
  }

  public static func lastPane(
    _ payload: SupatermPaneTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalLastPane, payload, id: id)
  }

  public static func lastTab(
    _ payload: SupatermTabNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalLastTab, payload, id: id)
  }

  public static func nextSpace(
    _ payload: SupatermSpaceNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalNextSpace, payload, id: id)
  }

  public static func nextTab(
    _ payload: SupatermTabNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalNextTab, payload, id: id)
  }

  public static func pinTab(
    _ payload: SupatermTabTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalPinTab, payload, id: id)
  }

  public static func previousSpace(
    _ payload: SupatermSpaceNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalPreviousSpace, payload, id: id)
  }

  public static func previousTab(
    _ payload: SupatermTabNavigationRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalPreviousTab, payload, id: id)
  }

  public static func renameSpace(
    _ payload: SupatermRenameSpaceRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalRenameSpace, payload, id: id)
  }

  public static func renameTab(
    _ payload: SupatermRenameTabRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalRenameTab, payload, id: id)
  }

  public static func renameTabGroup(
    _ payload: SupatermRenameTabGroupRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalRenameTabGroup, payload, id: id)
  }

  public static func setTabGroupColor(
    _ payload: SupatermSetTabGroupColorRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalSetTabGroupColor, payload, id: id)
  }

  public static func collapseTabGroup(
    _ payload: SupatermTabGroupTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalCollapseTabGroup, payload, id: id)
  }

  public static func expandTabGroup(
    _ payload: SupatermTabGroupTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalExpandTabGroup, payload, id: id)
  }

  public static func resizePane(
    _ payload: SupatermResizePaneRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalResizePane, payload, id: id)
  }

  public static func selectSpace(
    _ payload: SupatermSpaceTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalSelectSpace, payload, id: id)
  }

  public static func selectTab(
    _ payload: SupatermTabTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalSelectTab, payload, id: id)
  }

  public static func setPaneSize(
    _ payload: SupatermSetPaneSizeRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalSetPaneSize, payload, id: id)
  }

  public static func sendText(
    _ payload: SupatermSendTextRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalSendText, payload, id: id)
  }

  public static func sendKey(
    _ payload: SupatermSendKeyRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalSendKey, payload, id: id)
  }

  public static func unpinTab(
    _ payload: SupatermTabTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalUnpinTab, payload, id: id)
  }

  public static func ungroupTabGroup(
    _ payload: SupatermTabGroupTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalUngroupTabGroup, payload, id: id)
  }

  public static func unpinTabGroup(
    _ payload: SupatermTabGroupTargetRequest,
    id: String = UUID().uuidString
  ) throws -> Self {
    try make(SupatermSocketMethod.terminalUnpinTabGroup, payload, id: id)
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
