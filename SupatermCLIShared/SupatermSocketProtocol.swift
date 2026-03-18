import Foundation

public enum SupatermSocketMethod {
  public static let systemPing = "system.ping"
}

public enum SupatermSocketValue: Equatable, Sendable, Codable {
  case array([Self])
  case bool(Bool)
  case null
  case number(Double)
  case object([String: Self])
  case string(String)

  public var boolValue: Bool? {
    guard case .bool(let value) = self else { return nil }
    return value
  }

  public var objectValue: [String: Self]? {
    guard case .object(let value) = self else { return nil }
    return value
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let boolValue = try? container.decode(Bool.self) {
      self = .bool(boolValue)
    } else if let doubleValue = try? container.decode(Double.self) {
      self = .number(doubleValue)
    } else if let stringValue = try? container.decode(String.self) {
      self = .string(stringValue)
    } else if let arrayValue = try? container.decode([Self].self) {
      self = .array(arrayValue)
    } else {
      self = .object(try container.decode([String: Self].self))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .array(let value):
      try container.encode(value)
    case .bool(let value):
      try container.encode(value)
    case .null:
      try container.encodeNil()
    case .number(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    case .string(let value):
      try container.encode(value)
    }
  }
}

public struct SupatermSocketRequest: Equatable, Sendable, Codable {
  public let id: String
  public let method: String
  public let params: [String: SupatermSocketValue]

  public init(
    id: String,
    method: String,
    params: [String: SupatermSocketValue] = [:]
  ) {
    self.id = id
    self.method = method
    self.params = params
  }

  public static func ping(id: String = UUID().uuidString) -> Self {
    Self(id: id, method: SupatermSocketMethod.systemPing)
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
  public let result: [String: SupatermSocketValue]?
  public let error: ErrorPayload?

  public init(
    id: String?,
    ok: Bool,
    result: [String: SupatermSocketValue]? = nil,
    error: ErrorPayload? = nil
  ) {
    self.id = id
    self.ok = ok
    self.result = result
    self.error = error
  }

  public static func ok(
    id: String,
    result: [String: SupatermSocketValue] = [:]
  ) -> Self {
    Self(id: id, ok: true, result: result)
  }

  public static func error(
    id: String? = nil,
    code: String,
    message: String
  ) -> Self {
    Self(id: id, ok: false, error: .init(code: code, message: message))
  }
}
