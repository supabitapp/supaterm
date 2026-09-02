import Foundation
import SupaTheme
import SupatermUpdateFeature
import SwiftUI

extension SnapshotCatalog {
  static let sidebarScenarios: [SnapshotScenario] = [
    scenario(
      "full",
      group: "Sidebar",
      title: "Full sidebar chrome",
      size: CGSize(width: 280, height: 560)
    ) { appearance in
      AnyView(
        SidebarChromeSnapshotFixture(
          appearance: appearance,
          fixedHoveredGroupID: nil
        )
      )
    },
    scenario(
      "full-group-hover",
      group: "Sidebar",
      title: "Full sidebar group hover",
      size: CGSize(width: 280, height: 560)
    ) { appearance in
      AnyView(
        SidebarChromeSnapshotFixture(
          appearance: appearance,
          fixedHoveredGroupID: SidebarChromeSnapshotContext.groupID
        )
      )
    },
    scenario(
      "compact-update",
      group: "Sidebar",
      title: "Compact restart update",
      size: CGSize(width: 280, height: 560)
    ) { appearance in
      AnyView(
        SidebarChromeSnapshotFixture(
          appearance: appearance,
          fixedHoveredGroupID: nil,
          updatePhase: .installing(
            UpdatePhase.Installing(isAutoUpdate: true, showsPrompt: false)
          )
        )
      )
    },
    scenario(
      "overflow",
      group: "Sidebar",
      title: "Overflowing sidebar",
      size: CGSize(width: 280, height: 300)
    ) { appearance in
      AnyView(
        SidebarChromeSnapshotFixture(
          appearance: appearance,
          fixedHoveredGroupID: nil
        )
      )
    },
    scenario(
      "selected-before-new-tab",
      group: "Sidebar",
      title: "Selected tab before new tab",
      size: CGSize(width: 280, height: 220)
    ) { appearance in
      AnyView(
        SidebarChromeSnapshotFixture(
          appearance: appearance,
          fixedHoveredGroupID: nil,
          terminal: SidebarChromeSnapshotContext.selectedBeforeNewTabTerminal
        )
      )
    },
    scenario(
      "space-dots",
      group: "Sidebar",
      title: "Space page dots",
      size: CGSize(width: 280, height: 44)
    ) { appearance in
      AnyView(SpacePageDotsSnapshotFixture(appearance: appearance))
    },
    scenario(
      "space-dots-paging",
      group: "Sidebar",
      title: "Space page dots mid swipe",
      size: CGSize(width: 280, height: 44)
    ) { appearance in
      AnyView(SpacePageDotsSnapshotFixture(appearance: appearance, position: 1.4))
    },
    scenario(
      "window-controls",
      group: "Sidebar",
      title: "Window controls above selected tab",
      size: CGSize(width: 280, height: 160)
    ) { appearance in
      AnyView(
        SidebarWindowControlsSnapshotFixture(appearance: appearance)
      )
    },
    scenario(
      "window-controls-group",
      group: "Sidebar",
      title: "Window controls above selected group",
      size: CGSize(width: 560, height: 220)
    ) { appearance in
      AnyView(
        SidebarWindowControlsSnapshotFixture(
          appearance: appearance,
          terminal: SidebarChromeSnapshotContext.selectedGroupTerminal
        )
      )
    },
    scenario(
      "rest",
      group: "Sidebar Rows",
      title: "Resting shell tab",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000008",
            title: "supaterm - fish",
            paneFixtures: [SidebarRowSnapshotPane(title: "fish")]
          )
        )
      )
    },
    scenario(
      "basic-selected",
      group: "Sidebar Rows",
      title: "Selected shell tab",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000001",
            title: "supaterm - fish",
            selection: .primary,
            isTitleLocked: true,
            paneFixtures: [SidebarRowSnapshotPane(title: "fish")]
          )
        )
      )
    },
    scenario(
      "pinned-hover",
      group: "Sidebar Rows",
      title: "Pinned hover shortcut",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000002",
            title: "release-check",
            isPinned: true,
            isRowHovering: true,
            paneFixtures: [SidebarRowSnapshotPane(title: "release-check")],
            shortcutHint: "⌘2",
            showsShortcutHint: true
          )
        )
      )
    },
    scenario(
      "agent-running-hover",
      group: "Sidebar Rows",
      title: "Hovered running coding agent",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000013",
            title: "Codex",
            isRowHovering: true,
            paneFixtures: [
              .agent("khoi/routine-ui", status: .working)
            ]
          )
        )
      )
    },
    scenario(
      "agent-running-command",
      group: "Sidebar Rows",
      title: "Command shortcut replaces running coding agent",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000015",
            title: "khoi/routine-ui",
            selection: .primary,
            paneFixtures: [
              .agent("khoi/routine-ui", status: .working)
            ],
            shortcutHint: "⌘1",
            showsShortcutHint: true
          )
        )
      )
    },
    scenario(
      "two-panes-hover",
      group: "Sidebar Rows",
      title: "Hovered tab with two panes",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000014",
            title: "Review authentication",
            isRowHovering: true,
            paneFixtures: [
              .agent("Codex auth", status: .working),
              SidebarRowSnapshotPane(title: "swift test", hasAttention: true),
            ]
          )
        )
      )
    },
    scenario(
      "two-panes-command",
      group: "Sidebar Rows",
      title: "Command shortcut replaces two-pane statuses",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000016",
            title: "Review authentication",
            paneFixtures: [
              .agent("Codex auth", status: .working),
              SidebarRowSnapshotPane(title: "swift test", hasAttention: true),
            ],
            shortcutHint: "⌘2",
            showsShortcutHint: true
          )
        )
      )
    },
    scenario(
      "secondary-selection",
      group: "Sidebar Rows",
      title: "Secondary selected shell tab",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000007",
            title: "supaterm - fish",
            selection: .secondary,
            paneFixtures: [SidebarRowSnapshotPane(title: "fish")]
          )
        )
      )
    },
    scenario(
      "pressed",
      group: "Sidebar Rows",
      title: "Pressed shell tab",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000009",
            title: "supaterm - fish",
            isPressed: true,
            paneFixtures: [SidebarRowSnapshotPane(title: "fish")]
          )
        )
      )
    },
    scenario(
      "unread-text",
      group: "Sidebar Rows",
      title: "Pane attention bells",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000003",
            title: "Build failures",
            paneFixtures: [
              SidebarRowSnapshotPane(title: "swift build", hasAttention: true),
              SidebarRowSnapshotPane(title: "swift test", hasAttention: true),
            ]
          )
        )
      )
    },
    scenario(
      "agent-attention-priority",
      group: "Sidebar Rows",
      title: "Agent state hides same-pane attention",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000012",
            title: "Agent and shell attention",
            paneFixtures: [
              .agent("Codex", status: .working, hasAttention: true),
              SidebarRowSnapshotPane(title: "swift test", hasAttention: true),
            ]
          )
        )
      )
    },
    scenario(
      "agent-running",
      group: "Sidebar Rows",
      title: "Running coding agent",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentRunning
        )
      )
    },
    scenario(
      "agent-running-narrow",
      group: "Sidebar Rows",
      title: "Running coding agent, narrow",
      size: CGSize(width: 220, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentRunning
        )
      )
    },
    scenario(
      "agent-running-multiple",
      group: "Sidebar Rows",
      title: "Running coding agents on two branches",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentRunningMultiple
        )
      )
    },
    scenario(
      "agent-six-panes",
      group: "Sidebar Rows",
      title: "Six coding agent panes",
      size: CGSize(width: 320, height: 170)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .sixAgents
        )
      )
    },
    scenario(
      "agent-needs-input",
      group: "Sidebar Rows",
      title: "Agent needs input",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentNeedsInput
        )
      )
    },
    scenario(
      "agent-needs-input-narrow",
      group: "Sidebar Rows",
      title: "Agent needs input, narrow",
      size: CGSize(width: 220, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentNeedsInput
        )
      )
    },
    scenario(
      "agent-done",
      group: "Sidebar Rows",
      title: "Agent done",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentDone
        )
      )
    },
    scenario(
      "agent-done-narrow",
      group: "Sidebar Rows",
      title: "Agent done, narrow",
      size: CGSize(width: 220, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentDone
        )
      )
    },
    scenario(
      "progress-paused",
      group: "Sidebar Rows",
      title: "Paused terminal progress",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000007",
            title: "Archive export",
            paneFixtures: [SidebarRowSnapshotPane(title: "tar -czf release.tar.gz")],
            terminalProgress: TerminalSidebarTerminalProgress(fraction: 0.68, tone: .paused)
          )
        )
      )
    },
    scenario(
      "long-path-title",
      group: "Sidebar Rows",
      title: "Long path title",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000008",
            title: SnapshotFixtureValues.workspace("apps/mac/supaterm/SnapshotCatalog"),
            paneFixtures: [
              SidebarRowSnapshotPane(
                title: SnapshotFixtureValues.workspace("apps/mac/supaterm/SnapshotCatalog")
              ),
              SidebarRowSnapshotPane(
                title: "swift run SnapshotCatalog",
                hasAttention: true
              ),
            ]
          )
        )
      )
    },
    scenario(
      "locked-mixed-icons",
      group: "Sidebar Rows",
      title: "Locked tab with mixed pane icons",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000017",
            title: "Review authentication",
            isTitleLocked: true,
            paneFixtures: [
              .agent("Agent"),
              SidebarRowSnapshotPane(title: "Shell"),
            ]
          )
        )
      )
    },
    scenario(
      "locked-agent-icons",
      group: "Sidebar Rows",
      title: "Locked tab with matching agent icons",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000018",
            title: "Review authentication",
            isTitleLocked: true,
            paneFixtures: [
              .agent("Agent one"),
              .agent("Agent two"),
            ]
          )
        )
      )
    },
  ]

  static let codingAgentMarkScenarios =
    TerminalCodingAgentCatalog.all.enumerated().map { index, agent in
      scenario(
        "agent-mark-\(agent.id)",
        group: "Sidebar Rows",
        title: "\(agent.id) agent mark",
        size: CGSize(width: 320, height: 72)
      ) { appearance in
        AnyView(
          SidebarRowSnapshotFixture(
            appearance: appearance,
            item: SidebarRowSnapshotItem(
              id: String(format: "10000000-0000-0000-0000-%012X", index + 100),
              title: agent.id,
              paneFixtures: [
                .agent(agent.id, mark: agent.markImageName)
              ]
            )
          )
        )
      }
    }
}

private struct SidebarRowSnapshotPane {
  let title: String
  var icon: TerminalSidebarPanePresentation.Icon = .terminal
  var agentStatus: TerminalHostState.TabAgentStatus?
  var hasAttention = false

  static func agent(
    _ title: String,
    mark: String = "codex-mark",
    status: TerminalHostState.TabAgentStatus? = nil,
    hasAttention: Bool = false
  ) -> Self {
    Self(title: title, icon: .agent(mark), agentStatus: status, hasAttention: hasAttention)
  }
}

private struct SidebarRowSnapshotItem {
  let id: String
  let title: String
  var selection: SelectableRowSelection = .none
  var isPinned = false
  var isRowHovering = false
  var isPressed = false
  var isTitleLocked = false
  var paneFixtures: [SidebarRowSnapshotPane] = []
  var terminalProgress: TerminalSidebarTerminalProgress?
  var shortcutHint: String?
  var showsShortcutHint = false

  var tab: TerminalTabItem {
    TerminalTabItem(
      id: TerminalTabID(rawValue: SnapshotFixtureValues.uuid(id)),
      title: title,
      isTitleLocked: isTitleLocked
    )
  }

  var isSelected: Bool { selection != .none }

  var panes: [TerminalSidebarPanePresentation] {
    paneFixtures.enumerated().map { index, pane in
      return TerminalSidebarPanePresentation(
        id: UUID(uuidString: String(format: "00000000-0000-0000-0000-%012X", index + 1))!,
        title: pane.title,
        icon: pane.icon,
        indicator: pane.agentStatus.map(TerminalSidebarPanePresentation.Indicator.agent)
          ?? (pane.hasAttention ? .attention : nil)
      )
    }
  }

  static var agentRunning: Self {
    SidebarRowSnapshotItem(
      id: "10000000-0000-0000-0000-000000000004",
      title: "Codex",
      paneFixtures: [
        .agent("khoi/routine-ui-what-happened | Thinking | Tasks 5/5", status: .working)
      ]
    )
  }

  static var agentRunningMultiple: Self {
    SidebarRowSnapshotItem(
      id: "10000000-0000-0000-0000-000000000010",
      title: "Review authentication",
      paneFixtures: [
        .agent("Codex auth", status: .working),
        .agent("Review token expiry", status: .done),
      ]
    )
  }

  static var sixAgents: Self {
    SidebarRowSnapshotItem(
      id: "10000000-0000-0000-0000-000000000011",
      title: "Coding agents",
      paneFixtures: [
        .agent("Codex 1", status: .working),
        .agent("Codex 2", status: .done),
        .agent("Codex 3", status: .needsInput),
        .agent("Review 1", status: .working),
        .agent("Review 2", status: .done),
        .agent("Review 3", status: .needsInput),
      ]
    )
  }

  static var agentNeedsInput: Self {
    SidebarRowSnapshotItem(
      id: "10000000-0000-0000-0000-000000000005",
      title: "Release note pass",
      paneFixtures: [
        .agent("Review agent", status: .needsInput)
      ]
    )
  }

  static var agentDone: Self {
    SidebarRowSnapshotItem(
      id: "10000000-0000-0000-0000-000000000006",
      title: "Docs audit",
      paneFixtures: [
        .agent("Codex", status: .done)
      ]
    )
  }
}

private struct SidebarRowSnapshotFixture: View {
  let appearance: SnapshotAppearance
  let item: SidebarRowSnapshotItem
  var outerPadding: CGFloat = 10

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    TerminalSidebarTabSummaryView(
      tab: item.tab,
      palette: palette,
      isSelected: item.isSelected,
      isPinned: item.isPinned,
      panes: item.panes,
      terminalProgress: item.terminalProgress,
      shortcutHint: item.shortcutHint,
      showsShortcutHint: item.showsShortcutHint,
      isRowHovering: item.isRowHovering
    )
    .lineLimit(10)
    .padding(.horizontal, TerminalSidebarLayout.rowHorizontalPadding)
    .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
    .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      rowAppearance.fill(
        selection: item.selection,
        isPressed: item.isPressed,
        isHovering: item.isRowHovering
      )
    )
    .modifier(
      SelectableRowChrome(
        selection: item.selection,
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        appearance: rowAppearance,
        showsSelectionEdge: true
      )
    )
    .overlay(alignment: .trailing) {
      if item.isRowHovering {
        TerminalSidebarTabCloseButton(
          palette: palette,
          isSelected: item.isSelected,
          action: {}
        )
      }
    }
    .padding(outerPadding)
    .background(palette.detailBackground)
  }

  private var rowAppearance: SelectableRowStyle.ResolvedAppearance {
    SelectableRowStyle.Appearance.sidebar.resolve(palette: palette)
  }
}
