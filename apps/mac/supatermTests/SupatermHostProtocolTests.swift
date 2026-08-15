import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermHostProtocolTests {
  @Test
  func clientCreateMatchesRustJSON() throws {
    let envelope = SupatermHostClientEnvelope(
      role: .test,
      requestID: try hostRequestID("123e4567-e89b-12d3-a456-426614174002"),
      body: .create(
        terminalID: try terminalID("123e4567-e89b-12d3-a456-426614174000"),
        command: SupatermHostCommand(
          argv: ["/bin/sh", "-c", "printf ok"],
          cwd: "/tmp/working directory",
          environment: SupatermHostEnvironmentSpec(
            inherit: false,
            set: ["B": "two", "A": "one"],
            remove: ["SECRET"]
          )
        ),
        size: SupatermHostTerminalSize(
          rows: 41,
          cols: 103,
          pixelWidth: 721,
          pixelHeight: 533
        )
      )
    )

    let actual = try jsonObject(envelope)
    let expected = try jsonObject(
      """
      {
        "epoch": 2,
        "role": "test",
        "requestId": "123e4567-e89b-12d3-a456-426614174002",
        "body": {
          "type": "create",
          "terminalId": "123e4567-e89b-12d3-a456-426614174000",
          "command": {
            "argv": ["/bin/sh", "-c", "printf ok"],
            "cwd": "/tmp/working directory",
            "environment": {
              "inherit": false,
              "set": {"A": "one", "B": "two"},
              "remove": ["SECRET"]
            }
          },
          "size": {
            "rows": 41,
            "cols": 103,
            "pixelWidth": 721,
            "pixelHeight": 533
          }
        }
      }
      """
    )
    #expect(actual == expected)
  }

  @Test
  func attachRequestMatchesRustJSON() throws {
    let envelope = SupatermHostClientEnvelope(
      role: .test,
      requestID: try hostRequestID("123e4567-e89b-12d3-a456-426614174002"),
      body: .attach(
        terminalID: try terminalID("123e4567-e89b-12d3-a456-426614174000"),
        snapshotFormat: .vtReplayV1,
        size: SupatermHostTerminalSize(
          rows: 41,
          cols: 103,
          pixelWidth: 721,
          pixelHeight: 533
        )
      )
    )

    #expect(
      try jsonObject(envelope)
        == jsonObject(
          """
          {
            "epoch": 2,
            "role": "test",
            "requestId": "123e4567-e89b-12d3-a456-426614174002",
            "body": {
              "type": "attach",
              "terminalId": "123e4567-e89b-12d3-a456-426614174000",
              "snapshotFormat": "vtReplayV1",
              "size": {
                "rows": 41,
                "cols": 103,
                "pixelWidth": 721,
                "pixelHeight": 533
              }
            }
          }
          """
        )
    )
  }

  @Test
  func inputRequestMatchesRustJSON() throws {
    let envelope = SupatermHostClientEnvelope(
      role: .test,
      requestID: try hostRequestID("123e4567-e89b-12d3-a456-426614174002"),
      body: .input(
        terminalID: try terminalID("123e4567-e89b-12d3-a456-426614174000"),
        attachmentID: try attachmentID("123e4567-e89b-12d3-a456-426614174001"),
        sequence: 7,
        data: Data([0x61, 0x00, 0x62])
      )
    )

    #expect(
      try jsonObject(envelope)
        == jsonObject(
          """
          {
            "epoch": 2,
            "role": "test",
            "requestId": "123e4567-e89b-12d3-a456-426614174002",
            "body": {
              "type": "input",
              "terminalId": "123e4567-e89b-12d3-a456-426614174000",
              "attachmentId": "123e4567-e89b-12d3-a456-426614174001",
              "sequence": 7
            }
          }
          """
        )
    )
  }

  @Test
  func gateTwoHostMessagesMatchRustJSON() throws {
    let requestID = try hostRequestID("123e4567-e89b-12d3-a456-426614174002")
    let terminalID = try terminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = try attachmentID("123e4567-e89b-12d3-a456-426614174001")
    let terminal = try terminalInfo(status: .running)

    let values: [(SupatermHostEnvelope, String)] = [
      (
        SupatermHostEnvelope(
          requestID: requestID,
          body: .attachReplay(
            attachmentID: attachmentID,
            segment: .title,
            data: Data("build".utf8)
          )
        ),
        """
        {
          "epoch": 2,
          "role": "host",
          "requestId": "123e4567-e89b-12d3-a456-426614174002",
          "body": {
            "type": "attachReplay",
            "attachmentId": "123e4567-e89b-12d3-a456-426614174001",
            "segment": "title"
          }
        }
        """
      ),
      (
        SupatermHostEnvelope(
          requestID: requestID,
          body: .attached(
            terminal: terminal,
            attachmentID: attachmentID,
            boundarySequence: 19,
            nextInputSequence: 8
          )
        ),
        """
        {
          "epoch": 2,
          "role": "host",
          "requestId": "123e4567-e89b-12d3-a456-426614174002",
          "body": {
            "type": "attached",
            "terminal": {
              "id": "123e4567-e89b-12d3-a456-426614174000",
              "bootId": "123e4567-e89b-12d3-a456-426614174005",
              "argv": ["/bin/sh"],
              "cwd": "/tmp",
              "size": {
                "rows": 24,
                "cols": 80,
                "pixelWidth": 0,
                "pixelHeight": 0
              },
              "status": {"state": "running"},
              "inputState": "ready"
            },
            "attachmentId": "123e4567-e89b-12d3-a456-426614174001",
            "boundarySequence": 19,
            "nextInputSequence": 8
          }
        }
        """
      ),
      (
        SupatermHostEnvelope(
          requestID: requestID,
          body: .inputCommitted(nextInputSequence: 8)
        ),
        """
        {
          "epoch": 2,
          "role": "host",
          "requestId": "123e4567-e89b-12d3-a456-426614174002",
          "body": {"type": "inputCommitted", "nextInputSequence": 8}
        }
        """
      ),
      (
        SupatermHostEnvelope(
          requestID: nil,
          body: .resyncRequired(terminalID: terminalID, attachmentID: attachmentID)
        ),
        """
        {
          "epoch": 2,
          "role": "host",
          "requestId": null,
          "body": {
            "type": "resyncRequired",
            "terminalId": "123e4567-e89b-12d3-a456-426614174000",
            "attachmentId": "123e4567-e89b-12d3-a456-426614174001"
          }
        }
        """
      ),
    ]

    try expectJSON(values)
  }

  @Test
  func outputEventMatchesRustJSON() throws {
    let envelope = SupatermHostEnvelope(
      requestID: nil,
      body: .output(
        terminalID: try terminalID("123e4567-e89b-12d3-a456-426614174000"),
        attachmentID: try attachmentID("123e4567-e89b-12d3-a456-426614174001"),
        sequence: 19,
        data: Data([0x61, 0x00, 0x62])
      )
    )

    let actual = try jsonObject(envelope)
    let expected = try jsonObject(
      """
      {
        "epoch": 2,
        "role": "host",
        "requestId": null,
        "body": {
          "type": "output",
          "terminalId": "123e4567-e89b-12d3-a456-426614174000",
          "attachmentId": "123e4567-e89b-12d3-a456-426614174001",
          "sequence": 19
        }
      }
      """
    )
    #expect(actual == expected)
  }

  @Test
  func terminalInfoOmitsDerivedAndHostInternalState() throws {
    let terminal = try terminalInfo(status: .exited(.signal("HUP")))
    let encoded = try JSONEncoder().encode(terminal)
    let object = try #require(
      JSONSerialization.jsonObject(with: encoded) as? [String: AnyHashable]
    )

    #expect(object["processId"] == nil)
    #expect(object["nextSequence"] == nil)
    #expect(
      try JSONDecoder().decode(SupatermHostTerminalInfo.self, from: encoded) == terminal
    )
  }

  @Test
  func allRequestsRoundTrip() throws {
    let terminalID = try terminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = try attachmentID("123e4567-e89b-12d3-a456-426614174001")
    let clientID = try clientID("123e4567-e89b-12d3-a456-426614174003")
    let size = SupatermHostTerminalSize(rows: 30, cols: 90, pixelWidth: 900, pixelHeight: 600)
    let command = SupatermHostCommand(
      argv: ["/usr/bin/env"],
      cwd: "/tmp",
      environment: SupatermHostEnvironmentSpec(inherit: true)
    )
    let values: [SupatermHostRequest] = [
      .hello(clientID: clientID),
      .create(terminalID: terminalID, command: command, size: size),
      .list,
      .get(terminalID: terminalID),
      .attach(terminalID: terminalID, snapshotFormat: .vtReplayV1, size: size),
      .input(
        terminalID: terminalID,
        attachmentID: attachmentID,
        sequence: 9,
        data: Data([0, 1, 255])
      ),
      .resize(terminalID: terminalID, attachmentID: attachmentID, size: size),
      .detach(terminalID: terminalID, attachmentID: attachmentID),
      .end(terminalID: terminalID),
    ]

    let codec = SupatermHostFrameCodec()
    for value in values {
      let envelope = SupatermHostClientEnvelope(
        role: .test,
        requestID: HostRequestID(),
        body: value
      )
      #expect(
        try codec.decode(
          SupatermHostClientEnvelope.self,
          from: codec.encode(envelope)
        ) == envelope
      )
    }
  }

  @Test
  func allHostMessagesRoundTrip() throws {
    let terminalID = try terminalID("123e4567-e89b-12d3-a456-426614174000")
    let attachmentID = try attachmentID("123e4567-e89b-12d3-a456-426614174001")
    let terminal = try terminalInfo(status: .running)
    let replaySegments: [SupatermHostAttachReplaySegment] = [.vt, .title, .continuation]
    var values: [SupatermHostMessage] = [
      .hello(
        machineID: try machineID("123e4567-e89b-12d3-a456-426614174004"),
        bootID: try bootID("123e4567-e89b-12d3-a456-426614174005")
      ),
      .created(terminal: terminal),
      .terminals([terminal]),
      .terminal(terminal),
      .attached(
        terminal: terminal,
        attachmentID: attachmentID,
        boundarySequence: 12,
        nextInputSequence: 4
      ),
      .inputCommitted(nextInputSequence: 5),
      .ack,
      .error(code: .terminalInUse, message: "already attached"),
      .output(
        terminalID: terminalID,
        attachmentID: attachmentID,
        sequence: 12,
        data: Data([1, 2, 3])
      ),
      .resyncRequired(terminalID: terminalID, attachmentID: attachmentID),
      .exited(terminalID: terminalID, exit: .code(23)),
      .exited(terminalID: terminalID, exit: .signal("TERM")),
    ]
    values.append(
      contentsOf: replaySegments.map {
        .attachReplay(attachmentID: attachmentID, segment: $0, data: Data([1, 2, 3]))
      }
    )

    let codec = SupatermHostFrameCodec()
    for value in values {
      let envelope = SupatermHostEnvelope(
        requestID: value.isEvent ? nil : HostRequestID(),
        body: value
      )
      #expect(
        try codec.decode(
          SupatermHostEnvelope.self,
          from: codec.encode(envelope)
        ) == envelope
      )
    }
  }

  @Test
  func allErrorCodesUseCamelCase() throws {
    let values: [SupatermHostErrorCode] = [
      .backpressure,
      .conflict,
      .inputUncertain,
      .invalidRequest,
      .notAttached,
      .notFound,
      .protocol,
      .terminalExited,
      .terminalInUse,
    ]
    let encoded = try JSONEncoder().encode(values)
    let rawValues = try #require(JSONSerialization.jsonObject(with: encoded) as? [String])
    #expect(rawValues == values.map(\.rawValue))
  }

  @Test
  func decoderRejectsUnknownTagsAndSegments() {
    let invalidSegment = Data(
      """
      {
        "type": "attachReplay",
        "attachmentId": "123e4567-e89b-12d3-a456-426614174001",
        "segment": "screen",
        "data": ""
      }
      """.utf8
    )
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(
        SupatermHostRequest.self,
        from: Data("{\"type\":\"unknown\"}".utf8)
      )
    }
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(SupatermHostMessage.self, from: invalidSegment)
    }
  }

  @Test
  func decoderRejectsJSONDataInBinaryBodyCases() {
    let input = Data(
      """
      {
        "type": "input",
        "terminalId": "123e4567-e89b-12d3-a456-426614174000",
        "attachmentId": "123e4567-e89b-12d3-a456-426614174001",
        "sequence": 0,
        "data": "AA=="
      }
      """.utf8
    )
    let replay = Data(
      """
      {
        "type": "attachReplay",
        "attachmentId": "123e4567-e89b-12d3-a456-426614174001",
        "segment": "vt",
        "data": "AA=="
      }
      """.utf8
    )
    let output = Data(
      """
      {
        "type": "output",
        "terminalId": "123e4567-e89b-12d3-a456-426614174000",
        "attachmentId": "123e4567-e89b-12d3-a456-426614174001",
        "sequence": 0,
        "data": "AA=="
      }
      """.utf8
    )

    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(SupatermHostRequest.self, from: input)
    }
    for value in [replay, output] {
      #expect(throws: DecodingError.self) {
        try JSONDecoder().decode(SupatermHostMessage.self, from: value)
      }
    }
  }

  @Test
  func decoderRejectsUnknownEnvelopeAndNestedKeys() {
    let envelope = Data(
      """
      {
        "epoch": 2,
        "role": "test",
        "requestId": "123e4567-e89b-12d3-a456-426614174002",
        "body": {"type": "list"},
        "extra": true
      }
      """.utf8
    )
    let size = Data(
      """
      {"rows": 24, "cols": 80, "pixelWidth": 0, "pixelHeight": 0, "extra": true}
      """.utf8
    )
    let status = Data(
      """
      {"state": "running", "exit": {"kind": "code", "value": 0}}
      """.utf8
    )

    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(SupatermHostClientEnvelope.self, from: envelope)
    }
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(SupatermHostTerminalSize.self, from: size)
    }
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(SupatermHostTerminalStatus.self, from: status)
    }
  }
}

private func jsonObject<Value: Encodable>(_ value: Value) throws -> NSDictionary {
  let data = try JSONEncoder().encode(value)
  return try #require(JSONSerialization.jsonObject(with: data) as? NSDictionary)
}

private func expectJSON(_ values: [(SupatermHostEnvelope, String)]) throws {
  for (value, expected) in values {
    #expect(try jsonObject(value) == jsonObject(expected))
  }
}

private func jsonObject(_ value: String) throws -> NSDictionary {
  return try #require(
    JSONSerialization.jsonObject(with: Data(value.utf8)) as? NSDictionary
  )
}

private func terminalInfo(
  status: SupatermHostTerminalStatus
) throws -> SupatermHostTerminalInfo {
  SupatermHostTerminalInfo(
    id: try terminalID("123e4567-e89b-12d3-a456-426614174000"),
    bootID: try bootID("123e4567-e89b-12d3-a456-426614174005"),
    argv: ["/bin/sh"],
    cwd: "/tmp",
    size: SupatermHostTerminalSize(),
    status: status,
    inputState: .ready
  )
}

private func terminalID(_ value: String) throws -> TerminalID {
  TerminalID(rawValue: try uuid(value))
}

private func attachmentID(_ value: String) throws -> AttachmentID {
  AttachmentID(rawValue: try uuid(value))
}

private func clientID(_ value: String) throws -> ClientID {
  ClientID(rawValue: try uuid(value))
}

private func machineID(_ value: String) throws -> MachineID {
  MachineID(rawValue: try uuid(value))
}

private func bootID(_ value: String) throws -> BootID {
  BootID(rawValue: try uuid(value))
}

private func hostRequestID(_ value: String) throws -> HostRequestID {
  HostRequestID(rawValue: try uuid(value))
}

private func uuid(_ value: String) throws -> UUID {
  try #require(UUID(uuidString: value))
}
