import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermHostFrameCodecTests {
  private let codec = SupatermHostFrameCodec()

  @Test
  func frameUsesTwoBigEndianLengthsAndRoundTrips() throws {
    let envelope = SupatermHostClientEnvelope(
      role: .test,
      requestID: try requestID("123e4567-e89b-12d3-a456-426614174002"),
      body: .list
    )
    let frame = try codec.encode(envelope)
    let payloadLength = frame.count - MemoryLayout<UInt32>.size
    let jsonLength = decodeLength(frame.dropFirst(4).prefix(4))
    let json = frame.dropFirst(8).prefix(jsonLength)

    #expect(Array(frame.prefix(4)) == UInt32(payloadLength).bigEndianBytes)
    #expect(Array(frame.dropFirst(4).prefix(4)) == UInt32(jsonLength).bigEndianBytes)
    #expect(jsonLength == payloadLength - MemoryLayout<UInt32>.size)
    #expect(try JSONSerialization.jsonObject(with: Data(json)) is NSDictionary)
    #expect(try codec.decode(SupatermHostClientEnvelope.self, from: frame) == envelope)
  }

  @Test
  func inputUsesRawBinarySuffixWithoutJSONDataKey() throws {
    let binary = Data([0, 255, 0x7b, 0x22, 0, 10, 13])
    let envelope = SupatermHostClientEnvelope(
      role: .test,
      requestID: try requestID("123e4567-e89b-12d3-a456-426614174002"),
      body: .input(
        terminalID: try terminalID("123e4567-e89b-12d3-a456-426614174000"),
        attachmentID: try attachmentID("123e4567-e89b-12d3-a456-426614174001"),
        sequence: 9,
        data: binary
      )
    )
    let frame = try codec.encode(envelope)
    let jsonLength = decodeLength(frame.dropFirst(4).prefix(4))
    let json = Data(frame.dropFirst(8).prefix(jsonLength))
    let suffix = Data(frame.dropFirst(8 + jsonLength))
    let object = try #require(
      JSONSerialization.jsonObject(with: json) as? [String: Any]
    )
    let body = try #require(object["body"] as? [String: Any])

    #expect(body["data"] == nil)
    #expect(suffix == binary)
    #expect(try codec.decode(SupatermHostClientEnvelope.self, from: frame) == envelope)
  }

  @Test
  func hostBinarySlotsRoundTripArbitraryBytes() throws {
    let requestID = try requestID("123e4567-e89b-12d3-a456-426614174002")
    let terminalID = try terminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = try attachmentID("123e4567-e89b-12d3-a456-426614174001")
    let data = Data([0, 255, 1, 254, 0, 0, 0, 4, 0x7b, 0x7d])
    let values = [
      SupatermHostEnvelope(
        requestID: requestID,
        body: .attachReplay(attachmentID: attachmentID, segment: .vt, data: data)
      ),
      SupatermHostEnvelope(
        requestID: nil,
        body: .output(
          terminalID: terminalID,
          attachmentID: attachmentID,
          sequence: 19,
          data: data
        )
      ),
    ]

    for value in values {
      let frame = try codec.encode(value)
      let jsonLength = decodeLength(frame.dropFirst(4).prefix(4))
      let json = Data(frame.dropFirst(8).prefix(jsonLength))
      let suffix = Data(frame.dropFirst(8 + jsonLength))
      #expect(!json.contains(Data("\"data\"".utf8)))
      #expect(suffix == data)
      #expect(try codec.decode(SupatermHostEnvelope.self, from: frame) == value)
    }
  }

  @Test
  func decoderRejectsInvalidOuterAndJSONLengths() throws {
    #expect(throws: SupatermHostFrameCodecError.invalidHeaderLength(3)) {
      try codec.decodePayloadLength(Data([0, 0, 1]))
    }
    #expect(throws: SupatermHostFrameCodecError.invalidPayloadLength(0)) {
      try codec.decodePayloadLength(Data([0, 0, 0, 0]))
    }
    #expect(throws: SupatermHostFrameCodecError.invalidPayloadLength(3)) {
      try codec.decodePayloadLength(Data([0, 0, 0, 3]))
    }

    let oversize = UInt32(supatermHostMaximumFrameBytes + 1)
    #expect(
      throws: SupatermHostFrameCodecError.invalidPayloadLength(Int(oversize))
    ) {
      try codec.decodePayloadLength(Data(oversize.bigEndianBytes))
    }

    let envelope = SupatermHostClientEnvelope(
      role: .test,
      requestID: HostRequestID(),
      body: .list
    )
    var zeroJSONLength = try codec.encode(envelope)
    zeroJSONLength.replaceSubrange(4..<8, with: UInt32(0).bigEndianBytes)
    #expect(throws: SupatermHostFrameCodecError.invalidJSONLength(0)) {
      try codec.decode(SupatermHostClientEnvelope.self, from: zeroJSONLength)
    }

    var oversizedJSONLength = try codec.encode(envelope)
    let payloadLength = oversizedJSONLength.count - 4
    oversizedJSONLength.replaceSubrange(
      4..<8,
      with: UInt32(payloadLength).bigEndianBytes
    )
    #expect(throws: SupatermHostFrameCodecError.invalidJSONLength(payloadLength)) {
      try codec.decode(SupatermHostClientEnvelope.self, from: oversizedJSONLength)
    }
  }

  @Test
  func decoderRejectsIncompleteAndTrailingFrames() throws {
    let envelope = SupatermHostClientEnvelope(
      role: .test,
      requestID: HostRequestID(),
      body: .list
    )
    let frame = try codec.encode(envelope)

    #expect(
      throws: SupatermHostFrameCodecError.incompleteFrame(
        expected: frame.count,
        actual: frame.count - 1
      )
    ) {
      try codec.decode(SupatermHostClientEnvelope.self, from: frame.dropLast())
    }
    #expect(throws: SupatermHostFrameCodecError.trailingFrameBytes(1)) {
      try codec.decode(
        SupatermHostClientEnvelope.self,
        from: frame + Data([0])
      )
    }
  }

  @Test
  func codecEnforcesBinarySlotsAndChunkLimit() throws {
    let terminalID = try terminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = try attachmentID("123e4567-e89b-12d3-a456-426614174001")
    let oversized = Data(
      repeating: 0,
      count: supatermHostMaximumTerminalDataBytes + 1
    )
    let output = SupatermHostEnvelope(
      requestID: nil,
      body: .output(
        terminalID: terminalID,
        attachmentID: attachmentID,
        sequence: 0,
        data: oversized
      )
    )
    #expect(
      throws: SupatermHostFrameCodecError.binaryDataLength(oversized.count)
    ) {
      try codec.encode(output)
    }

    let list = SupatermHostClientEnvelope(
      role: .test,
      requestID: HostRequestID(),
      body: .list
    )
    var unexpectedBinary = try codec.encode(list)
    unexpectedBinary.append(0xff)
    unexpectedBinary.replaceSubrange(
      0..<4,
      with: UInt32(unexpectedBinary.count - 4).bigEndianBytes
    )
    #expect(throws: SupatermHostFrameCodecError.unexpectedBinaryData(1)) {
      try codec.decode(SupatermHostClientEnvelope.self, from: unexpectedBinary)
    }

    let input = SupatermHostClientEnvelope(
      role: .test,
      requestID: HostRequestID(),
      body: .input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        sequence: 0,
        data: Data([1])
      )
    )
    let inputFrame = try codec.encode(input)
    let inputJSONLength = decodeLength(inputFrame.dropFirst(4).prefix(4))
    let binaryStart = 8 + inputJSONLength
    var missingSuffix = inputFrame
    missingSuffix.removeSubrange(binaryStart...)
    missingSuffix.replaceSubrange(
      0..<4,
      with: UInt32(missingSuffix.count - 4).bigEndianBytes
    )
    #expect(throws: SupatermHostFrameCodecError.binaryDataLength(0)) {
      try codec.decode(SupatermHostClientEnvelope.self, from: missingSuffix)
    }

    var oversizedSuffix = inputFrame
    oversizedSuffix.replaceSubrange(binaryStart..., with: oversized)
    oversizedSuffix.replaceSubrange(
      0..<4,
      with: UInt32(oversizedSuffix.count - 4).bigEndianBytes
    )
    #expect(
      throws: SupatermHostFrameCodecError.binaryDataLength(oversized.count)
    ) {
      try codec.decode(SupatermHostClientEnvelope.self, from: oversizedSuffix)
    }
  }

  @Test
  func decoderRejectsEscapedDuplicateObjectKeys() throws {
    let json = Data(
      #"""
      {
        "body": {
          "type": "input",
          "terminalId": "123e4567-e89b-12d3-a456-426614174000",
          "attachmentId": "123e4567-e89b-12d3-a456-426614174001",
          "sequence": 9,
          "s\u0065quence": 9
        },
        "epoch": 2,
        "requestId": "123e4567-e89b-12d3-a456-426614174002",
        "role": "test"
      }
      """#.utf8
    )
    let binary = Data([1])
    var frame = Data(UInt32(4 + json.count + binary.count).bigEndianBytes)
    frame.append(contentsOf: UInt32(json.count).bigEndianBytes)
    frame.append(json)
    frame.append(binary)

    #expect(
      throws: SupatermHostFrameCodecError.duplicateJSONKey("sequence")
    ) {
      try codec.decode(SupatermHostClientEnvelope.self, from: frame)
    }
  }
}

private func decodeLength<Bytes: DataProtocol>(_ bytes: Bytes) -> Int {
  Int(
    bytes.reduce(UInt32.zero) { partial, byte in
      (partial << 8) | UInt32(byte)
    })
}

private func requestID(_ value: String) throws -> HostRequestID {
  HostRequestID(rawValue: try uuid(value))
}

private func terminalID(_ value: String) throws -> TerminalID {
  TerminalID(rawValue: try uuid(value))
}

private func attachmentID(_ value: String) throws -> AttachmentID {
  AttachmentID(rawValue: try uuid(value))
}

private func uuid(_ value: String) throws -> UUID {
  try #require(UUID(uuidString: value))
}

extension UInt32 {
  fileprivate var bigEndianBytes: [UInt8] {
    let value = bigEndian
    return withUnsafeBytes(of: value) { Array($0) }
  }
}
