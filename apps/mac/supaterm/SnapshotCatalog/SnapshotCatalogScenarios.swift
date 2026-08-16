import AppKit
import ComposableArchitecture
import Foundation
import Sharing
import SupaTheme
import SupatermCLIShared
import SupatermUpdateFeature
import SwiftUI

@testable import SupatermSettingsFeature

extension SnapshotCatalog {
  static let agentPanelScenarios: [SnapshotScenario] = [
    scenario(
      "progress-only",
      group: "Agent Panel",
      title: "Progress only",
      size: CGSize(width: 338, height: 178)
    ) { appearance in
      AnyView(
        AgentPanelSnapshotFixture(
          appearance: appearance,
          presentation: PaneAgentPanelPresentation(
            progressRows: [
              PaneAgentProgressRow(id: "goal", title: "Stabilize snapshot harness", status: .running, kind: .goal),
              PaneAgentProgressRow(id: "task-1", title: "Wire catalog scheme", status: .completed),
              PaneAgentProgressRow(id: "task-2", title: "Record baseline images", status: .running),
              PaneAgentProgressRow(id: "task-3", title: "Push branch", status: .pending),
            ]
          )
        )
      )
    },
    scenario(
      "branch-pr-checks",
      group: "Agent Panel",
      title: "Branch with failing checks",
      size: CGSize(width: 338, height: 312)
    ) { appearance in
      AnyView(
        AgentPanelSnapshotFixture(
          appearance: appearance,
          presentation: PaneAgentPanelPresentation(
            progressRows: [
              PaneAgentProgressRow(id: "task-1", title: "Waiting for review", status: .running)
            ],
            workingDirectoryPath: FileManager.default.homeDirectoryForCurrentUser
              .appending(path: "code/github.com/supabitapp/supaterm/apps/mac")
              .path(percentEncoded: false),
            branchDetails: PaneAgentBranchDetails(
              branchName: "feature/snapshot-catalog",
              addedLineCount: 1482,
              removedLineCount: 28,
              pullRequestStatus: PaneAgentPullRequestStatus(
                kind: .open,
                title: "PR #128",
                url: URL(string: "https://github.com/supabitapp/supaterm/pull/128"),
                addedLineCount: 1482,
                removedLineCount: 28,
                checks: PaneAgentPullRequestChecks(
                  status: .failing,
                  totalCount: 4,
                  items: [
                    PaneAgentPullRequestCheck(
                      name: "mac-check",
                      state: .failure,
                      workflowName: "test",
                      startedAt: Date(timeIntervalSince1970: 1_786_000_000),
                      completedAt: Date(timeIntervalSince1970: 1_786_000_420),
                      url: URL(string: "https://github.com/supabitapp/supaterm/actions")
                    ),
                    PaneAgentPullRequestCheck(name: "mac-test", state: .inProgress, workflowName: "test"),
                    PaneAgentPullRequestCheck(name: "inspect dependencies", status: .passing),
                    PaneAgentPullRequestCheck(name: "release archive", status: .skipped),
                  ]
                )
              )
            ),
            artifacts: [
              PaneAgentArtifact(
                title: "Snapshot diff bundle",
                url: URL(string: "https://supaterm.com/artifacts/snapshots")!
              )
            ],
            session: PaneAgentPanelSession.supported(agent: .codex, sessionID: "session-26-0701")!
          ),
          showsShortcutHints: true
        )
      )
    },
    scenario(
      "active-agents",
      group: "Agent Panel",
      title: "Active child agents",
      size: CGSize(width: 338, height: 190)
    ) { appearance in
      AnyView(
        AgentPanelSnapshotFixture(
          appearance: appearance,
          presentation: PaneAgentPanelPresentation(
            activeChildren: [
              TerminalAgentActiveChild(
                id: TerminalAgentActiveChild.Identity(
                  subagentID: "reviewer-1",
                  sessionID: "session-26-0701",
                  turnID: "turn-4"
                ),
                nickname: "Linnaeus",
                role: "reviewer",
                phase: .running,
                detail: "Reviewing native hook ownership"
              ),
              TerminalAgentActiveChild(
                id: TerminalAgentActiveChild.Identity(
                  subagentID: "tester-1",
                  sessionID: "session-26-0701",
                  turnID: "turn-4"
                ),
                nickname: "Turing",
                role: "tester",
                phase: .needsInput,
                detail: "Needs approval to run tests"
              ),
            ]
          )
        )
      )
    },
    scenario(
      "workflow-agents",
      group: "Agent Panel",
      title: "Workflow child agents",
      size: CGSize(width: 338, height: 240)
    ) { appearance in
      AnyView(
        AgentPanelSnapshotFixture(
          appearance: appearance,
          presentation: PaneAgentPanelPresentation(
            activeChildren: [
              workflowChild(
                subagentID: "a3b6b826",
                task: "Investigate compaction in codex-lb",
                contextTokens: 169_100,
                elapsed: 312
              ),
              workflowChild(
                subagentID: "ace7ef95",
                task: "Deep-read sticky session handling",
                contextTokens: 229_300,
                elapsed: 312
              ),
              workflowChild(
                subagentID: "aee5562e",
                task: "Establish which endpoints the CLI calls",
                contextTokens: 135_000,
                elapsed: 312
              ),
              workflowChild(
                subagentID: "add2ef43",
                task: "Audit the account pool",
                contextTokens: 33_084,
                elapsed: 147,
                phase: .idle
              ),
            ]
          )
        )
      )
    },
    scenario(
      "merge-queue",
      group: "Agent Panel",
      title: "Pull request in merge queue",
      size: CGSize(width: 338, height: 214)
    ) { appearance in
      AnyView(
        AgentPanelSnapshotFixture(
          appearance: appearance,
          presentation: PaneAgentPanelPresentation(
            workingDirectoryPath: FileManager.default.homeDirectoryForCurrentUser
              .appending(path: "code/github.com/supabitapp/supaterm")
              .path(percentEncoded: false),
            branchDetails: PaneAgentBranchDetails(
              branchName: "feature/merge-queue",
              addedLineCount: 42,
              removedLineCount: 7,
              pullRequestStatus: PaneAgentPullRequestStatus(
                kind: .open,
                title: "#132",
                url: URL(string: "https://github.com/supabitapp/supaterm/pull/132"),
                addedLineCount: 42,
                removedLineCount: 7,
                checks: nil,
                mergeAutomation: .mergeQueue
              )
            )
          )
        )
      )
    },
    scenario(
      "merged-pr",
      group: "Agent Panel",
      title: "Merged pull request",
      size: CGSize(width: 338, height: 258)
    ) { appearance in
      AnyView(
        AgentPanelSnapshotFixture(
          appearance: appearance,
          presentation: PaneAgentPanelPresentation(
            workingDirectoryPath: FileManager.default.homeDirectoryForCurrentUser
              .appending(path: "code/github.com/supabitapp/supaterm")
              .path(percentEncoded: false),
            branchDetails: PaneAgentBranchDetails(
              branchName: "feature/sidebar-polish",
              addedLineCount: 82,
              removedLineCount: 19,
              pullRequestStatus: PaneAgentPullRequestStatus(
                kind: .merged,
                title: "Merged PR #117",
                url: URL(string: "https://github.com/supabitapp/supaterm/pull/117"),
                addedLineCount: 82,
                removedLineCount: 19,
                checks: PaneAgentPullRequestChecks(
                  status: .passing,
                  totalCount: 3,
                  items: [
                    PaneAgentPullRequestCheck(name: "mac-check", status: .passing),
                    PaneAgentPullRequestCheck(name: "mac-test", status: .passing),
                    PaneAgentPullRequestCheck(name: "scan-dead-code", status: .passing),
                  ]
                )
              )
            )
          )
        )
      )
    },
    scenario(
      "actions-only",
      group: "Agent Panel",
      title: "Session actions",
      size: CGSize(width: 338, height: 128)
    ) { appearance in
      AnyView(
        AgentPanelSnapshotFixture(
          appearance: appearance,
          presentation: PaneAgentPanelPresentation(
            session: PaneAgentPanelSession.supported(agent: .codex, sessionID: "snapshot-actions")!
          ),
          forksDown: true,
          showsShortcutHints: true
        )
      )
    },
  ]

  private static func workflowChild(
    subagentID: String,
    task: String,
    contextTokens: Int,
    elapsed: TimeInterval,
    phase: AgentActivityPhase = .running
  ) -> TerminalAgentActiveChild {
    let now = Date()
    return TerminalAgentActiveChild(
      id: TerminalAgentActiveChild.Identity(
        subagentID: subagentID,
        sessionID: "session-26-0701",
        turnID: "turn-4"
      ),
      kind: .workflow,
      nickname: "codex-balancer-research",
      role: "workflow-subagent",
      transcriptPath:
        "/tmp/session/subagents/workflows/wf_2c58973b/agent-\(subagentID).jsonl",
      task: task,
      phase: phase,
      detail: nil,
      usage: TerminalAgentChildUsage(
        model: "claude-opus-5",
        contextTokens: contextTokens,
        startedAt: now.addingTimeInterval(-elapsed),
        lastActiveAt: now
      )
    )
  }

  static let updateScenarios: [SnapshotScenario] = [
    updateScenario("permission", title: "Permission request", phase: .permissionRequest),
    updateScenario("checking", title: "Checking", phase: .checking),
    updateScenario(
      "available",
      title: "Update available",
      phase: .updateAvailable(
        UpdatePhase.Available(
          buildVersion: "260100",
          contentLength: 82_300_000,
          releaseDate: Date(timeIntervalSince1970: 1_785_888_000),
          version: "26.1.0"
        )
      )
    ),
    updateScenario(
      "downloading",
      title: "Downloading",
      phase: .downloading(
        UpdatePhase.Downloading(expectedLength: 82_300_000, progress: 46_900_000)
      )
    ),
    updateScenario(
      "extracting",
      title: "Extracting",
      phase: .extracting(UpdatePhase.Extracting(progress: 0.72))
    ),
    updateScenario(
      "manual-installing",
      title: "Manual installing",
      phase: .installing(UpdatePhase.Installing(isAutoUpdate: false, version: "26.1.0"))
    ),
    updateScenario(
      "auto-ready",
      title: "Auto update ready",
      phase: .installing(UpdatePhase.Installing(isAutoUpdate: true, version: "26.1.0"))
    ),
    updateScenario("not-found", title: "No updates found", phase: .notFound),
    updateScenario(
      "error",
      title: "Update error",
      phase: .error(UpdatePhase.Failure(message: "Unable to reach the update server."))
    ),
    scenario(
      "release-short",
      group: "Update Cards",
      title: "Release announcement",
      size: CGSize(width: 320, height: 460)
    ) { appearance in
      AnyView(
        SidebarCardSnapshotFixture(appearance: appearance) { palette in
          ReleaseAnnouncementCardView(
            announcement: .finalBeta,
            palette: palette,
            dismiss: {}
          )
        }
      )
    },
  ]

  static let commandPaletteScenarios: [SnapshotScenario] = [
    commandPaletteScenario(
      "default",
      title: "Default results",
      state: TerminalCommandPaletteState(selectedRowID: "focus:window-a:surface-a"),
      rows: commandPaletteRows
    ),
    commandPaletteScenario(
      "query",
      title: "Filtered query",
      state: TerminalCommandPaletteState(query: "update", selectedRowID: "update:restart"),
      rows: commandPaletteRows
    ),
    commandPaletteScenario(
      "word-initial-query",
      title: "Word initial query",
      state: TerminalCommandPaletteState(query: "ntw", selectedRowID: "terminal:new-tab-window"),
      rows: commandPaletteRows
    ),
    commandPaletteScenario(
      "empty",
      title: "No matches",
      state: TerminalCommandPaletteState(query: "zzzzz"),
      rows: commandPaletteRows
    ),
    commandPaletteScenario(
      "command-held",
      title: "Command held",
      state: TerminalCommandPaletteState(selectedRowID: "supaterm:create-space"),
      rows: commandPaletteRows,
      commandHeld: true
    ),
  ]

  static let dialogScenarios: [SnapshotScenario] = [
    scenario(
      "confirmation",
      group: "Dialogs",
      title: "Destructive confirmation",
      size: CGSize(width: 640, height: 420)
    ) { appearance in
      AnyView(
        DialogSnapshotFixture(appearance: appearance) { palette in
          ConfirmationOverlay(
            palette: palette,
            title: "Close all tabs?",
            message: "Every visible terminal tab in this window will close.",
            confirmTitle: "Close Tabs",
            onConfirm: {},
            onCancel: {}
          )
        }
      )
    },
    scenario(
      "quit-preserve",
      group: "Dialogs",
      title: "Quit preserving sessions",
      size: CGSize(width: 720, height: 420)
    ) { appearance in
      AnyView(
        DialogSnapshotFixture(appearance: appearance) { palette in
          QuitConfirmationOverlay(
            palette: palette,
            content: QuitConfirmationContent(terminatesSessions: false),
            onPreserve: {},
            onTerminate: {},
            onCancel: {}
          )
        }
      )
    },
    scenario(
      "quit-terminate",
      group: "Dialogs",
      title: "Quit terminating sessions",
      size: CGSize(width: 720, height: 420)
    ) { appearance in
      AnyView(
        DialogSnapshotFixture(appearance: appearance) { palette in
          QuitConfirmationOverlay(
            palette: palette,
            content: QuitConfirmationContent(terminatesSessions: true),
            onPreserve: {},
            onTerminate: {},
            onCancel: {}
          )
        }
      )
    },
    scenario(
      "space-name-valid",
      group: "Dialogs",
      title: "Space name valid",
      size: CGSize(width: 640, height: 360)
    ) { appearance in
      AnyView(
        DialogSnapshotFixture(appearance: appearance) { palette in
          SpaceEditorOverlay(
            palette: palette,
            title: "Edit Space",
            confirmTitle: "Save",
            name: .constant("Release work"),
            color: .constant(.blue),
            isSaveEnabled: true,
            onSave: {},
            onCancel: {}
          )
        }
      )
    },
    scenario(
      "space-name-invalid",
      group: "Dialogs",
      title: "Space name invalid",
      size: CGSize(width: 640, height: 360)
    ) { appearance in
      AnyView(
        DialogSnapshotFixture(appearance: appearance) { palette in
          SpaceEditorOverlay(
            palette: palette,
            title: "Create Space",
            confirmTitle: "Create",
            name: .constant(""),
            color: .constant(.neutral),
            isSaveEnabled: false,
            onSave: {},
            onCancel: {}
          )
        }
      )
    },
  ]

  static let settingsScenarios: [SnapshotScenario] = [
    settingsScenario("general", title: "General", tab: .general),
    settingsScenario(
      "terminal-loaded",
      title: "Terminal loaded",
      tab: .terminal,
      variant: .terminalLoaded
    ),
    settingsScenario(
      "terminal-warning",
      title: "Terminal warning",
      tab: .terminal,
      variant: .terminalWarning
    ),
    settingsScenario(
      "terminal-error",
      title: "Terminal error",
      tab: .terminal,
      variant: .terminalError
    ),
    settingsScenario("notifications", title: "Notifications", tab: .notifications),
    settingsScenario(
      "coding-agents-enabled",
      title: "Coding agents enabled",
      tab: .codingAgents,
      variant: .codingAgentsEnabled
    ),
    settingsScenario(
      "coding-agents-unavailable",
      title: "Coding agents unavailable",
      tab: .codingAgents,
      variant: .codingAgentsUnavailable
    ),
    settingsScenario(
      "coding-agents-install-failure",
      title: "Coding agents install failure",
      tab: .codingAgents,
      variant: .codingAgentsInstallFailure
    ),
    settingsScenario("advanced", title: "Advanced", tab: .advanced),
    settingsScenario(
      "about-update",
      title: "About update controls",
      tab: .about,
      variant: .aboutUpdate
    ),
  ]
}

private struct AgentPanelSnapshotFixture: View {
  let appearance: SnapshotAppearance
  let presentation: PaneAgentPanelPresentation
  var forksDown = false
  var showsShortcutHints = false

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    AgentPanelView(
      presentation: presentation,
      palette: palette,
      forksDown: forksDown,
      showsShortcutHints: showsShortcutHints,
      copyText: { _ in },
      forkSession: { _, _ in },
      openURL: { _ in }
    )
    .background(palette.agentPanelBackground, in: .rect(cornerRadius: AgentPanelMetrics.expandedCornerRadius))
    .padding(16)
    .background(terminalBackdrop)
  }

  private var terminalBackdrop: Color {
    appearance.colorScheme == .dark ? Color(white: 0.07) : Color(white: 0.94)
  }
}

private struct SidebarCardSnapshotFixture<Content: View>: View {
  let appearance: SnapshotAppearance
  let content: (Palette) -> Content

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    content(palette)
      .padding(10)
      .background(palette.detailBackground)
  }
}

private struct TerminalSidebarUpdateSnapshotFixture: View {
  let appearance: SnapshotAppearance
  let phase: UpdatePhase

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    TerminalSidebarUpdateSection(
      store: store,
      palette: palette
    )
    .padding(10)
    .background(palette.detailBackground)
  }

  private var store: StoreOf<UpdateFeature> {
    Store(
      initialState: UpdateFeature.State(
        canCheckForUpdates: true,
        phase: phase
      )
    ) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient = .testValue
    }
  }
}

private struct CommandPaletteSnapshotFixture: View {
  let appearance: SnapshotAppearance
  let state: TerminalCommandPaletteState
  let matches: [TerminalCommandPaletteMatch]
  let commandHeld: Bool

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    ZStack {
      LinearGradient(
        colors: backgroundColors,
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )

      TerminalCommandPaletteOverlay(
        palette: palette,
        state: state,
        matches: matches,
        onActivate: {},
        onClose: {},
        onQueryChange: { _ in },
        onMoveSelection: { _ in },
        onSelectionChange: { _ in }
      )
    }
    .environment(commandObserver)
  }

  private var backgroundColors: [Color] {
    appearance == .dark
      ? [
        Color(red: 0.16, green: 0.16, blue: 0.18),
        Color(red: 0.06, green: 0.06, blue: 0.08),
      ]
      : [
        Color(red: 0.98, green: 0.95, blue: 0.91),
        Color(red: 0.89, green: 0.92, blue: 0.96),
      ]
  }

  private var commandObserver: CommandHoldObserver {
    let observer = CommandHoldObserver()
    observer.isPressed = commandHeld
    return observer
  }
}

private struct DialogSnapshotFixture<Content: View>: View {
  let appearance: SnapshotAppearance
  let content: (Palette) -> Content

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    content(palette)
      .background(palette.detailBackground)
  }
}

private enum SettingsSnapshotVariant {
  case standard
  case terminalLoaded
  case terminalWarning
  case terminalError
  case codingAgentsEnabled
  case codingAgentsUnavailable
  case codingAgentsInstallFailure
  case aboutUpdate
}

private struct SettingsSnapshotFixture: View {
  let store: StoreOf<SettingsFeature>

  init(tab: SettingsFeature.Tab, variant: SettingsSnapshotVariant) {
    store = Self.store(tab: tab, variant: variant)
  }

  var body: some View {
    SettingsTabContentView(store: store, tab: store.selectedTab)
      .background(Color(nsColor: .windowBackgroundColor))
  }

  private static func store(
    tab: SettingsFeature.Tab,
    variant: SettingsSnapshotVariant
  ) -> StoreOf<SettingsFeature> {
    var state = SettingsFeature.State()
    state.selectedTab = tab
    switch variant {
    case .terminalLoaded:
      state.terminal = SettingsTerminalState(
        snapshot: terminalSettingsSnapshot(warningMessage: nil)
      )
    case .terminalWarning:
      state.terminal = SettingsTerminalState(
        snapshot: terminalSettingsSnapshot(
          warningMessage: "Theme file has duplicate keys; Supaterm kept the last value."
        )
      )
    case .terminalError:
      state.terminal = SettingsTerminalState(
        snapshot: terminalSettingsSnapshot(warningMessage: nil),
        errorMessage: "Could not read \(SnapshotFixtureValues.ghosttyConfigPath)."
      )
    case .codingAgentsEnabled:
      state.codexIntegration.health = .healthy
      state.piIntegration.health = .healthy
    case .codingAgentsUnavailable:
      state.piIntegration.health = .unavailable
    case .codingAgentsInstallFailure:
      let message = "Unable to update hooks because the settings file is read-only."
      state.codexIntegration.errorMessage = message
      state.codexIntegration.health = .healthy
      state.agentIntegrationInstallFailure = SettingsAgentIntegrationInstallFailure(
        agent: .codex,
        log: message
      )
    case .aboutUpdate:
      state.about.updatesAutomaticallyDownloadUpdates = false
    case .standard:
      break
    }

    let store = Store(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient = GhosttyTerminalSettingsClient(
        load: {
          try await Task.sleep(for: .seconds(3600))
          throw CancellationError()
        },
        apply: { settings in
          GhosttyTerminalSettingsValues(
            confirmCloseSurface: settings.confirmCloseSurface,
            configPath: SnapshotFixtureValues.ghosttyConfigPath,
            darkTheme: settings.darkTheme,
            fontFamily: settings.fontFamily,
            fontSize: settings.fontSize,
            lightTheme: settings.lightTheme,
            warningMessage: nil
          )
        }
      )
      $0.updateClient = .testValue
    }

    return store
  }

  private static func terminalSettingsSnapshot(
    warningMessage: String?
  ) -> GhosttyTerminalSettingsSnapshot {
    GhosttyTerminalSettingsSnapshot(
      availableFontFamilies: ["Berkeley Mono", "JetBrains Mono", "SF Mono"],
      availableDarkThemes: ["Builtin Dark", "Zenbones Dark", "Supaterm Night"],
      availableLightThemes: ["Builtin Light", "Zenbones Light", "Supaterm Day"],
      confirmCloseSurface: .whenNotAtPrompt,
      configPath: SnapshotFixtureValues.ghosttyConfigPath,
      darkTheme: "Supaterm Night",
      fontFamily: "Berkeley Mono",
      fontSize: 15,
      lightTheme: "Supaterm Day",
      warningMessage: warningMessage
    )
  }
}

enum SnapshotFixtureValues {
  nonisolated static let homeDirectory = "/tmp/supaterm-snapshot/home"
  nonisolated static let workspaceDirectory = "/tmp/supaterm-snapshot/workspace"

  nonisolated static let ghosttyConfigPath = "\(homeDirectory)/.config/ghostty/config"

  nonisolated static func workspace(_ path: String = "") -> String {
    path.isEmpty ? workspaceDirectory : "\(workspaceDirectory)/\(path)"
  }

  static func uuid(_ value: String) -> UUID {
    UUID(uuidString: value)!
  }
}

extension SnapshotCatalog {
  fileprivate static func updateScenario(
    _ id: String,
    title: String,
    phase: UpdatePhase
  ) -> SnapshotScenario {
    scenario(
      id,
      group: "Update Cards",
      title: title,
      size: CGSize(width: 320, height: 168)
    ) { appearance in
      AnyView(TerminalSidebarUpdateSnapshotFixture(appearance: appearance, phase: phase))
    }
  }

  fileprivate static func commandPaletteScenario(
    _ id: String,
    title: String,
    state: TerminalCommandPaletteState,
    rows: [TerminalCommandPaletteRow],
    commandHeld: Bool = false
  ) -> SnapshotScenario {
    scenario(
      id,
      group: "Command Palette",
      title: title,
      size: CGSize(width: 840, height: 420)
    ) { appearance in
      AnyView(
        CommandPaletteSnapshotFixture(
          appearance: appearance,
          state: state,
          matches: TerminalCommandPalettePresentation.matches(in: rows, query: state.query),
          commandHeld: commandHeld
        )
      )
    }
  }

  fileprivate static func settingsScenario(
    _ id: String,
    title: String,
    tab: SettingsFeature.Tab,
    variant: SettingsSnapshotVariant = .standard
  ) -> SnapshotScenario {
    scenario(
      id,
      group: "Settings",
      title: title,
      size: CGSize(width: 820, height: 560)
    ) { _ in
      AnyView(SettingsSnapshotFixture(tab: tab, variant: variant))
    }
  }

  fileprivate static var commandPaletteRows: [TerminalCommandPaletteRow] {
    [
      TerminalCommandPaletteRow(
        id: "focus:window-a:surface-a",
        title: "Focus: mac-check",
        subtitle: "apps/mac",
        description: nil,
        leadingIcon: "rectangle.on.rectangle",
        badge: nil,
        emphasis: false,
        shortcut: nil,
        command: .focusPane(
          TerminalCommandPaletteFocusTarget(
            windowControllerID: SnapshotFixtureValues.uuid("20000000-0000-0000-0000-000000000001"),
            surfaceID: SnapshotFixtureValues.uuid("20000000-0000-0000-0000-000000000002"),
            title: "mac-check",
            subtitle: "apps/mac"
          )
        )
      ),
      TerminalCommandPaletteRow(
        id: "supaterm:create-space",
        title: "Create Space",
        subtitle: "Spaces",
        description: nil,
        leadingIcon: "plus.rectangle.on.rectangle",
        badge: nil,
        emphasis: false,
        shortcut: nil,
        command: .createSpace
      ),
      TerminalCommandPaletteRow(
        id: "supaterm:toggle-sidebar",
        title: "Toggle Sidebar",
        subtitle: "View",
        description: nil,
        leadingIcon: "sidebar.left",
        badge: nil,
        emphasis: false,
        shortcut: "⌘S",
        command: .toggleSidebar
      ),
      TerminalCommandPaletteRow(
        id: "update:restart",
        title: "Restart to Update",
        subtitle: "Supaterm 26.1.0 is ready",
        description: "Restart Supaterm and install the downloaded update.",
        leadingIcon: "arrow.triangle.2.circlepath",
        badge: "Update",
        emphasis: true,
        shortcut: nil,
        command: .update(.restartNow)
      ),
      TerminalCommandPaletteRow(
        id: "update:later",
        title: "Install After Next Restart",
        subtitle: "Update",
        description: nil,
        leadingIcon: "clock",
        badge: nil,
        emphasis: false,
        shortcut: nil,
        command: .update(.installAfterNextRestart)
      ),
      TerminalCommandPaletteRow(
        id: "terminal:split-right",
        title: "Split Pane Right",
        subtitle: "Terminal",
        description: nil,
        leadingIcon: "rectangle.split.2x1",
        badge: nil,
        emphasis: false,
        shortcut: "⌘D",
        command: .ghosttyBindingAction("new_split:right")
      ),
      TerminalCommandPaletteRow(
        id: "terminal:find",
        title: "Find in Terminal",
        subtitle: "Terminal",
        description: nil,
        leadingIcon: "magnifyingglass",
        badge: nil,
        emphasis: false,
        shortcut: "⌘F",
        command: .ghosttyBindingAction("start_search")
      ),
    ]
  }
}
