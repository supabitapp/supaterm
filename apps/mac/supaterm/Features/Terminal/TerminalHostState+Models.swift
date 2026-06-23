import Foundation
import SupatermCLIShared
import SupatermGhosttyFeature
import SupatermTerminalAgentPanelFeature
import SupatermTerminalModels
import SupatermTerminalPresentationFeature

func normalizedTerminalAgentDetail(_ detail: String?) -> String? {
  guard let detail = detail?.trimmingCharacters(in: .whitespacesAndNewlines), !detail.isEmpty
  else {
    return nil
  }
  return detail
}

nonisolated enum TerminalSurfaceCloseSource: String, Sendable {
  case commandCloseSurface = "command.closeSurface"
  case commandRequestCloseSurface = "command.requestCloseSurface"
  case controlClosePane = "control.closePane"
  case ghosttyChildExit = "ghostty.childExit"
  case ghosttyCloseSurfaceCallback = "ghostty.closeSurfaceCallback"
}

nonisolated enum TerminalTreeRemovalSource: String, Sendable {
  case closeTab = "closeTab"
  case controlCleanup = "control.cleanup"
  case pinnedLastPaneClose = "pinned.lastPaneClose"
  case pinnedReconcile = "pinned.reconcile"
  case pinnedSuspend = "pinned.suspend"
  case sessionClear = "session.clear"
  case spaceCatalogObserved = "spaceCatalog.observed"
  case spaceCatalogWrite = "spaceCatalog.write"
}

nonisolated struct TerminalClosePerformLogContext: Sendable {
  let source: TerminalSurfaceCloseSource
  let surfaceID: UUID
  let tabID: TerminalTabID
  let spaceID: TerminalSpaceID?
  let wasPinned: Bool
  let leafCount: Int
  let newTreeEmpty: Bool
  let focusedSurfaceID: UUID?
  let nextSurfaceID: UUID?
}

extension TerminalHostState {
  struct NewTabSelectionInput: Equatable {
    let selectedSpaceID: TerminalSpaceID?
    let targetSpaceID: TerminalSpaceID
    let selectedTabID: TerminalTabID?
    let targetTabID: TerminalTabID
    let windowActivity: WindowActivityState
    let focusedSurfaceID: UUID?
    let surfaceID: UUID
  }

  struct NewTabSelectionState: Equatable {
    let isFocused: Bool
    let isSelectedSpace: Bool
    let isSelectedTab: Bool
  }

  struct NewPaneSelectionState: Equatable {
    let isFocused: Bool
    let isSelectedTab: Bool
  }

  struct SurfaceActivity: Equatable {
    let isVisible: Bool
    let isFocused: Bool
  }

  enum ResolvedCloseRequest: Equatable {
    case request(TerminalCloseRequest)
    case window(needsConfirmation: Bool)

    var closesWindow: Bool {
      if case .window = self { return true }
      return false
    }
  }

  public struct SidebarNotificationPresentation: Equatable, Sendable {
    public let markdown: String
    public let previewMarkdown: String?
  }

  struct PaneNotification: Equatable, Sendable {
    var attentionState: SupatermNotificationAttentionState?
    var body: String
    let createdAt: Date
    var title: String
    let origin: NotificationOrigin

    init(
      attentionState: SupatermNotificationAttentionState?,
      body: String,
      createdAt: Date,
      title: String
    ) {
      self.init(
        attentionState: attentionState,
        body: body,
        createdAt: createdAt,
        title: title,
        origin: .generic
      )
    }

    init(
      attentionState: SupatermNotificationAttentionState?,
      body: String,
      createdAt: Date,
      title: String,
      origin: NotificationOrigin
    ) {
      self.attentionState = attentionState
      self.body = body
      self.createdAt = createdAt
      self.title = title
      self.origin = origin
    }
  }

  public enum NotificationSemantic: Equatable, Sendable {
    case completion
    case attention
  }

  enum NotificationOrigin: Equatable, Sendable {
    case structuredAgent(NotificationSemantic)
    case terminalDesktop
    case generic
  }

  struct RecentStructuredNotification: Equatable, Sendable {
    let recordedAt: Date
    let semantic: NotificationSemantic
    let text: String
  }

  public enum AgentActivityTone: Equatable, Sendable {
    case attention
    case active
    case muted
  }

  public enum AgentActivityPhase: Equatable, Sendable {
    case needsInput
    case running
    case idle
  }

  public struct AgentActivity: Equatable, Sendable {
    public let kind: SupatermAgentKind
    public let phase: AgentActivityPhase
    public let detail: String?

    public init(
      kind: SupatermAgentKind,
      phase: AgentActivityPhase,
      detail: String? = nil
    ) {
      self.kind = kind
      self.phase = phase
      self.detail = normalizedTerminalAgentDetail(detail)
    }

    public static func claude(
      _ phase: AgentActivityPhase,
      detail: String? = nil
    ) -> Self {
      AgentActivity(kind: .claude, phase: phase, detail: detail)
    }

    public static func codex(
      _ phase: AgentActivityPhase,
      detail: String? = nil
    ) -> Self {
      AgentActivity(kind: .codex, phase: phase, detail: detail)
    }

    public var tone: AgentActivityTone {
      switch phase {
      case .needsInput:
        return .attention
      case .running:
        return .active
      case .idle:
        return .muted
      }
    }

    public var showsLeadingIndicator: Bool {
      switch phase {
      case .needsInput, .running:
        return true
      case .idle:
        return false
      }
    }
  }

  struct PaneAgentMetadata: Equatable, Sendable {
    var agentHoverMessages: [String] = []
    var progressRows: [PaneAgentProgressRow] = []
    var branchDetails: PaneAgentBranchDetails?
    var artifacts: [PaneAgentArtifact] = []

    var isEmpty: Bool {
      agentHoverMessages.isEmpty && panelPresentation().isEmpty
    }

    var hasStructuredPanelContent: Bool {
      !progressRows.isEmpty
    }

    func panelPresentation(session: PaneAgentPanelSession? = nil) -> PaneAgentPanelPresentation {
      PaneAgentPanelPresentation(
        progressRows: progressRows,
        branchDetails: branchDetails,
        artifacts: artifacts,
        session: session
      )
    }
  }

  public struct TabAgentPresentation: Equatable, Sendable {
    public let badgeActivities: [AgentActivity]
    public let badgeActivity: AgentActivity?
    public let badgeActivityIsFocused: Bool
    public let detailActivity: AgentActivity?
    public let hoverMarkdown: String?
  }

  struct FocusHistory: Equatable {
    var current: UUID
    var previous: UUID?

    init(current: UUID) {
      self.current = current
    }

    mutating func updateCurrent(_ surfaceID: UUID) {
      guard surfaceID != current else { return }
      previous = current
      current = surfaceID
    }
  }

  struct SurfaceLaunchCommand: Equatable {
    let command: String?
    let commandWrapper: [String]
    let usesZmx: Bool
  }

  struct InheritedSurfaceConfig: Equatable {
    let workingDirectory: URL?
    let fontSize: Float32?
  }

  struct ResolvedCreateTabTarget {
    let inheritedSurfaceID: UUID?
    let space: TerminalSpaceItem
  }

  struct ResolvedLocalCreateTabTarget {
    let inheritedSurfaceID: UUID?
    let spaceID: TerminalSpaceID
  }

  struct ResolvedCreatePaneTarget {
    let anchorSurface: GhosttySurfaceView
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
    let tree: SplitTree<GhosttySurfaceView>
  }

  struct ResolvedTabItemTarget {
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
  }

  struct ResolvedCreatePaneTab {
    let space: TerminalSpaceItem
    let tabID: TerminalTabID
    let tree: SplitTree<GhosttySurfaceView>
  }

  struct ResolvedPaneLocation {
    let paneIndex: Int
    let spaceIndex: Int
    let tabIndex: Int
  }
}
