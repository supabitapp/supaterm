import Foundation
import Network

public struct SupatermHostIdentity: Equatable, Sendable {
  public let machineID: MachineID
  public let bootID: BootID

  public init(machineID: MachineID, bootID: BootID) {
    self.machineID = machineID
    self.bootID = bootID
  }
}

public struct SupatermHostAttachment: Equatable, Sendable {
  public let terminal: SupatermHostTerminalInfo
  public let attachmentID: AttachmentID
  public let replay: [SupatermHostAttachReplayChunk]
  public let boundarySequence: UInt64

  public init(
    terminal: SupatermHostTerminalInfo,
    attachmentID: AttachmentID,
    replay: [SupatermHostAttachReplayChunk],
    boundarySequence: UInt64
  ) {
    self.terminal = terminal
    self.attachmentID = attachmentID
    self.replay = replay
    self.boundarySequence = boundarySequence
  }

  public var snapshotFormat: SupatermHostSnapshotFormat { .vtReplayV1 }
}

public struct SupatermHostAttachReplayChunk: Equatable, Sendable {
  public let segment: SupatermHostAttachReplaySegment
  public let data: Data

  public init(segment: SupatermHostAttachReplaySegment, data: Data) {
    self.segment = segment
    self.data = data
  }
}

public enum SupatermHostTransportFailure: Error, Equatable, Sendable {
  case posix(POSIXErrorCode)
  case dns(DNSServiceErrorType)
  case tls(OSStatus)
  case other(domain: String, code: Int)

  public var isMissingOrRefused: Bool {
    guard case .posix(let code) = self else { return false }
    return code == .ENOENT || code == .ECONNREFUSED
  }

  init(_ error: any Error) {
    if let error = error as? NWError {
      if case .posix(let code) = error {
        self = .posix(code)
        return
      }
      if case .dns(let code) = error {
        self = .dns(code)
        return
      }
      if case .tls(let status) = error {
        self = .tls(status)
        return
      }
      let error = error as NSError
      self = .other(domain: error.domain, code: error.code)
      return
    }
    let error = error as NSError
    if error.domain == NSPOSIXErrorDomain,
      let rawCode = Int32(exactly: error.code),
      let code = POSIXErrorCode(rawValue: rawCode)
    {
      self = .posix(code)
    } else {
      self = .other(domain: error.domain, code: error.code)
    }
  }
}

public enum SupatermHostConnectionError: Error, Equatable, Sendable {
  case connectionClosed
  case invalidEventCapacity(Int)
  case invalidRequestCapacity(Int)
  case invalidAttachReplayCapacity(Int)
  case eventBufferOverflow(Int)
  case requestBufferOverflow(Int)
  case attachReplayBufferOverflow(Int)
  case terminalDataLength(Int)
  case startupInputLength(Int)
  case inputUnavailable(
    terminalID: TerminalID,
    attachmentID: AttachmentID,
    state: SupatermHostInputState
  )
  case inputInFlight(terminalID: TerminalID, attachmentID: AttachmentID)
  case transport(SupatermHostTransportFailure)
  case protocolViolation(String)
  case remote(code: SupatermHostErrorCode, message: String)
  case unexpectedResponse(SupatermHostMessage)
  case resyncRequired(terminalID: TerminalID, attachmentID: AttachmentID)
  case outputSequence(
    terminalID: TerminalID,
    attachmentID: AttachmentID,
    expected: UInt64,
    actual: UInt64
  )
}
