import Foundation
import SupatermCLIShared

nonisolated enum CodexTranscriptMetadataParser {
  private static let maximumReadCount = 16
  private static let maximumMetadataSize =
    AgentTranscriptTailer.defaultMaxReadSize * maximumReadCount

  static func subagentNickname(
    at path: String?,
    agentID: String?,
    sessionID: String?
  ) -> String? {
    guard let path, let agentID, let sessionID,
      var tick = AgentTranscriptTailer.start(
        at: path,
        maxLineSize: maximumMetadataSize
      )
    else {
      return nil
    }
    for readIndex in 0..<maximumReadCount {
      if let nickname = subagentNickname(
        from: tick.objects,
        agentID: agentID,
        sessionID: sessionID
      ) {
        return nickname
      }
      guard readIndex < maximumReadCount - 1,
        tick.hasUnreadBytes,
        let next = AgentTranscriptTailer.advance(
          tick.cursor,
          at: path,
          maxLineSize: maximumMetadataSize
        )
      else {
        return nil
      }
      tick = next
    }
    return nil
  }

  private static func subagentNickname(
    from objects: [JSONObject],
    agentID: String,
    sessionID: String
  ) -> String? {
    for object in objects {
      guard object["type"]?.stringValue == "session_meta",
        let payload = object["payload"]?.objectValue,
        payload["id"]?.stringValue == agentID,
        payload["session_id"]?.stringValue == sessionID
      else {
        continue
      }
      let sourceNickname =
        payload["source"]?.objectValue?["subagent"]?.objectValue?["thread_spawn"]?
        .objectValue?["agent_nickname"]?.stringValue
      return AgentProgressParsing.normalizedTitle(
        payload["agent_nickname"]?.stringValue ?? sourceNickname
      )
    }
    return nil
  }
}
