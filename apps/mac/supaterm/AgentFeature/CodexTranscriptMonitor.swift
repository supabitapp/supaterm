import Foundation
import SupatermCLIShared
import SupatermTerminalAgentPanelFeature

public enum AgentTurnStatus: Equatable {
  case started(String?)
  case completed(String?)
  case aborted(String?)
  case failed(String?)

  public var isFinal: Bool {
    switch self {
    case .started:
      false
    case .completed, .aborted, .failed:
      true
    }
  }
}

enum CodexRolloutRecord: Equatable {
  case sessionMeta(JSONObject)
  case turnContext(JSONObject)
  case eventMessage(type: String, payload: JSONObject)
  case responseItem(type: String, payload: JSONObject)
  case compacted(JSONObject)
  case unknown(type: String, payload: JSONValue)
}

enum CodexConversationTurnState: Equatable {
  case inProgress
  case completed
  case aborted
  case failed

  var isFinal: Bool {
    switch self {
    case .inProgress:
      false
    case .completed, .aborted, .failed:
      true
    }
  }
}

struct CodexConversationMessage: Equatable {
  let role: String
  let text: String
  let phase: String?
}

struct CodexConversationReasoning: Equatable {
  var summary: [String]
  var content: [String]
}

enum CodexConversationItem: Equatable {
  case message(CodexConversationMessage)
  case reasoning(CodexConversationReasoning)
  case operation(type: String, payload: JSONObject)
  case event(type: String, payload: JSONObject)
  case compaction(JSONObject)
}

struct CodexConversationTurn: Equatable {
  let id: String
  var status: CodexConversationTurnState
  var error: String?
  var items: [CodexConversationItem]
  var durationMs: Int?
  var lastAssistantDetail: String?
  var hoverMessages: [String] = []
  var progressRows: [PaneAgentProgressRow] = []
  var goalRow: PaneAgentProgressRow?
}

struct CodexTranscriptBatch {
  var records: [CodexRolloutRecord]

  var isEmpty: Bool {
    records.isEmpty
  }
}

@MainActor
final class CodexPanelMonitor: AgentPanelMonitor {
  private let transcriptPath: String
  private var cursor: AgentTranscriptTailCursor
  private var conversation = CodexConversationState()

  init?(transcriptPath: String) {
    guard let (cursor, batch) = CodexTranscriptMonitor.start(at: transcriptPath) else {
      return nil
    }
    self.transcriptPath = transcriptPath
    self.cursor = cursor
    if let batch {
      conversation.absorb(batch.records)
    }
  }

  func start() -> AgentPanelMonitorTick? {
    let snapshot = conversation.sidebarSnapshot
    guard snapshot.status?.isFinal == false else { return nil }
    return AgentPanelMonitorTick(snapshot: snapshot, isFinal: false)
  }

  func poll() -> AgentPanelMonitorTick? {
    guard let result = CodexTranscriptMonitor.advance(cursor, at: transcriptPath) else {
      return nil
    }
    cursor = result.cursor
    guard let batch = result.batch, !batch.isEmpty else { return nil }
    if result.didReset {
      conversation = CodexConversationState()
    }
    conversation.absorb(batch.records)
    let snapshot = conversation.sidebarSnapshot
    guard let status = snapshot.status else { return nil }
    return AgentPanelMonitorTick(snapshot: snapshot, isFinal: status.isFinal)
  }
}

enum CodexTranscriptMonitor {
  struct Advance {
    let cursor: AgentTranscriptTailCursor
    let batch: CodexTranscriptBatch?
    let didReset: Bool
  }

  static func start(
    at path: String
  ) -> (AgentTranscriptTailCursor, CodexTranscriptBatch?)? {
    guard let tick = AgentTranscriptTailer.start(at: path) else { return nil }
    return (tick.cursor, batch(from: tick.objects))
  }

  static func advance(
    _ cursor: AgentTranscriptTailCursor,
    at path: String
  ) -> Advance? {
    guard let tick = AgentTranscriptTailer.advance(cursor, at: path) else { return nil }
    return Advance(cursor: tick.cursor, batch: batch(from: tick.objects), didReset: tick.didReset)
  }

  private static func batch(from objects: [JSONObject]) -> CodexTranscriptBatch? {
    let records = objects.compactMap(record(from:))
    return records.isEmpty ? nil : CodexTranscriptBatch(records: records)
  }

  private static func record(from object: JSONObject) -> CodexRolloutRecord? {
    guard let lineType = object["type"]?.stringValue else {
      return nil
    }
    let payload = object["payload"] ?? .null
    switch lineType {
    case "session_meta":
      guard let payload = payload.objectValue else { return .unknown(type: lineType, payload: payload) }
      return .sessionMeta(payload)
    case "turn_context":
      guard let payload = payload.objectValue else { return .unknown(type: lineType, payload: payload) }
      return .turnContext(payload)
    case "event_msg":
      guard
        let payloadObject = payload.objectValue,
        let eventType = payloadObject["type"]?.stringValue
      else {
        return .unknown(type: lineType, payload: payload)
      }
      let eventPayload = payloadObject["payload"]?.objectValue ?? payloadObject
      return .eventMessage(type: eventType, payload: eventPayload)
    case "response_item":
      guard
        let payloadObject = payload.objectValue,
        let itemType = payloadObject["type"]?.stringValue
      else {
        return .unknown(type: lineType, payload: payload)
      }
      return .responseItem(type: itemType, payload: payloadObject)
    case "compacted":
      guard let payload = payload.objectValue else { return .unknown(type: lineType, payload: payload) }
      return .compacted(payload)
    default:
      return .unknown(type: lineType, payload: payload)
    }
  }
}
