import Foundation
import SupatermCLIShared

nonisolated enum ClaudeSubagentMetadataParser {
  struct Metadata: Equatable {
    let nickname: String?
    let task: String?
    let isTeammate: Bool
  }

  static func metadata(
    transcriptPath: String?,
    agentID: String?
  ) -> Metadata? {
    guard let agentID,
      let metadataURL = metadataURL(transcriptPath: transcriptPath, agentID: agentID),
      let data = try? Data(contentsOf: metadataURL),
      let object = (try? JSONDecoder().decode(JSONValue.self, from: data))?.objectValue
    else {
      return nil
    }
    let nickname =
      AgentProgressParsing.normalizedTitle(object["name"]?.stringValue)
      ?? workflowName(besides: metadataURL)
    let task =
      AgentProgressParsing.normalizedTitle(object["description"]?.stringValue)
      ?? spawnPromptTask(besides: metadataURL, agentID: agentID)
    guard nickname != nil || task != nil else { return nil }
    return Metadata(
      nickname: nickname,
      task: task,
      isTeammate: object["taskKind"]?.stringValue == "in_process_teammate"
    )
  }

  private static let maxPromptTaskLength = 140
  private static let maxSpawnLineBytes = 262_144

  private static func metadataURL(
    transcriptPath: String?,
    agentID: String
  ) -> URL? {
    guard let transcriptPath else { return nil }
    let transcript = URL(fileURLWithPath: transcriptPath)
    guard transcript.pathExtension == "jsonl" else { return nil }
    let subagents =
      transcript
      .deletingPathExtension()
      .appendingPathComponent("subagents")
    let fileName = "agent-\(agentID).meta.json"
    let direct = subagents.appendingPathComponent(fileName)
    if FileManager.default.fileExists(atPath: direct.path) {
      return direct
    }
    let workflowRuns =
      (try? FileManager.default.contentsOfDirectory(
        at: subagents.appendingPathComponent("workflows"),
        includingPropertiesForKeys: nil
      )) ?? []
    return
      workflowRuns
      .map { $0.appendingPathComponent(fileName) }
      .first { FileManager.default.fileExists(atPath: $0.path) }
  }

  private static func workflowName(besides metadataURL: URL) -> String? {
    let runDirectory = metadataURL.deletingLastPathComponent()
    guard runDirectory.deletingLastPathComponent().lastPathComponent == "workflows" else {
      return nil
    }
    let suffix = "-\(runDirectory.lastPathComponent).js"
    let scriptsDirectory =
      runDirectory
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("workflows")
      .appendingPathComponent("scripts")
    let scripts =
      (try? FileManager.default.contentsOfDirectory(
        at: scriptsDirectory,
        includingPropertiesForKeys: nil
      )) ?? []
    guard
      let script =
        scripts
        .map(\.lastPathComponent)
        .first(where: { $0.hasSuffix(suffix) })
    else {
      return nil
    }
    return AgentProgressParsing.normalizedTitle(String(script.dropLast(suffix.count)))
  }

  private static func spawnPromptTask(besides metadataURL: URL, agentID: String) -> String? {
    let transcript =
      metadataURL
      .deletingLastPathComponent()
      .appendingPathComponent("agent-\(agentID).jsonl")
    guard let line = firstLine(of: transcript),
      let object = (try? JSONDecoder().decode(JSONValue.self, from: line))?.objectValue,
      let prompt = promptText(object["message"]?.objectValue?["content"]),
      let normalized = AgentProgressParsing.normalizedTitle(prompt)
    else {
      return nil
    }
    guard normalized.count > maxPromptTaskLength else { return normalized }
    return String(normalized.prefix(maxPromptTaskLength)) + "…"
  }

  private static func promptText(_ content: JSONValue?) -> String? {
    if let text = content?.stringValue {
      return text
    }
    return content?.arrayValue?
      .compactMap { $0.objectValue?["text"]?.stringValue }
      .first
  }

  private static func firstLine(of url: URL) -> Data? {
    guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
    defer { try? handle.close() }
    guard let data = try? handle.read(upToCount: maxSpawnLineBytes) else { return nil }
    return data.prefix { $0 != 0x0A }
  }
}
