import Foundation
import SupatermHostClient
import Testing

struct HostClientProtocolTests {
  @Test
  func rustGoldenHelloDecodesAcrossEveryFragmentBoundary() throws {
    let fixture = try HostWireCodec.decoder.decode(
      HelloFixture.self,
      from: Data(contentsOf: fixtureURL("protocol-v1-hello.json"))
    )
    let wire = try hexData(fixture.wireHex)

    for boundary in 0...wire.count {
      var decoder = HostFrameDecoder(direction: .clientToHost)
      let first = try decoder.append(Data(wire.prefix(boundary)))
      let second = try decoder.append(Data(wire.dropFirst(boundary)))
      let frame = try #require((first + second).only)
      #expect(frame.kind == .clientControl)
      #expect(frame.streamID == 0)
      let json = try #require(
        JSONSerialization.jsonObject(with: frame.payload) as? [String: Any]
      )
      #expect(json["type"] as? String == "hello")
      #expect(json["protocol_version"] as? Int == 1)
    }
  }

  @Test
  @MainActor
  func rustGoldenStateReplacesThenAppliesAuthoritativeRecords() throws {
    let fixture = try HostWireCodec.decoder.decode(
      StateFixture.self,
      from: Data(contentsOf: fixtureURL("protocol-v1-state.json"))
    )
    let projection = HostProjection()

    try projection.apply(fixture.subscription)
    #expect(projection.state?.revision == 7)
    #expect(projection.state?.workspace.spaces.map(\.name) == ["Space 1"])

    try projection.apply(.replay([fixture.mutation]))
    #expect(projection.state?.revision == 9)
    #expect(
      projection.state?.paneFacts[
        "88888888-8888-4888-8888-888888888888"
      ]?.title == "updated"
    )
  }

  @Test
  func frameDecoderRejectsWrongDirectionAndOversizeFromHeader() throws {
    let control = try HostFrame(kind: .clientControl, streamID: 0, payload: Data())
    var wrongDirection = HostFrameDecoder()
    #expect(throws: HostProtocolFailure.invalidDirection) {
      _ = try wrongDirection.append(control.encoded(includePreface: true))
    }

    var bytes = supatermHostPreface
    bytes.append(HostFrameKind.terminalOutput.rawValue)
    bytes.append(contentsOf: [0, 0, 0, 1])
    bytes.append(contentsOf: [0, 1, 0, 1])
    var oversized = HostFrameDecoder()
    #expect(throws: HostProtocolFailure.oversizedPayload) {
      _ = try oversized.append(bytes)
    }
  }

  @Test
  func semanticCommandUsesRustTaggedShape() throws {
    let paneID = try #require(UUID(uuidString: "88888888-8888-4888-8888-888888888888"))
    let value = try HostJSONValue.encode(HostWorkspaceCommand.closePane(paneID: paneID))

    #expect(
      value
        == .object([
          "type": .string("close_pane"),
          "pane_id": .string(paneID.uuidString),
        ])
    )
  }

  private struct HelloFixture: Decodable {
    let wireHex: String
  }

  private struct StateFixture: Decodable {
    let subscription: HostSubscription
    let mutation: HostMutationEvent
  }

  private func fixtureURL(_ name: String) -> URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appending(path: "supaterm-host/tests/fixtures")
      .appending(path: name)
  }

  private func hexData(_ value: String) throws -> Data {
    guard value.count.isMultiple(of: 2) else { throw FixtureError.invalidHex }
    var data = Data()
    var index = value.startIndex
    while index < value.endIndex {
      let next = value.index(index, offsetBy: 2)
      guard let byte = UInt8(value[index..<next], radix: 16) else {
        throw FixtureError.invalidHex
      }
      data.append(byte)
      index = next
    }
    return data
  }

  private enum FixtureError: Error {
    case invalidHex
  }
}

extension Collection {
  fileprivate var only: Element? {
    count == 1 ? first : nil
  }
}
