import Foundation

public let supatermHostProtocolVersion: UInt16 = 1
public let supatermHostPreface = Data([0x53, 0x55, 0x50, 0x41, 0x48, 0x4f, 0x53, 0x54, 0x00, 0x01, 0x00, 0x00])
public let supatermHostMaximumControlPayload = 16 * 1024 * 1024
public let supatermHostMaximumTerminalPayload = 64 * 1024

public enum HostFrameKind: UInt8, Codable, Equatable, Sendable {
  case clientControl = 1
  case hostControl = 2
  case terminalInput = 3
  case terminalOutput = 4
  case terminalSnapshot = 5

  public var maximumPayload: Int {
    switch self {
    case .clientControl, .hostControl:
      supatermHostMaximumControlPayload
    case .terminalInput, .terminalOutput, .terminalSnapshot:
      supatermHostMaximumTerminalPayload
    }
  }

  public var usesControlStream: Bool {
    self == .clientControl || self == .hostControl
  }
}

public enum HostFrameDirection: Equatable, Sendable {
  case clientToHost
  case hostToClient
}

public struct HostFrame: Equatable, Sendable {
  public let kind: HostFrameKind
  public let streamID: UInt32
  public let payload: Data

  public init(kind: HostFrameKind, streamID: UInt32, payload: Data) throws {
    guard kind.usesControlStream == (streamID == 0) else {
      throw HostProtocolFailure.invalidStream
    }
    guard payload.count <= kind.maximumPayload else {
      throw HostProtocolFailure.oversizedPayload
    }
    self.kind = kind
    self.streamID = streamID
    self.payload = payload
  }

  public func encoded(includePreface: Bool = false) -> Data {
    var data = includePreface ? supatermHostPreface : Data()
    data.append(kind.rawValue)
    data.appendInteger(streamID)
    data.appendInteger(UInt32(payload.count))
    data.append(payload)
    return data
  }
}

public struct HostFrameDecoder: Sendable {
  private let direction: HostFrameDirection
  private var data = Data()
  private var offset = 0
  private var receivedPreface = false

  public init(direction: HostFrameDirection = .hostToClient) {
    self.direction = direction
  }

  public mutating func append(_ bytes: Data) throws -> [HostFrame] {
    data.append(bytes)
    var frames: [HostFrame] = []
    while let frame = try decodeOne() {
      frames.append(frame)
    }
    compact()
    return frames
  }

  private mutating func decodeOne() throws -> HostFrame? {
    if !receivedPreface {
      guard data.count - offset >= supatermHostPreface.count else { return nil }
      guard data[offset..<(offset + supatermHostPreface.count)] == supatermHostPreface else {
        throw HostProtocolFailure.invalidPreface
      }
      offset += supatermHostPreface.count
      receivedPreface = true
    }
    guard data.count - offset >= 9 else { return nil }
    guard let kind = HostFrameKind(rawValue: data[offset]) else {
      throw HostProtocolFailure.unknownFrame
    }
    let validDirection =
      switch direction {
      case .clientToHost:
        kind == .clientControl || kind == .terminalInput
      case .hostToClient:
        kind == .hostControl || kind == .terminalOutput || kind == .terminalSnapshot
      }
    guard validDirection else {
      throw HostProtocolFailure.invalidDirection
    }
    let streamID: UInt32 = data.integer(at: offset + 1)
    let length: UInt32 = data.integer(at: offset + 5)
    guard kind.usesControlStream == (streamID == 0) else {
      throw HostProtocolFailure.invalidStream
    }
    guard Int(length) <= kind.maximumPayload else {
      throw HostProtocolFailure.oversizedPayload
    }
    guard data.count - offset >= 9 + Int(length) else { return nil }
    let payloadStart = offset + 9
    let payload = Data(data[payloadStart..<(payloadStart + Int(length))])
    offset = payloadStart + Int(length)
    return try HostFrame(kind: kind, streamID: streamID, payload: payload)
  }

  private mutating func compact() {
    guard offset > 0, offset == data.count || offset >= 64 * 1024 else { return }
    data = offset == data.count ? Data() : Data(data[offset...])
    offset = 0
  }
}

public enum HostJSONValue: Codable, Equatable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([HostJSONValue])
  case object([String: HostJSONValue])

  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([HostJSONValue].self) {
      self = .array(value)
    } else {
      self = .object(try container.decode([String: HostJSONValue].self))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null:
      try container.encodeNil()
    case .bool(let value):
      try container.encode(value)
    case .number(let value):
      try container.encode(value)
    case .string(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    }
  }

  public func decode<Value: Decodable>(_ type: Value.Type = Value.self) throws -> Value {
    try HostWireCodec.decoder.decode(type, from: HostWireCodec.encoder.encode(self))
  }

  public static func encode<Value: Encodable>(_ value: Value) throws -> HostJSONValue {
    try HostWireCodec.decoder.decode(HostJSONValue.self, from: HostWireCodec.encoder.encode(value))
  }
}

public struct HostBuildIdentity: Codable, Equatable, Sendable {
  public let version: String
  public let fingerprint: String

  public init(version: String, fingerprint: String) {
    self.version = version
    self.fingerprint = fingerprint
  }
}

public enum HostClientRole: String, Codable, Equatable, Sendable {
  case ui
  case cli
  case hook
  case bridge
}

public struct HostLimits: Codable, Equatable, Sendable {
  public let maximumSnapshotBytes: UInt64
  public let maximumContinuationBytes: UInt64

  public init(
    maximumSnapshotBytes: UInt64 = 64 * 1024 * 1024,
    maximumContinuationBytes: UInt64 = 16 * 1024 * 1024
  ) {
    self.maximumSnapshotBytes = maximumSnapshotBytes
    self.maximumContinuationBytes = maximumContinuationBytes
  }
}

public enum HostClientControl: Encodable, Equatable, Sendable {
  case hello(
    build: HostBuildIdentity,
    role: HostClientRole,
    clientID: HostClientID?,
    capabilities: [String],
    limits: HostLimits
  )
  case request(commandID: HostCommandID, method: String, params: HostJSONValue)

  private enum CodingKeys: String, CodingKey {
    case type
    case protocolVersion
    case build
    case role
    case clientID
    case capabilities
    case limits
    case commandID
    case method
    case params
  }

  private enum Kind: String, Encodable {
    case hello
    case request
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .hello(let build, let role, let clientID, let capabilities, let limits):
      try container.encode(Kind.hello, forKey: .type)
      try container.encode(supatermHostProtocolVersion, forKey: .protocolVersion)
      try container.encode(build, forKey: .build)
      try container.encode(role, forKey: .role)
      try container.encodeIfPresent(clientID, forKey: .clientID)
      try container.encode(capabilities, forKey: .capabilities)
      try container.encode(limits, forKey: .limits)
    case .request(let commandID, let method, let params):
      try container.encode(Kind.request, forKey: .type)
      try container.encode(commandID, forKey: .commandID)
      try container.encode(method, forKey: .method)
      try container.encode(params, forKey: .params)
    }
  }
}

public struct HostWelcome: Codable, Equatable, Sendable {
  public let protocolVersion: UInt16
  public let build: HostBuildIdentity
  public let hostID: HostID
  public let epoch: UUID
  public let revision: UInt64
  public let structureRevision: UInt64
  public let capabilities: [String]
  public let limits: HostLimits
}

public enum HostProtocolErrorCode: String, Codable, Equatable, Sendable {
  case protocolMismatch = "protocol_mismatch"
  case helloRequired = "hello_required"
  case unexpectedHello = "unexpected_hello"
  case invalidRequest = "invalid_request"
  case methodNotFound = "method_not_found"
  case permissionDenied = "permission_denied"
  case staleStructure = "stale_structure"
  case resyncRequired = "resync_required"
  case ambiguousTarget = "ambiguous_target"
  case notFound = "not_found"
  case confirmationRequired = "confirmation_required"
  case capabilityUnavailable = "capability_unavailable"
  case `internal`
}

public struct HostProtocolError: Codable, Equatable, Sendable, Error {
  public let code: HostProtocolErrorCode
  public let details: HostJSONValue
  public let retryable: Bool
}

public enum HostControl: Decodable, Equatable, Sendable {
  case welcome(HostWelcome)
  case result(commandID: HostCommandID, result: HostJSONValue)
  case error(commandID: HostCommandID?, error: HostProtocolError)
  case terminal(streamID: UInt32, event: HostTerminalControl)
  case state(HostSubscription)

  private enum CodingKeys: String, CodingKey {
    case type
    case protocolVersion
    case build
    case hostID
    case epoch
    case revision
    case structureRevision
    case capabilities
    case limits
    case commandID
    case result
    case error
    case streamID
    case event
    case subscription
  }

  private enum Kind: String, Decodable {
    case welcome
    case result
    case error
    case terminal
    case state
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .type) {
    case .welcome:
      self = .welcome(
        HostWelcome(
          protocolVersion: try container.decode(UInt16.self, forKey: .protocolVersion),
          build: try container.decode(HostBuildIdentity.self, forKey: .build),
          hostID: try container.decode(HostID.self, forKey: .hostID),
          epoch: try container.decode(UUID.self, forKey: .epoch),
          revision: try container.decode(UInt64.self, forKey: .revision),
          structureRevision: try container.decode(UInt64.self, forKey: .structureRevision),
          capabilities: try container.decode([String].self, forKey: .capabilities),
          limits: try container.decode(HostLimits.self, forKey: .limits)
        )
      )
    case .result:
      self = .result(
        commandID: try container.decode(HostCommandID.self, forKey: .commandID),
        result: try container.decode(HostJSONValue.self, forKey: .result)
      )
    case .error:
      self = .error(
        commandID: try container.decodeIfPresent(HostCommandID.self, forKey: .commandID),
        error: try container.decode(HostProtocolError.self, forKey: .error)
      )
    case .terminal:
      self = .terminal(
        streamID: try container.decode(UInt32.self, forKey: .streamID),
        event: try container.decode(HostTerminalControl.self, forKey: .event)
      )
    case .state:
      self = .state(try container.decode(HostSubscription.self, forKey: .subscription))
    }
  }
}

public enum HostSnapshotEncoding: String, Codable, Equatable, Sendable {
  case ghosttyV1 = "ghostty_v1"
}

public enum HostTerminalControl: Decodable, Equatable, Sendable {
  case attached(snapshotID: UUID, boundary: UInt64)
  case snapshotBegin(
    snapshotID: UUID,
    boundary: UInt64,
    encoding: HostSnapshotEncoding,
    declaredLength: UInt64,
    limit: UInt64
  )
  case snapshotEnd(snapshotID: UUID, totalLength: UInt64, sha256: [UInt8])
  case ready(nextSequence: UInt64)
  case exited(code: Int32?, signal: Int32?)

  private enum CodingKeys: String, CodingKey {
    case type
    case snapshotID
    case boundary
    case encoding
    case declaredLength
    case limit
    case totalLength
    case sha256
    case nextSequence
    case code
    case signal
  }

  private enum Kind: String, Decodable {
    case attached
    case snapshotBegin = "snapshot_begin"
    case snapshotEnd = "snapshot_end"
    case ready
    case exited
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .type) {
    case .attached:
      self = .attached(
        snapshotID: try container.decode(UUID.self, forKey: .snapshotID),
        boundary: try container.decode(UInt64.self, forKey: .boundary)
      )
    case .snapshotBegin:
      self = .snapshotBegin(
        snapshotID: try container.decode(UUID.self, forKey: .snapshotID),
        boundary: try container.decode(UInt64.self, forKey: .boundary),
        encoding: try container.decode(HostSnapshotEncoding.self, forKey: .encoding),
        declaredLength: try container.decode(UInt64.self, forKey: .declaredLength),
        limit: try container.decode(UInt64.self, forKey: .limit)
      )
    case .snapshotEnd:
      self = .snapshotEnd(
        snapshotID: try container.decode(UUID.self, forKey: .snapshotID),
        totalLength: try container.decode(UInt64.self, forKey: .totalLength),
        sha256: try container.decode([UInt8].self, forKey: .sha256)
      )
    case .ready:
      self = .ready(nextSequence: try container.decode(UInt64.self, forKey: .nextSequence))
    case .exited:
      self = .exited(
        code: try container.decodeIfPresent(Int32.self, forKey: .code),
        signal: try container.decodeIfPresent(Int32.self, forKey: .signal)
      )
    }
  }
}

public enum HostTerminalEvent: Equatable, Sendable {
  case control(HostTerminalControl)
  case snapshotChunk(snapshotID: UUID, offset: UInt64, bytes: Data)
  case output(sequence: UInt64, bytes: Data)
}

public enum HostWireCodec {
  public static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    return encoder
  }()

  public static let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .custom { path in
      let key = path.last?.stringValue ?? ""
      let components = key.split(separator: "_")
      guard components.count > 1 else { return HostCodingKey(key) }
      let decoded = components.dropFirst().reduce(String(components[0])) { result, component in
        switch component {
        case "id":
          result + "ID"
        case "ids":
          result + "IDs"
        default:
          result + component.prefix(1).uppercased() + component.dropFirst()
        }
      }
      return HostCodingKey(decoded)
    }
    return decoder
  }()

  public static func encode(_ control: HostClientControl) throws -> Data {
    try encoder.encode(control)
  }

  public static func decode(_ data: Data) throws -> HostControl {
    guard String(data: data, encoding: .utf8) != nil else {
      throw HostProtocolFailure.invalidUTF8
    }
    return try decoder.decode(HostControl.self, from: data)
  }
}

private struct HostCodingKey: CodingKey {
  let stringValue: String
  let intValue: Int?

  init(_ stringValue: String) {
    self.stringValue = stringValue
    intValue = nil
  }

  init?(stringValue: String) {
    self.init(stringValue)
  }

  init?(intValue: Int) {
    stringValue = String(intValue)
    self.intValue = intValue
  }
}

public enum HostProtocolFailure: Error, Equatable, Sendable {
  case invalidPreface
  case unknownFrame
  case invalidDirection
  case invalidStream
  case oversizedPayload
  case invalidUTF8
  case malformedTerminalPayload
  case unexpectedControl
}

extension Data {
  mutating func appendInteger<Integer: FixedWidthInteger>(_ value: Integer) {
    var value = value.bigEndian
    Swift.withUnsafeBytes(of: &value) { append(contentsOf: $0) }
  }

  func integer<Integer: FixedWidthInteger>(at offset: Int) -> Integer {
    self[offset..<(offset + MemoryLayout<Integer>.size)].withUnsafeBytes {
      Integer(bigEndian: $0.loadUnaligned(as: Integer.self))
    }
  }
}
