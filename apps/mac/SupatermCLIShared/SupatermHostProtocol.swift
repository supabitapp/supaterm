import Foundation

public let supatermHostProtocolEpoch: UInt32 = 2
public let supatermHostMaximumFrameBytes = 8 * 1024 * 1024
public let supatermHostMaximumTerminalDataBytes = 64 * 1024
public let supatermHostMaximumAttachReplayBytes = 64 * 1024 * 1024

public enum SupatermHostClientRole: String, Codable, Sendable {
  case app
  case attach
  case cli
  case test
}

public enum SupatermHostRole: String, Codable, Sendable {
  case host
}

public enum SupatermHostSnapshotFormat: String, Codable, Sendable {
  case vtReplayV1
}

public enum SupatermHostStartupInputDelivery: String, Codable, Sendable {
  case immediate
  case prompt
}

public enum SupatermHostAttachReplaySegment: String, Codable, Sendable {
  case vt
  case title
  case continuation
}

public nonisolated struct LaunchTicketID: SupatermUUIDIdentifier {
  public let rawValue: UUID

  public init(rawValue: UUID) {
    self.rawValue = rawValue
  }
}

public struct SupatermHostClientEnvelope: Codable, Equatable, Sendable {
  public let epoch: UInt32
  public let role: SupatermHostClientRole
  public let requestID: HostRequestID
  public let body: SupatermHostRequest

  public init(
    epoch: UInt32 = supatermHostProtocolEpoch,
    role: SupatermHostClientRole,
    requestID: HostRequestID,
    body: SupatermHostRequest
  ) {
    self.epoch = epoch
    self.role = role
    self.requestID = requestID
    self.body = body
  }

  public init(from decoder: Decoder) throws {
    try validateSupatermHostKeys(
      decoder,
      expected: ["epoch", "role", "requestId", "body"]
    )
    let container = try decoder.container(keyedBy: CodingKeys.self)
    epoch = try container.decode(UInt32.self, forKey: .epoch)
    role = try container.decode(SupatermHostClientRole.self, forKey: .role)
    requestID = try container.decode(HostRequestID.self, forKey: .requestID)
    body = try container.decode(SupatermHostRequest.self, forKey: .body)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(epoch, forKey: .epoch)
    try container.encode(role, forKey: .role)
    try container.encode(requestID, forKey: .requestID)
    try container.encode(body, forKey: .body)
  }

  private enum CodingKeys: String, CodingKey {
    case epoch
    case role
    case requestID = "requestId"
    case body
  }
}

public struct SupatermHostEnvelope: Codable, Equatable, Sendable {
  public let epoch: UInt32
  public let role: SupatermHostRole
  public let requestID: HostRequestID?
  public let body: SupatermHostMessage

  public init(
    epoch: UInt32 = supatermHostProtocolEpoch,
    role: SupatermHostRole = .host,
    requestID: HostRequestID?,
    body: SupatermHostMessage
  ) {
    self.epoch = epoch
    self.role = role
    self.requestID = requestID
    self.body = body
  }

  public init(from decoder: Decoder) throws {
    try validateSupatermHostKeys(
      decoder,
      expected: ["epoch", "role", "requestId", "body"]
    )
    let container = try decoder.container(keyedBy: CodingKeys.self)
    epoch = try container.decode(UInt32.self, forKey: .epoch)
    role = try container.decode(SupatermHostRole.self, forKey: .role)
    requestID = try container.decodeIfPresent(HostRequestID.self, forKey: .requestID)
    body = try container.decode(SupatermHostMessage.self, forKey: .body)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(epoch, forKey: .epoch)
    try container.encode(role, forKey: .role)
    if let requestID {
      try container.encode(requestID, forKey: .requestID)
    } else {
      try container.encodeNil(forKey: .requestID)
    }
    try container.encode(body, forKey: .body)
  }

  private enum CodingKeys: String, CodingKey {
    case epoch
    case role
    case requestID = "requestId"
    case body
  }
}

public enum SupatermHostRequest: Equatable, Sendable {
  case hello(clientID: ClientID)
  case reserve(
    launchTicketID: LaunchTicketID,
    terminalID: TerminalID,
    size: SupatermHostTerminalSize,
    startupInput: String,
    startupInputDelivery: SupatermHostStartupInputDelivery
  )
  case cancelReservation(
    launchTicketID: LaunchTicketID,
    terminalID: TerminalID
  )
  case launch(
    launchTicketID: LaunchTicketID,
    terminalID: TerminalID,
    command: SupatermHostCommand,
    size: SupatermHostTerminalSize
  )
  case list
  case get(terminalID: TerminalID)
  case attach(
    terminalID: TerminalID,
    snapshotFormat: SupatermHostSnapshotFormat,
    size: SupatermHostTerminalSize
  )
  case input(
    terminalID: TerminalID,
    attachmentID: AttachmentID,
    sequence: UInt64,
    data: Data
  )
  case resize(
    terminalID: TerminalID,
    attachmentID: AttachmentID,
    size: SupatermHostTerminalSize
  )
  case detach(terminalID: TerminalID, attachmentID: AttachmentID)
  case end(terminalID: TerminalID)
}

extension SupatermHostRequest: Codable {
  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let kind = try container.decode(Kind.self, forKey: .type)
    try validateSupatermHostKeys(decoder, expected: kind.expectedKeys)
    switch kind {
    case .hello:
      self = .hello(clientID: try container.decode(ClientID.self, forKey: .clientID))
    case .reserve:
      self = .reserve(
        launchTicketID: try container.decode(LaunchTicketID.self, forKey: .launchTicketID),
        terminalID: try container.decode(TerminalID.self, forKey: .terminalID),
        size: try container.decode(SupatermHostTerminalSize.self, forKey: .size),
        startupInput: try container.decode(String.self, forKey: .startupInput),
        startupInputDelivery: try container.decode(
          SupatermHostStartupInputDelivery.self,
          forKey: .startupInputDelivery
        )
      )
    case .cancelReservation:
      self = .cancelReservation(
        launchTicketID: try container.decode(LaunchTicketID.self, forKey: .launchTicketID),
        terminalID: try container.decode(TerminalID.self, forKey: .terminalID)
      )
    case .launch:
      self = .launch(
        launchTicketID: try container.decode(LaunchTicketID.self, forKey: .launchTicketID),
        terminalID: try container.decode(TerminalID.self, forKey: .terminalID),
        command: try container.decode(SupatermHostCommand.self, forKey: .command),
        size: try container.decode(SupatermHostTerminalSize.self, forKey: .size)
      )
    case .list:
      self = .list
    case .get:
      self = .get(terminalID: try container.decode(TerminalID.self, forKey: .terminalID))
    case .attach:
      self = .attach(
        terminalID: try container.decode(TerminalID.self, forKey: .terminalID),
        snapshotFormat: try container.decode(
          SupatermHostSnapshotFormat.self,
          forKey: .snapshotFormat
        ),
        size: try container.decode(SupatermHostTerminalSize.self, forKey: .size)
      )
    case .input:
      self = .input(
        terminalID: try container.decode(TerminalID.self, forKey: .terminalID),
        attachmentID: try container.decode(AttachmentID.self, forKey: .attachmentID),
        sequence: try container.decode(UInt64.self, forKey: .sequence),
        data: Data()
      )
    case .resize:
      self = .resize(
        terminalID: try container.decode(TerminalID.self, forKey: .terminalID),
        attachmentID: try container.decode(AttachmentID.self, forKey: .attachmentID),
        size: try container.decode(SupatermHostTerminalSize.self, forKey: .size)
      )
    case .detach:
      self = .detach(
        terminalID: try container.decode(TerminalID.self, forKey: .terminalID),
        attachmentID: try container.decode(AttachmentID.self, forKey: .attachmentID)
      )
    case .end:
      self = .end(terminalID: try container.decode(TerminalID.self, forKey: .terminalID))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .hello(let clientID):
      try container.encode(Kind.hello, forKey: .type)
      try container.encode(clientID, forKey: .clientID)
    case .reserve(
      let launchTicketID,
      let terminalID,
      let size,
      let startupInput,
      let startupInputDelivery
    ):
      try container.encode(Kind.reserve, forKey: .type)
      try container.encode(launchTicketID, forKey: .launchTicketID)
      try container.encode(terminalID, forKey: .terminalID)
      try container.encode(size, forKey: .size)
      try container.encode(startupInput, forKey: .startupInput)
      try container.encode(startupInputDelivery, forKey: .startupInputDelivery)
    case .cancelReservation(let launchTicketID, let terminalID):
      try container.encode(Kind.cancelReservation, forKey: .type)
      try container.encode(launchTicketID, forKey: .launchTicketID)
      try container.encode(terminalID, forKey: .terminalID)
    case .launch(let launchTicketID, let terminalID, let command, let size):
      try container.encode(Kind.launch, forKey: .type)
      try container.encode(launchTicketID, forKey: .launchTicketID)
      try container.encode(terminalID, forKey: .terminalID)
      try container.encode(command, forKey: .command)
      try container.encode(size, forKey: .size)
    case .list:
      try container.encode(Kind.list, forKey: .type)
    case .get(let terminalID):
      try container.encode(Kind.get, forKey: .type)
      try container.encode(terminalID, forKey: .terminalID)
    case .attach(let terminalID, let snapshotFormat, let size):
      try container.encode(Kind.attach, forKey: .type)
      try container.encode(terminalID, forKey: .terminalID)
      try container.encode(snapshotFormat, forKey: .snapshotFormat)
      try container.encode(size, forKey: .size)
    case .input(let terminalID, let attachmentID, let sequence, _):
      try container.encode(Kind.input, forKey: .type)
      try container.encode(terminalID, forKey: .terminalID)
      try container.encode(attachmentID, forKey: .attachmentID)
      try container.encode(sequence, forKey: .sequence)
    case .resize(let terminalID, let attachmentID, let size):
      try container.encode(Kind.resize, forKey: .type)
      try container.encode(terminalID, forKey: .terminalID)
      try container.encode(attachmentID, forKey: .attachmentID)
      try container.encode(size, forKey: .size)
    case .detach(let terminalID, let attachmentID):
      try container.encode(Kind.detach, forKey: .type)
      try container.encode(terminalID, forKey: .terminalID)
      try container.encode(attachmentID, forKey: .attachmentID)
    case .end(let terminalID):
      try container.encode(Kind.end, forKey: .type)
      try container.encode(terminalID, forKey: .terminalID)
    }
  }

  private enum Kind: String, Codable {
    case hello
    case reserve
    case cancelReservation
    case launch
    case list
    case get
    case attach
    case input
    case resize
    case detach
    case end

    var expectedKeys: Set<String> {
      switch self {
      case .hello:
        return ["type", "clientId"]
      case .reserve:
        return [
          "type", "launchTicketId", "terminalId", "size", "startupInput",
          "startupInputDelivery",
        ]
      case .cancelReservation:
        return ["type", "launchTicketId", "terminalId"]
      case .launch:
        return ["type", "launchTicketId", "terminalId", "command", "size"]
      case .list:
        return ["type"]
      case .get, .end:
        return ["type", "terminalId"]
      case .attach:
        return ["type", "terminalId", "snapshotFormat", "size"]
      case .input:
        return ["type", "terminalId", "attachmentId", "sequence"]
      case .resize:
        return ["type", "terminalId", "attachmentId", "size"]
      case .detach:
        return ["type", "terminalId", "attachmentId"]
      }
    }
  }

  private enum CodingKeys: String, CodingKey {
    case type
    case clientID = "clientId"
    case launchTicketID = "launchTicketId"
    case terminalID = "terminalId"
    case attachmentID = "attachmentId"
    case snapshotFormat
    case command
    case startupInput
    case startupInputDelivery
    case size
    case sequence
  }
}

public enum SupatermHostMessage: Equatable, Sendable {
  case hello(machineID: MachineID, bootID: BootID)
  case reserved
  case launched(terminal: SupatermHostTerminalInfo)
  case terminals([SupatermHostTerminalInfo])
  case terminal(SupatermHostTerminalInfo)
  case attachReplay(
    attachmentID: AttachmentID,
    segment: SupatermHostAttachReplaySegment,
    data: Data
  )
  case attached(
    terminal: SupatermHostTerminalInfo,
    attachmentID: AttachmentID,
    boundarySequence: UInt64,
    nextInputSequence: UInt64
  )
  case inputCommitted(nextInputSequence: UInt64)
  case ack
  case error(code: SupatermHostErrorCode, message: String)
  case output(
    terminalID: TerminalID,
    attachmentID: AttachmentID,
    sequence: UInt64,
    data: Data
  )
  case resyncRequired(terminalID: TerminalID, attachmentID: AttachmentID)
  case exited(terminalID: TerminalID, exit: SupatermHostProcessExit)

  public var isEvent: Bool {
    switch self {
    case .output, .resyncRequired, .exited:
      return true
    default:
      return false
    }
  }
}

extension SupatermHostMessage: Codable {
  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let kind = try container.decode(Kind.self, forKey: .type)
    try validateSupatermHostKeys(decoder, expected: kind.expectedKeys)
    switch kind {
    case .hello:
      self = .hello(
        machineID: try container.decode(MachineID.self, forKey: .machineID),
        bootID: try container.decode(BootID.self, forKey: .bootID)
      )
    case .reserved:
      self = .reserved
    case .launched:
      self = .launched(
        terminal: try container.decode(SupatermHostTerminalInfo.self, forKey: .terminal)
      )
    case .terminals:
      self = .terminals(
        try container.decode([SupatermHostTerminalInfo].self, forKey: .terminals)
      )
    case .terminal:
      self = .terminal(
        try container.decode(SupatermHostTerminalInfo.self, forKey: .terminal)
      )
    case .attachReplay:
      self = .attachReplay(
        attachmentID: try container.decode(AttachmentID.self, forKey: .attachmentID),
        segment: try container.decode(
          SupatermHostAttachReplaySegment.self,
          forKey: .segment
        ),
        data: Data()
      )
    case .attached:
      self = .attached(
        terminal: try container.decode(SupatermHostTerminalInfo.self, forKey: .terminal),
        attachmentID: try container.decode(AttachmentID.self, forKey: .attachmentID),
        boundarySequence: try container.decode(UInt64.self, forKey: .boundarySequence),
        nextInputSequence: try container.decode(UInt64.self, forKey: .nextInputSequence)
      )
    case .inputCommitted:
      self = .inputCommitted(
        nextInputSequence: try container.decode(UInt64.self, forKey: .nextInputSequence)
      )
    case .ack:
      self = .ack
    case .error:
      self = .error(
        code: try container.decode(SupatermHostErrorCode.self, forKey: .code),
        message: try container.decode(String.self, forKey: .message)
      )
    case .output:
      self = .output(
        terminalID: try container.decode(TerminalID.self, forKey: .terminalID),
        attachmentID: try container.decode(AttachmentID.self, forKey: .attachmentID),
        sequence: try container.decode(UInt64.self, forKey: .sequence),
        data: Data()
      )
    case .resyncRequired:
      self = .resyncRequired(
        terminalID: try container.decode(TerminalID.self, forKey: .terminalID),
        attachmentID: try container.decode(AttachmentID.self, forKey: .attachmentID)
      )
    case .exited:
      self = .exited(
        terminalID: try container.decode(TerminalID.self, forKey: .terminalID),
        exit: try container.decode(SupatermHostProcessExit.self, forKey: .exit)
      )
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .hello(let machineID, let bootID):
      try container.encode(Kind.hello, forKey: .type)
      try container.encode(machineID, forKey: .machineID)
      try container.encode(bootID, forKey: .bootID)
    case .reserved:
      try container.encode(Kind.reserved, forKey: .type)
    case .launched(let terminal):
      try container.encode(Kind.launched, forKey: .type)
      try container.encode(terminal, forKey: .terminal)
    case .terminals(let terminals):
      try container.encode(Kind.terminals, forKey: .type)
      try container.encode(terminals, forKey: .terminals)
    case .terminal(let terminal):
      try container.encode(Kind.terminal, forKey: .type)
      try container.encode(terminal, forKey: .terminal)
    case .attachReplay(let attachmentID, let segment, _):
      try container.encode(Kind.attachReplay, forKey: .type)
      try container.encode(attachmentID, forKey: .attachmentID)
      try container.encode(segment, forKey: .segment)
    case .attached(
      let terminal,
      let attachmentID,
      let boundarySequence,
      let nextInputSequence
    ):
      try container.encode(Kind.attached, forKey: .type)
      try container.encode(terminal, forKey: .terminal)
      try container.encode(attachmentID, forKey: .attachmentID)
      try container.encode(boundarySequence, forKey: .boundarySequence)
      try container.encode(nextInputSequence, forKey: .nextInputSequence)
    case .inputCommitted(let nextInputSequence):
      try container.encode(Kind.inputCommitted, forKey: .type)
      try container.encode(nextInputSequence, forKey: .nextInputSequence)
    case .ack:
      try container.encode(Kind.ack, forKey: .type)
    case .error(let code, let message):
      try container.encode(Kind.error, forKey: .type)
      try container.encode(code, forKey: .code)
      try container.encode(message, forKey: .message)
    case .output(let terminalID, let attachmentID, let sequence, _):
      try container.encode(Kind.output, forKey: .type)
      try container.encode(terminalID, forKey: .terminalID)
      try container.encode(attachmentID, forKey: .attachmentID)
      try container.encode(sequence, forKey: .sequence)
    case .resyncRequired(let terminalID, let attachmentID):
      try container.encode(Kind.resyncRequired, forKey: .type)
      try container.encode(terminalID, forKey: .terminalID)
      try container.encode(attachmentID, forKey: .attachmentID)
    case .exited(let terminalID, let exit):
      try container.encode(Kind.exited, forKey: .type)
      try container.encode(terminalID, forKey: .terminalID)
      try container.encode(exit, forKey: .exit)
    }
  }

  private enum Kind: String, Codable {
    case hello
    case reserved
    case launched
    case terminals
    case terminal
    case attachReplay
    case attached
    case inputCommitted
    case ack
    case error
    case output
    case resyncRequired
    case exited

    var expectedKeys: Set<String> {
      switch self {
      case .hello:
        return ["type", "machineId", "bootId"]
      case .reserved:
        return ["type"]
      case .launched, .terminal:
        return ["type", "terminal"]
      case .terminals:
        return ["type", "terminals"]
      case .attachReplay:
        return ["type", "attachmentId", "segment"]
      case .attached:
        return [
          "type",
          "terminal",
          "attachmentId",
          "boundarySequence",
          "nextInputSequence",
        ]
      case .inputCommitted:
        return ["type", "nextInputSequence"]
      case .ack:
        return ["type"]
      case .error:
        return ["type", "code", "message"]
      case .output:
        return ["type", "terminalId", "attachmentId", "sequence"]
      case .resyncRequired:
        return ["type", "terminalId", "attachmentId"]
      case .exited:
        return ["type", "terminalId", "exit"]
      }
    }
  }

  private enum CodingKeys: String, CodingKey {
    case type
    case machineID = "machineId"
    case bootID = "bootId"
    case terminal
    case terminals
    case attachmentID = "attachmentId"
    case code
    case message
    case terminalID = "terminalId"
    case sequence
    case segment
    case boundarySequence
    case nextInputSequence
    case exit
  }
}

public enum SupatermHostErrorCode: String, Codable, Sendable {
  case backpressure
  case conflict
  case inputUncertain
  case `internal`
  case invalidRequest
  case notAttached
  case notFound
  case `protocol`
  case replayUnavailable
  case terminalExited
  case terminalInUse
}

public struct SupatermHostCommand: Codable, Equatable, Sendable {
  public let argv: [String]
  public let cwd: String
  public let environment: SupatermHostEnvironmentSpec

  public init(argv: [String], cwd: String, environment: SupatermHostEnvironmentSpec) {
    self.argv = argv
    self.cwd = cwd
    self.environment = environment
  }

  public init(from decoder: Decoder) throws {
    try validateSupatermHostKeys(decoder, expected: ["argv", "cwd", "environment"])
    let container = try decoder.container(keyedBy: CodingKeys.self)
    argv = try container.decode([String].self, forKey: .argv)
    cwd = try container.decode(String.self, forKey: .cwd)
    environment = try container.decode(SupatermHostEnvironmentSpec.self, forKey: .environment)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(argv, forKey: .argv)
    try container.encode(cwd, forKey: .cwd)
    try container.encode(environment, forKey: .environment)
  }

  private enum CodingKeys: String, CodingKey {
    case argv
    case cwd
    case environment
  }
}

public struct SupatermHostEnvironmentSpec: Codable, Equatable, Sendable {
  public let inherit: Bool
  public let set: [String: String]
  public let remove: [String]

  public init(
    inherit: Bool = false,
    set: [String: String] = [:],
    remove: [String] = []
  ) {
    self.inherit = inherit
    self.set = set
    self.remove = remove
  }

  public init(from decoder: Decoder) throws {
    try validateSupatermHostKeys(decoder, expected: ["inherit", "set", "remove"])
    let container = try decoder.container(keyedBy: CodingKeys.self)
    inherit = try container.decode(Bool.self, forKey: .inherit)
    set = try container.decode([String: String].self, forKey: .set)
    remove = try container.decode([String].self, forKey: .remove)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(inherit, forKey: .inherit)
    try container.encode(set, forKey: .set)
    try container.encode(remove, forKey: .remove)
  }

  private enum CodingKeys: String, CodingKey {
    case inherit
    case set
    case remove
  }
}

public struct SupatermHostTerminalSize: Codable, Equatable, Sendable {
  public let rows: UInt16
  public let cols: UInt16
  public let pixelWidth: UInt16
  public let pixelHeight: UInt16

  public init(
    rows: UInt16 = 24,
    cols: UInt16 = 80,
    pixelWidth: UInt16 = 0,
    pixelHeight: UInt16 = 0
  ) {
    self.rows = rows
    self.cols = cols
    self.pixelWidth = pixelWidth
    self.pixelHeight = pixelHeight
  }

  public init(from decoder: Decoder) throws {
    try validateSupatermHostKeys(
      decoder,
      expected: ["rows", "cols", "pixelWidth", "pixelHeight"]
    )
    let container = try decoder.container(keyedBy: CodingKeys.self)
    rows = try container.decode(UInt16.self, forKey: .rows)
    cols = try container.decode(UInt16.self, forKey: .cols)
    pixelWidth = try container.decode(UInt16.self, forKey: .pixelWidth)
    pixelHeight = try container.decode(UInt16.self, forKey: .pixelHeight)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(rows, forKey: .rows)
    try container.encode(cols, forKey: .cols)
    try container.encode(pixelWidth, forKey: .pixelWidth)
    try container.encode(pixelHeight, forKey: .pixelHeight)
  }

  private enum CodingKeys: String, CodingKey {
    case rows
    case cols
    case pixelWidth
    case pixelHeight
  }
}

public struct SupatermHostTerminalInfo: Codable, Equatable, Sendable {
  public let id: TerminalID
  public let bootID: BootID
  public let argv: [String]
  public let cwd: String
  public let size: SupatermHostTerminalSize
  public let status: SupatermHostTerminalStatus
  public let inputState: SupatermHostInputState

  public init(
    id: TerminalID,
    bootID: BootID,
    argv: [String],
    cwd: String,
    size: SupatermHostTerminalSize,
    status: SupatermHostTerminalStatus,
    inputState: SupatermHostInputState
  ) {
    self.id = id
    self.bootID = bootID
    self.argv = argv
    self.cwd = cwd
    self.size = size
    self.status = status
    self.inputState = inputState
  }

  public init(from decoder: Decoder) throws {
    try validateSupatermHostKeys(
      decoder,
      expected: ["id", "bootId", "argv", "cwd", "size", "status", "inputState"]
    )
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(TerminalID.self, forKey: .id)
    bootID = try container.decode(BootID.self, forKey: .bootID)
    argv = try container.decode([String].self, forKey: .argv)
    cwd = try container.decode(String.self, forKey: .cwd)
    size = try container.decode(SupatermHostTerminalSize.self, forKey: .size)
    status = try container.decode(SupatermHostTerminalStatus.self, forKey: .status)
    inputState = try container.decode(SupatermHostInputState.self, forKey: .inputState)
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(bootID, forKey: .bootID)
    try container.encode(argv, forKey: .argv)
    try container.encode(cwd, forKey: .cwd)
    try container.encode(size, forKey: .size)
    try container.encode(status, forKey: .status)
    try container.encode(inputState, forKey: .inputState)
  }

  private enum CodingKeys: String, CodingKey {
    case id
    case bootID = "bootId"
    case argv
    case cwd
    case size
    case status
    case inputState
  }
}

public enum SupatermHostInputState: String, Codable, Sendable {
  case ready
  case uncertain
  case closed
}

public enum SupatermHostTerminalStatus: Equatable, Sendable {
  case starting
  case running
  case exiting
  case exited(SupatermHostProcessExit)
  case failed(message: String)
  case interrupted
}

extension SupatermHostTerminalStatus: Codable {
  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let state = try container.decode(State.self, forKey: .state)
    switch state {
    case .starting:
      try validateSupatermHostKeys(decoder, expected: ["state"])
      self = .starting
    case .running:
      try validateSupatermHostKeys(decoder, expected: ["state"])
      self = .running
    case .exiting:
      try validateSupatermHostKeys(decoder, expected: ["state"])
      self = .exiting
    case .exited:
      try validateSupatermHostKeys(decoder, expected: ["state", "exit"])
      self = .exited(try container.decode(SupatermHostProcessExit.self, forKey: .exit))
    case .failed:
      try validateSupatermHostKeys(decoder, expected: ["state", "message"])
      self = .failed(message: try container.decode(String.self, forKey: .message))
    case .interrupted:
      try validateSupatermHostKeys(decoder, expected: ["state"])
      self = .interrupted
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .starting:
      try container.encode(State.starting, forKey: .state)
    case .running:
      try container.encode(State.running, forKey: .state)
    case .exiting:
      try container.encode(State.exiting, forKey: .state)
    case .exited(let exit):
      try container.encode(State.exited, forKey: .state)
      try container.encode(exit, forKey: .exit)
    case .failed(let message):
      try container.encode(State.failed, forKey: .state)
      try container.encode(message, forKey: .message)
    case .interrupted:
      try container.encode(State.interrupted, forKey: .state)
    }
  }

  private enum State: String, Codable {
    case starting
    case running
    case exiting
    case exited
    case failed
    case interrupted
  }

  private enum CodingKeys: String, CodingKey {
    case state
    case exit
    case message
  }
}

public enum SupatermHostProcessExit: Equatable, Sendable {
  case code(UInt32)
  case signal(String)
}

extension SupatermHostProcessExit: Codable {
  public init(from decoder: Decoder) throws {
    try validateSupatermHostKeys(decoder, expected: ["kind", "value"])
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(Kind.self, forKey: .kind) {
    case .code:
      self = .code(try container.decode(UInt32.self, forKey: .value))
    case .signal:
      self = .signal(try container.decode(String.self, forKey: .value))
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .code(let value):
      try container.encode(Kind.code, forKey: .kind)
      try container.encode(value, forKey: .value)
    case .signal(let value):
      try container.encode(Kind.signal, forKey: .kind)
      try container.encode(value, forKey: .value)
    }
  }

  private enum Kind: String, Codable {
    case code
    case signal
  }

  private enum CodingKeys: String, CodingKey {
    case kind
    case value
  }
}

private struct SupatermHostDynamicCodingKey: CodingKey {
  let stringValue: String
  let intValue: Int?

  init?(stringValue: String) {
    self.stringValue = stringValue
    intValue = nil
  }

  init?(intValue: Int) {
    stringValue = String(intValue)
    self.intValue = intValue
  }
}

private func validateSupatermHostKeys(
  _ decoder: Decoder,
  expected: Set<String>
) throws {
  let container = try decoder.container(keyedBy: SupatermHostDynamicCodingKey.self)
  let actual = Set(container.allKeys.map(\.stringValue))
  guard actual == expected else {
    throw DecodingError.dataCorrupted(
      DecodingError.Context(
        codingPath: decoder.codingPath,
        debugDescription: "host body keys do not match its type"
      )
    )
  }
}
