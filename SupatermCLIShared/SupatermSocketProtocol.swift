import Foundation

public enum SupatermSocketMethod {
  public static let appTree = "app.tree"
  public static let systemPing = "system.ping"
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

  public static func tree(id: String = UUID().uuidString) -> Self {
    Self(id: id, method: SupatermSocketMethod.appTree)
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

public struct SupatermTreeSnapshot: Equatable, Sendable, Codable {
  public struct Window: Equatable, Sendable, Codable {
    public let index: Int
    public let isKey: Bool
    public let tabs: [Tab]

    public init(index: Int, isKey: Bool, tabs: [Tab]) {
      self.index = index
      self.isKey = isKey
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

public enum SupatermPaneDirection: String, CaseIterable, Sendable, Codable {
  case down
  case left
  case right
  case up
}

public struct SupatermNewPaneRequest: Equatable, Sendable, Codable {
  public let command: String?
  public let contextPaneID: UUID?
  public let direction: SupatermPaneDirection
  public let focus: Bool
  public let targetPaneIndex: Int?
  public let targetTabIndex: Int?
  public let targetWindowIndex: Int?

  public init(
    command: String? = nil,
    contextPaneID: UUID? = nil,
    direction: SupatermPaneDirection,
    focus: Bool,
    targetPaneIndex: Int? = nil,
    targetTabIndex: Int? = nil,
    targetWindowIndex: Int? = nil
  ) {
    self.command = command
    self.contextPaneID = contextPaneID
    self.direction = direction
    self.focus = focus
    self.targetPaneIndex = targetPaneIndex
    self.targetTabIndex = targetTabIndex
    self.targetWindowIndex = targetWindowIndex
  }
}

public struct SupatermNewPaneResult: Equatable, Sendable, Codable {
  public let direction: SupatermPaneDirection
  public let isFocused: Bool
  public let isSelectedTab: Bool
  public let paneIndex: Int
  public let tabIndex: Int
  public let windowIndex: Int

  public init(
    direction: SupatermPaneDirection,
    isFocused: Bool,
    isSelectedTab: Bool,
    paneIndex: Int,
    tabIndex: Int,
    windowIndex: Int
  ) {
    self.direction = direction
    self.isFocused = isFocused
    self.isSelectedTab = isSelectedTab
    self.paneIndex = paneIndex
    self.tabIndex = tabIndex
    self.windowIndex = windowIndex
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
