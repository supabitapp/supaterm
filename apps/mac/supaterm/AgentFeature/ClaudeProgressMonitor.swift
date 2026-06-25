import Foundation
import SupatermTerminalAgentPanelFeature

@MainActor
final class ClaudePanelMonitor: AgentPanelMonitor {
  private let sessionID: String
  private let homeDirectoryURL: URL
  private let transcriptPath: () -> String?
  private var cursor: ClaudeProgressCursor
  private var transcriptRows: [PaneAgentProgressRow]
  private var currentSnapshot: AgentMonitorSnapshot?

  init(
    sessionID: String,
    homeDirectoryURL: URL,
    transcriptPath: @escaping () -> String?
  ) {
    self.sessionID = sessionID
    self.homeDirectoryURL = homeDirectoryURL
    self.transcriptPath = transcriptPath
    let initialProgress =
      transcriptPath().map { ClaudeTranscriptProgressMonitor.start(at: $0) }
      ?? (cursor: ClaudeProgressCursor(transcriptOffset: 0), rows: nil)
    cursor = initialProgress.cursor
    transcriptRows = initialProgress.rows ?? []
  }

  func start() -> AgentPanelMonitorTick? {
    let snapshot = panelSnapshot()
    currentSnapshot = snapshot
    return AgentPanelMonitorTick(snapshot: snapshot, isFinal: false)
  }

  func poll() -> AgentPanelMonitorTick? {
    if let path = transcriptPath(),
      let result = ClaudeTranscriptProgressMonitor.advance(cursor, at: path)
    {
      cursor = result.cursor
      if let rows = result.rows {
        transcriptRows = rows
      }
    }
    let nextSnapshot = panelSnapshot()
    guard nextSnapshot != currentSnapshot else { return nil }
    currentSnapshot = nextSnapshot
    return AgentPanelMonitorTick(snapshot: nextSnapshot, isFinal: false)
  }

  private func panelSnapshot() -> AgentMonitorSnapshot {
    let taskRows = ClaudeTaskProgressReader.progressRows(
      sessionID: sessionID,
      homeDirectoryURL: homeDirectoryURL
    )
    let rows =
      taskRows.isEmpty
      ? transcriptRows
      : cursor.displayRows(taskRows)
    return AgentMonitorSnapshot(progressRows: rows)
  }
}
