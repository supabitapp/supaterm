import Foundation
import SupatermCLIShared
import SupatermTerminalFeature
import SupatermTerminalModels
import SupatermTerminalPresentationFeature

enum TerminalSidebarTabPreviewSection: String, CaseIterable, Identifiable {
  case shellTitles = "Shell Titles"
  case splitPanes = "Split Panes"
  case codingAgents = "Coding Agent States"
  case terminalProgress = "Terminal Progress"
  case attention = "Attention States"

  var id: String {
    rawValue
  }
}

struct TerminalSidebarTabPreviewItem: Identifiable {
  private let previewID: String
  private let tabID: TerminalTabID

  let section: TerminalSidebarTabPreviewSection
  let scenario: String
  let title: String
  let isSelected: Bool
  let notificationPreviewMarkdown: String?
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let agentActivity: TerminalHostState.AgentActivity?
  let hasTerminalBell: Bool
  let terminalProgress: TerminalSidebarTerminalProgress?

  var id: String {
    previewID
  }

  var tab: TerminalTabItem {
    TerminalTabItem(
      id: tabID,
      title: title,
      isDirty: section == .terminalProgress
    )
  }

  var metadataLine: String? {
    let values = [
      stateLabel,
      isSelected ? "Selected" : nil,
      paneCountLabel,
      notificationPreviewMarkdown == nil ? nil : "Message",
    ]
    .compactMap { $0 }

    guard !values.isEmpty else { return nil }
    return values.joined(separator: " • ")
  }

  private var stateLabel: String? {
    guard let statusAccessory else {
      return nil
    }
    switch statusAccessory {
    case .agentActivity(let activity):
      return "\(activity.kind.notificationTitle) \(phaseLabel(activity.phase))"
    case .pinned:
      return "Pinned"
    case .terminalBell:
      return "Terminal Bell"
    case .terminalProgress:
      return "Terminal Progress"
    case .unreadCount(let count):
      return "Unread \(count)"
    }
  }

  private var paneCountLabel: String? {
    guard !paneWorkingDirectories.isEmpty else { return nil }
    let count = paneWorkingDirectories.count
    return "\(count) pane\(count == 1 ? "" : "s")"
  }

  private var statusAccessory: TerminalSidebarTabSummaryView.StatusAccessory? {
    TerminalSidebarTabSummaryView.statusAccessory(
      isPinned: tab.isPinned,
      unreadCount: unreadCount,
      agentActivity: agentActivity,
      terminalProgress: terminalProgress,
      hasTerminalBell: hasTerminalBell,
      showsAgentSpinner: true
    )
  }

  init(
    section: TerminalSidebarTabPreviewSection,
    scenario: String,
    title: String,
    id: String,
    isSelected: Bool = false,
    notificationPreviewMarkdown: String? = nil,
    paneWorkingDirectories: [String] = [],
    unreadCount: Int = 0,
    agentActivity: TerminalHostState.AgentActivity? = nil,
    hasTerminalBell: Bool = false,
    terminalProgress: TerminalSidebarTerminalProgress? = nil
  ) {
    previewID = id
    tabID = TerminalTabID(rawValue: Self.uuid(id))
    self.section = section
    self.scenario = scenario
    self.title = title
    self.isSelected = isSelected
    self.notificationPreviewMarkdown = notificationPreviewMarkdown
    self.paneWorkingDirectories = paneWorkingDirectories
    self.unreadCount = unreadCount
    self.agentActivity = agentActivity
    self.hasTerminalBell = hasTerminalBell
    self.terminalProgress = terminalProgress
  }

  private func phaseLabel(_ phase: TerminalHostState.AgentActivityPhase) -> String {
    switch phase {
    case .running:
      return "Running"
    case .needsInput:
      return "Needs Input"
    case .idle:
      return "Idle"
    }
  }

  private static func uuid(_ id: String) -> UUID {
    guard let value = UUID(uuidString: id) else {
      fatalError("Invalid preview UUID: \(id)")
    }
    return value
  }
}

enum TerminalSidebarTabPreviewFixtures {
  static let items: [TerminalSidebarTabPreviewItem] = [
    TerminalSidebarTabPreviewItem(
      section: .shellTitles,
      scenario: "Prompt title from fish, one pane",
      title: "\(cwd()) - fish",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A01",
      paneWorkingDirectories: cwdList(cwd())
    ),
    TerminalSidebarTabPreviewItem(
      section: .shellTitles,
      scenario: "Selected manual title for focused work",
      title: "Sidebar polish",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A02",
      isSelected: true,
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac", "supaterm", "Features", "Terminal", "Views", "Sidebar")
      )
    ),
    TerminalSidebarTabPreviewItem(
      section: .splitPanes,
      scenario: "Three panes with distinct working trees",
      title: "Socket routing",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A03",
      paneWorkingDirectories: cwdList(
        cwd(),
        cwd("apps", "mac", "supaterm"),
        cwd("apps", "mac", "supatermTests")
      )
    ),
    TerminalSidebarTabPreviewItem(
      section: .splitPanes,
      scenario: "Four panes with duplicate roots collapsed",
      title: "mac-check",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A04",
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac"),
        cwd("apps", "mac", "supatermTests")
      )
    ),
    TerminalSidebarTabPreviewItem(
      section: .codingAgents,
      scenario: "Running agent inside a split coding tab",
      title: "Socket cleanup",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A05",
      notificationPreviewMarkdown: "Applying patch to socket notification routing while watching stale pane sockets",
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac"),
        cwd("docs")
      ),
      agentActivity: .claude(.running)
    ),
    TerminalSidebarTabPreviewItem(
      section: .codingAgents,
      scenario: "Agent is waiting for input",
      title: "Release note pass",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A06",
      notificationPreviewMarkdown: "Need approval before publishing the release notes",
      paneWorkingDirectories: cwdList(
        cwd("apps", "supaterm.com"),
        cwd("docs")
      ),
      agentActivity: .codex(.needsInput)
    ),
    TerminalSidebarTabPreviewItem(
      section: .codingAgents,
      scenario: "Agent finished and the leading indicator is hidden",
      title: "Docs audit",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A07",
      notificationPreviewMarkdown: "Review complete: no further changes needed",
      paneWorkingDirectories: cwdList(cwd("docs")),
      agentActivity: TerminalHostState.AgentActivity(kind: .pi, phase: .idle)
    ),
    TerminalSidebarTabPreviewItem(
      section: .terminalProgress,
      scenario: "Shell command is reporting OSC 9;4 progress",
      title: "Archive export",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A10",
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac"),
        cwd("docs")
      ),
      terminalProgress: TerminalSidebarTerminalProgress(fraction: 0.68, tone: .active)
    ),
    TerminalSidebarTabPreviewItem(
      section: .attention,
      scenario: "Raw terminal bell",
      title: "Background job done",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A11",
      paneWorkingDirectories: cwdList(cwd("apps", "mac")),
      hasTerminalBell: true
    ),
    TerminalSidebarTabPreviewItem(
      section: .attention,
      scenario: "Single unread pane",
      title: "Deploy smoke test",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A08",
      notificationPreviewMarkdown: [
        "Local preview server is ready with a deliberately long line",
        "that truncates at the end",
      ].joined(separator: " "),
      paneWorkingDirectories: cwdList(
        cwd("apps", "supaterm.com"),
        cwd("docs")
      ),
      unreadCount: 1
    ),
    TerminalSidebarTabPreviewItem(
      section: .attention,
      scenario: "Unread count overrides agent attention",
      title: "Build failures",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A09",
      notificationPreviewMarkdown: "2 failures in TerminalSidebarChromeViewTests",
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac"),
        cwd("apps", "mac", "supatermTests")
      ),
      unreadCount: 12,
      agentActivity: .claude(.needsInput)
    ),
  ]

  private static func cwd(_ components: String...) -> String {
    let root = "~/code/github.com/supabitapp/supaterm"
    guard !components.isEmpty else { return root }
    return ([root] + components).joined(separator: "/")
  }

  private static func cwdList(_ values: String...) -> [String] {
    values
  }
}

struct TerminalSidebarTabGroupPreviewModel {
  let title: String
  let tone: TerminalTone
  let items: [TerminalSidebarTabPreviewItem]
}

enum TerminalSidebarGroupedTabPreviewFixtures {
  static let leadingItems: [TerminalSidebarTabPreviewItem] = [
    item(
      title: "Socket routing",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B01",
      paneWorkingDirectories: [
        cwd("apps", "mac", "supaterm"),
        cwd("docs"),
      ]
    ),
    item(
      title: "Ghostty vendor bump",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B02",
      paneWorkingDirectories: [
        cwd("apps", "mac")
      ],
      unreadCount: 2
    ),
  ]

  static let group = TerminalSidebarTabGroupPreviewModel(
    title: "Launch Prep",
    tone: .amber,
    items: [
      item(
        title: "supaterm.com polish",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B03",
        isSelected: true,
        paneWorkingDirectories: [
          cwd("apps", "supaterm.com")
        ]
      ),
      item(
        title: "Release notes",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B04",
        paneWorkingDirectories: [
          cwd("docs")
        ]
      ),
      item(
        title: "Smoke test",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B05",
        paneWorkingDirectories: [
          cwd("apps", "mac"),
          cwd("apps", "supaterm.com"),
        ],
        agentActivity: .claude(.needsInput)
      ),
    ]
  )

  private static func item(
    title: String,
    id: String,
    isSelected: Bool = false,
    paneWorkingDirectories: [String] = [],
    unreadCount: Int = 0,
    agentActivity: TerminalHostState.AgentActivity? = nil
  ) -> TerminalSidebarTabPreviewItem {
    TerminalSidebarTabPreviewItem(
      section: .attention,
      scenario: "",
      title: title,
      id: id,
      isSelected: isSelected,
      paneWorkingDirectories: paneWorkingDirectories,
      unreadCount: unreadCount,
      agentActivity: agentActivity
    )
  }

  private static func cwd(_ components: String...) -> String {
    let root = "~/code/github.com/supabitapp/supaterm"
    guard !components.isEmpty else { return root }
    return ([root] + components).joined(separator: "/")
  }
}
