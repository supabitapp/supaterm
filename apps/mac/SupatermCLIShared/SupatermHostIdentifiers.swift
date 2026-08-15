import Foundation

public protocol SupatermUUIDIdentifier: Hashable, Identifiable, Codable, Sendable
where ID == Self {
  var rawValue: UUID { get }
  init(rawValue: UUID)
}

extension SupatermUUIDIdentifier {
  public init() {
    self.init(rawValue: UUID())
  }

  public var id: Self { self }

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    let value = try container.decode(String.self)
    guard let rawValue = UUID(uuidString: value) else {
      throw DecodingError.dataCorruptedError(
        in: container,
        debugDescription: "Invalid identifier"
      )
    }
    self.init(rawValue: rawValue)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(rawValue.uuidString.lowercased())
  }
}

public nonisolated struct TerminalID: SupatermUUIDIdentifier {
  public let rawValue: UUID

  public init(rawValue: UUID) {
    self.rawValue = rawValue
  }
}

public nonisolated struct MachineID: SupatermUUIDIdentifier {
  public let rawValue: UUID

  public init(rawValue: UUID) {
    self.rawValue = rawValue
  }
}

public nonisolated struct BootID: SupatermUUIDIdentifier {
  public let rawValue: UUID

  public init(rawValue: UUID) {
    self.rawValue = rawValue
  }
}

public nonisolated struct AttachmentID: SupatermUUIDIdentifier {
  public let rawValue: UUID

  public init(rawValue: UUID) {
    self.rawValue = rawValue
  }
}

public nonisolated struct ClientID: SupatermUUIDIdentifier {
  public let rawValue: UUID

  public init(rawValue: UUID) {
    self.rawValue = rawValue
  }
}

public nonisolated struct HostRequestID: SupatermUUIDIdentifier {
  public let rawValue: UUID

  public init(rawValue: UUID) {
    self.rawValue = rawValue
  }
}
