import Foundation

public enum SupatermHostFrameCodecError: Error, Equatable, Sendable {
  case invalidHeaderLength(Int)
  case invalidPayloadLength(Int)
  case invalidJSONLength(Int)
  case binaryDataLength(Int)
  case unexpectedBinaryData(Int)
  case duplicateJSONKey(String)
  case incompleteFrame(expected: Int, actual: Int)
  case trailingFrameBytes(Int)
}

public struct SupatermHostFrameCodec: Sendable {
  private let lengthSize = MemoryLayout<UInt32>.size

  public init() {}

  public func encode(_ value: SupatermHostClientEnvelope) throws -> Data {
    let binary: Data?
    if case .input(_, _, _, let data) = value.body {
      binary = data
    } else {
      binary = nil
    }
    return try encode(value, binary: binary)
  }

  public func encode(_ value: SupatermHostEnvelope) throws -> Data {
    let binary: Data?
    switch value.body {
    case .attachReplay(_, _, let data), .output(_, _, _, let data):
      binary = data
    default:
      binary = nil
    }
    return try encode(value, binary: binary)
  }

  public func decode(
    _ type: SupatermHostClientEnvelope.Type,
    from frame: Data
  ) throws -> SupatermHostClientEnvelope {
    let (value, binary) = try decodeFrame(type, from: frame)
    return try injecting(binary, into: value)
  }

  public func decode(
    _ type: SupatermHostEnvelope.Type,
    from frame: Data
  ) throws -> SupatermHostEnvelope {
    let (value, binary) = try decodeFrame(type, from: frame)
    return try injecting(binary, into: value)
  }

  public func decodePayload(
    _ type: SupatermHostClientEnvelope.Type,
    from payload: Data
  ) throws -> SupatermHostClientEnvelope {
    let (value, binary) = try decodePayloadValue(type, from: payload)
    return try injecting(binary, into: value)
  }

  public func decodePayload(
    _ type: SupatermHostEnvelope.Type,
    from payload: Data
  ) throws -> SupatermHostEnvelope {
    let (value, binary) = try decodePayloadValue(type, from: payload)
    return try injecting(binary, into: value)
  }

  public func decodePayloadLength(_ header: Data) throws -> Int {
    guard header.count == lengthSize else {
      throw SupatermHostFrameCodecError.invalidHeaderLength(header.count)
    }
    let payloadLength = decodeLength(header)
    guard payloadLength >= lengthSize, payloadLength <= supatermHostMaximumFrameBytes else {
      throw SupatermHostFrameCodecError.invalidPayloadLength(payloadLength)
    }
    return payloadLength
  }

  private func encode<Value: Encodable>(_ value: Value, binary: Data?) throws -> Data {
    if let binary {
      guard !binary.isEmpty, binary.count <= supatermHostMaximumTerminalDataBytes else {
        throw SupatermHostFrameCodecError.binaryDataLength(binary.count)
      }
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let json = try encoder.encode(value)
    let (controlLength, controlOverflow) = lengthSize.addingReportingOverflow(json.count)
    let (payloadLength, payloadOverflow) = controlLength.addingReportingOverflow(
      binary?.count ?? 0
    )
    guard
      !json.isEmpty,
      !controlOverflow,
      !payloadOverflow,
      payloadLength <= supatermHostMaximumFrameBytes
    else {
      throw SupatermHostFrameCodecError.invalidPayloadLength(payloadLength)
    }

    var frame = encodedLength(payloadLength)
    frame.append(encodedLength(json.count))
    frame.append(json)
    if let binary {
      frame.append(binary)
    }
    return frame
  }

  private func decodeFrame<Value: Decodable>(
    _ type: Value.Type,
    from frame: Data
  ) throws -> (Value, Data) {
    guard frame.count >= lengthSize else {
      throw SupatermHostFrameCodecError.invalidHeaderLength(frame.count)
    }
    let payloadLength = try decodePayloadLength(Data(frame.prefix(lengthSize)))
    let expectedCount = lengthSize + payloadLength
    guard frame.count >= expectedCount else {
      throw SupatermHostFrameCodecError.incompleteFrame(
        expected: expectedCount,
        actual: frame.count
      )
    }
    guard frame.count == expectedCount else {
      throw SupatermHostFrameCodecError.trailingFrameBytes(frame.count - expectedCount)
    }
    return try decodePayloadValue(type, from: Data(frame.dropFirst(lengthSize)))
  }

  private func decodePayloadValue<Value: Decodable>(
    _ type: Value.Type,
    from payload: Data
  ) throws -> (Value, Data) {
    guard
      payload.count >= lengthSize,
      payload.count <= supatermHostMaximumFrameBytes
    else {
      throw SupatermHostFrameCodecError.invalidPayloadLength(payload.count)
    }
    let jsonLength = decodeLength(payload.prefix(lengthSize))
    let remainingLength = payload.count - lengthSize
    guard jsonLength > 0, jsonLength <= remainingLength else {
      throw SupatermHostFrameCodecError.invalidJSONLength(jsonLength)
    }
    let binaryLength = remainingLength - jsonLength
    guard binaryLength <= supatermHostMaximumTerminalDataBytes else {
      throw SupatermHostFrameCodecError.binaryDataLength(binaryLength)
    }
    let jsonStart = payload.index(payload.startIndex, offsetBy: lengthSize)
    let binaryStart = payload.index(jsonStart, offsetBy: jsonLength)
    let json = Data(payload[jsonStart..<binaryStart])
    let binary = Data(payload[binaryStart...])
    let value = try JSONDecoder().decode(type, from: json)
    var scanner = SupatermHostJSONKeyScanner(data: json)
    try scanner.validate()
    return (value, binary)
  }

  private func injecting(
    _ binary: Data,
    into value: SupatermHostClientEnvelope
  ) throws -> SupatermHostClientEnvelope {
    let body: SupatermHostRequest
    switch value.body {
    case .input(let terminalID, let attachmentID, let sequence, _):
      guard !binary.isEmpty else {
        throw SupatermHostFrameCodecError.binaryDataLength(0)
      }
      body = .input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        sequence: sequence,
        data: binary
      )
    default:
      guard binary.isEmpty else {
        throw SupatermHostFrameCodecError.unexpectedBinaryData(binary.count)
      }
      body = value.body
    }
    return SupatermHostClientEnvelope(
      epoch: value.epoch,
      role: value.role,
      requestID: value.requestID,
      body: body
    )
  }

  private func injecting(
    _ binary: Data,
    into value: SupatermHostEnvelope
  ) throws -> SupatermHostEnvelope {
    let body: SupatermHostMessage
    switch value.body {
    case .attachReplay(let attachmentID, let segment, _):
      guard !binary.isEmpty else {
        throw SupatermHostFrameCodecError.binaryDataLength(0)
      }
      body = .attachReplay(attachmentID: attachmentID, segment: segment, data: binary)
    case .output(let terminalID, let attachmentID, let sequence, _):
      guard !binary.isEmpty else {
        throw SupatermHostFrameCodecError.binaryDataLength(0)
      }
      body = .output(
        terminalID: terminalID,
        attachmentID: attachmentID,
        sequence: sequence,
        data: binary
      )
    default:
      guard binary.isEmpty else {
        throw SupatermHostFrameCodecError.unexpectedBinaryData(binary.count)
      }
      body = value.body
    }
    return SupatermHostEnvelope(
      epoch: value.epoch,
      role: value.role,
      requestID: value.requestID,
      body: body
    )
  }

  private func encodedLength(_ value: Int) -> Data {
    var length = UInt32(value).bigEndian
    return withUnsafeBytes(of: &length) { Data($0) }
  }

  private func decodeLength<Bytes: DataProtocol>(_ bytes: Bytes) -> Int {
    Int(
      bytes.reduce(UInt32.zero) { partial, byte in
        (partial << 8) | UInt32(byte)
      })
  }
}

private struct SupatermHostJSONKeyScanner {
  private let bytes: [UInt8]
  private var index = 0

  init(data: Data) {
    bytes = Array(data)
  }

  mutating func validate() throws {
    skipWhitespace()
    try scanValue()
    skipWhitespace()
    guard index == bytes.count else {
      throw invalidJSON()
    }
  }

  private mutating func scanValue() throws {
    guard index < bytes.count else {
      throw invalidJSON()
    }
    switch bytes[index] {
    case 0x7b:
      try scanObject()
    case 0x5b:
      try scanArray()
    case 0x22:
      _ = try scanString()
    default:
      try scanPrimitive()
    }
  }

  private mutating func scanObject() throws {
    index += 1
    skipWhitespace()
    if consume(0x7d) {
      return
    }
    var keys: Set<String> = []
    while true {
      skipWhitespace()
      let key = try scanString()
      guard keys.insert(key).inserted else {
        throw SupatermHostFrameCodecError.duplicateJSONKey(key)
      }
      skipWhitespace()
      try require(0x3a)
      skipWhitespace()
      try scanValue()
      skipWhitespace()
      if consume(0x2c) {
        continue
      }
      try require(0x7d)
      return
    }
  }

  private mutating func scanArray() throws {
    index += 1
    skipWhitespace()
    if consume(0x5d) {
      return
    }
    while true {
      try scanValue()
      skipWhitespace()
      if consume(0x2c) {
        skipWhitespace()
        continue
      }
      try require(0x5d)
      return
    }
  }

  private mutating func scanString() throws -> String {
    guard index < bytes.count, bytes[index] == 0x22 else {
      throw invalidJSON()
    }
    let start = index
    index += 1
    while index < bytes.count {
      switch bytes[index] {
      case 0x22:
        index += 1
        return try JSONDecoder().decode(String.self, from: Data(bytes[start..<index]))
      case 0x5c:
        index += 2
      default:
        index += 1
      }
    }
    throw invalidJSON()
  }

  private mutating func scanPrimitive() throws {
    let start = index
    while index < bytes.count, !isValueDelimiter(bytes[index]) {
      index += 1
    }
    guard index > start else {
      throw invalidJSON()
    }
  }

  private mutating func skipWhitespace() {
    while index < bytes.count, isWhitespace(bytes[index]) {
      index += 1
    }
  }

  private mutating func consume(_ byte: UInt8) -> Bool {
    guard index < bytes.count, bytes[index] == byte else {
      return false
    }
    index += 1
    return true
  }

  private mutating func require(_ byte: UInt8) throws {
    guard consume(byte) else {
      throw invalidJSON()
    }
  }

  private func isWhitespace(_ byte: UInt8) -> Bool {
    byte == 0x20 || byte == 0x09 || byte == 0x0a || byte == 0x0d
  }

  private func isValueDelimiter(_ byte: UInt8) -> Bool {
    isWhitespace(byte) || byte == 0x2c || byte == 0x5d || byte == 0x7d
  }

  private func invalidJSON() -> DecodingError {
    DecodingError.dataCorrupted(
      DecodingError.Context(
        codingPath: [],
        debugDescription: "host JSON structure is invalid"
      )
    )
  }
}
