import Foundation
import SupatermCLIShared
import SwiftUI

private enum TerminalSidebarTabPreviewSection: String, CaseIterable, Identifiable {
  case shellTitles = "Shell Titles"
  case splitPanes = "Split Panes"
  case codingAgents = "Coding Agent States"
  case terminalProgress = "Terminal Progress"
  case attention = "Attention States"

  var id: String {
    rawValue
  }
}

private struct TerminalSidebarTabPreviewItem: Identifiable {
  private let previewID: String
  private let tabID: TerminalTabID

  let section: TerminalSidebarTabPreviewSection
  let scenario: String
  let title: String
  let icon: String?
  let isSelected: Bool
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let agentActivity: TerminalHostState.AgentActivity?
  let terminalProgress: TerminalSidebarTerminalProgress?

  var id: String {
    previewID
  }

  var tab: TerminalTabItem {
    TerminalTabItem(
      id: tabID,
      title: title,
      icon: icon,
      isDirty: section == .terminalProgress
    )
  }

  var metadataLine: String? {
    let values = [
      stateLabel,
      isSelected ? "Selected" : nil,
      paneCountLabel,
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
      terminalProgress: terminalProgress
    )
  }

  init(
    section: TerminalSidebarTabPreviewSection,
    scenario: String,
    title: String,
    id: String,
    icon: String? = nil,
    isSelected: Bool = false,
    paneWorkingDirectories: [String] = [],
    unreadCount: Int = 0,
    agentActivity: TerminalHostState.AgentActivity? = nil,
    terminalProgress: TerminalSidebarTerminalProgress? = nil
  ) {
    previewID = id
    tabID = .init(rawValue: Self.uuid(id))
    self.section = section
    self.scenario = scenario
    self.title = title
    self.icon = icon
    self.isSelected = isSelected
    self.paneWorkingDirectories = paneWorkingDirectories
    self.unreadCount = unreadCount
    self.agentActivity = agentActivity
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

private enum TerminalSidebarTabPreviewFixtures {
  static let items: [TerminalSidebarTabPreviewItem] = [
    .init(
      section: .shellTitles,
      scenario: "Prompt title from fish, one pane",
      title: "\(cwd()) - fish",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A01",
      paneWorkingDirectories: cwdList(cwd())
    ),
    .init(
      section: .shellTitles,
      scenario: "Selected manual title for focused work",
      title: "Sidebar polish",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A02",
      icon: "pencil.and.scribble",
      isSelected: true,
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac", "supaterm", "Features", "Terminal", "Views", "Sidebar")
      )
    ),
    .init(
      section: .splitPanes,
      scenario: "Three panes with distinct working trees",
      title: "Socket routing",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A03",
      icon: "square.split.2x2",
      paneWorkingDirectories: cwdList(
        cwd(),
        cwd("apps", "mac", "supaterm"),
        cwd("apps", "mac", "supatermTests")
      )
    ),
    .init(
      section: .splitPanes,
      scenario: "Four panes with duplicate roots collapsed",
      title: "mac-check",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A04",
      icon: "hammer",
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac"),
        cwd("apps", "mac", "supatermTests")
      )
    ),
    .init(
      section: .codingAgents,
      scenario: "Running agent inside a split coding tab",
      title: "Socket cleanup",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A05",
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac"),
        cwd("docs")
      ),
      agentActivity: .claude(.running)
    ),
    .init(
      section: .codingAgents,
      scenario: "Agent is waiting for input",
      title: "Release note pass",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A06",
      icon: "doc.text",
      paneWorkingDirectories: cwdList(
        cwd("apps", "supaterm.com"),
        cwd("docs")
      ),
      agentActivity: .codex(.needsInput)
    ),
    .init(
      section: .codingAgents,
      scenario: "Agent finished and the leading indicator is hidden",
      title: "Docs audit",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A07",
      icon: "doc.text.magnifyingglass",
      paneWorkingDirectories: cwdList(cwd("docs")),
      agentActivity: .init(kind: .pi, phase: .idle)
    ),
    .init(
      section: .terminalProgress,
      scenario: "Shell command is reporting OSC 9;4 progress",
      title: "Archive export",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A10",
      icon: "shippingbox",
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac"),
        cwd("docs")
      ),
      terminalProgress: .init(fraction: 0.68, tone: .active)
    ),
    .init(
      section: .attention,
      scenario: "Single unread pane",
      title: "Deploy smoke test",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A08",
      icon: "shippingbox",
      paneWorkingDirectories: cwdList(
        cwd("apps", "supaterm.com"),
        cwd("docs")
      ),
      unreadCount: 1
    ),
    .init(
      section: .attention,
      scenario: "Unread count overrides agent attention",
      title: "Build failures",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A09",
      icon: "hammer",
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

private struct TerminalSidebarTabPreviewRow: View {
  let item: TerminalSidebarTabPreviewItem
  let palette: TerminalPalette

  var body: some View {
    TerminalSidebarTabSummaryView(
      tab: item.tab,
      palette: palette,
      isSelected: item.isSelected,
      paneWorkingDirectories: item.paneWorkingDirectories,
      unreadCount: item.unreadCount,
      badgeActivity: item.agentActivity,
      terminalProgress: item.terminalProgress,
      showsAgentMarks: true,
      shortcutHint: nil,
      showsShortcutHint: false,
      isRowHovering: false
    )
    .lineLimit(10)
    .padding(.horizontal, TerminalSidebarLayout.tabRowHorizontalPadding)
    .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
    .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(backgroundColor)
    .clipShape(
      RoundedRectangle(cornerRadius: TerminalSidebarLayout.tabRowCornerRadius, style: .continuous)
    )
    .shadow(color: item.isSelected ? palette.shadow : .clear, radius: item.isSelected ? 2 : 0, y: 1.5)
  }

  private var backgroundColor: Color {
    item.isSelected ? palette.selectedFill : .clear
  }
}

private struct TerminalSidebarTabPreviewGallery: View {
  let colorScheme: ColorScheme

  private var palette: TerminalPalette {
    .init(colorScheme: colorScheme)
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        ForEach(TerminalSidebarTabPreviewSection.allCases) { section in
          VStack(alignment: .leading, spacing: 10) {
            Text(section.rawValue)
              .font(.system(size: 11, weight: .semibold))
              .foregroundStyle(palette.secondaryText)

            ForEach(items(in: section)) { item in
              VStack(alignment: .leading, spacing: 6) {
                Text(item.scenario)
                  .font(.system(size: 11, weight: .medium))
                  .foregroundStyle(palette.secondaryText)

                if let metadataLine = item.metadataLine {
                  Text(metadataLine)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(palette.secondaryText.opacity(0.82))
                }

                TerminalSidebarTabPreviewRow(
                  item: item,
                  palette: palette
                )
              }
            }
          }
        }
      }
      .padding(8)
      .padding(.top, 6)
      .padding(.bottom, 8)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(width: 320, height: 1100)
    .background(palette.windowBackgroundTint)
    .background(palette.detailBackground)
  }

  private func items(
    in section: TerminalSidebarTabPreviewSection
  ) -> [TerminalSidebarTabPreviewItem] {
    TerminalSidebarTabPreviewFixtures.items.filter { $0.section == section }
  }
}

private struct TerminalSidebarTabPreviewColumn: View {
  let title: String
  let colorScheme: ColorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.secondary)

      TerminalSidebarTabPreviewGallery(colorScheme: colorScheme)
        .environment(\.colorScheme, colorScheme)
    }
    .frame(width: 320, alignment: .leading)
  }
}

private struct TerminalSidebarTabPreviewComparison: View {
  var body: some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: 16) {
        TerminalSidebarTabPreviewColumn(
          title: "Light",
          colorScheme: .light
        )

        TerminalSidebarTabPreviewColumn(
          title: "Dark",
          colorScheme: .dark
        )
      }
      .padding(16)
    }
    .frame(width: 704, height: 1160)
  }
}

private struct TerminalSidebarTabGroupPreviewModel {
  let title: String
  let tone: TerminalTone
  let items: [TerminalSidebarTabPreviewItem]
}

private enum TerminalSidebarGroupedTabPreviewFixtures {
  static let leadingItems: [TerminalSidebarTabPreviewItem] = [
    item(
      title: "Socket routing",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B01",
      icon: "square.split.2x2",
      paneWorkingDirectories: [
        cwd("apps", "mac", "supaterm"),
        cwd("docs"),
      ]
    ),
    item(
      title: "Ghostty vendor bump",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B02",
      icon: "shippingbox",
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
        icon: "sparkles",
        isSelected: true,
        paneWorkingDirectories: [
          cwd("apps", "supaterm.com")
        ]
      ),
      item(
        title: "Release notes",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B04",
        icon: "doc.text",
        paneWorkingDirectories: [
          cwd("docs")
        ]
      ),
      item(
        title: "Smoke test",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B05",
        icon: "checkmark.seal",
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
    icon: String? = nil,
    isSelected: Bool = false,
    paneWorkingDirectories: [String] = [],
    unreadCount: Int = 0,
    agentActivity: TerminalHostState.AgentActivity? = nil
  ) -> TerminalSidebarTabPreviewItem {
    .init(
      section: .attention,
      scenario: "",
      title: title,
      id: id,
      icon: icon,
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

private struct TerminalSidebarGroupedTabPreview: View {
  let group: TerminalSidebarTabGroupPreviewModel
  let palette: TerminalPalette

  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      header

      VStack(spacing: TerminalSidebarLayout.tabRowSpacing) {
        ForEach(group.items) { item in
          TerminalSidebarTabPreviewRow(
            item: item,
            palette: palette
          )
        }
      }
      .padding(6)
      .background(innerFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    .padding(6)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background {
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .fill(palette.clearFill)
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .fill(accent.opacity(groupFillOpacity))
    }
    .overlay {
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(accent.opacity(groupStrokeOpacity), lineWidth: 1)
    }
  }

  private var header: some View {
    HStack(spacing: 8) {
      Image(systemName: "chevron.down")
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(palette.secondaryText)
        .frame(width: 12)
        .accessibilityHidden(true)

      Text(group.title)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(palette.primaryText)
        .lineLimit(1)

      Spacer(minLength: 0)
    }
    .padding(.horizontal, 4)
    .padding(.top, 2)
  }

  private var accent: Color {
    palette.fill(for: group.tone)
  }

  private var innerFill: Color {
    colorScheme == .dark
      ? palette.clearFill.opacity(0.92)
      : palette.clearFill.opacity(0.72)
  }

  private var groupFillOpacity: Double {
    hasSelectedItem
      ? (colorScheme == .dark ? 0.16 : 0.12)
      : (colorScheme == .dark ? 0.1 : 0.07)
  }

  private var groupStrokeOpacity: Double {
    hasSelectedItem
      ? (colorScheme == .dark ? 0.34 : 0.22)
      : (colorScheme == .dark ? 0.24 : 0.16)
  }

  private var hasSelectedItem: Bool {
    group.items.contains(where: \.isSelected)
  }
}

private struct TerminalSidebarPreviewWindowHeader: View {
  var body: some View {
    HStack(spacing: 0) {
      HStack(spacing: 8) {
        Circle()
          .fill(Color(red: 1, green: 0.37, blue: 0.32))
          .frame(width: 12, height: 12)

        Circle()
          .fill(Color(red: 1, green: 0.74, blue: 0.18))
          .frame(width: 12, height: 12)

        Circle()
          .fill(Color(red: 0.16, green: 0.8, blue: 0.25))
          .frame(width: 12, height: 12)
      }

      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, minHeight: 24, maxHeight: 24, alignment: .topLeading)
  }
}

private struct TerminalSidebarGroupedTabNewRowPreview: View {
  let palette: TerminalPalette

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "plus")
        .font(.system(size: 12, weight: .semibold))
        .frame(width: 18, height: 18)
        .foregroundStyle(palette.secondaryText)
        .accessibilityHidden(true)

      Text("New Tab")
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(palette.primaryText)

      Spacer(minLength: 0)
    }
    .padding(.horizontal, 10)
    .frame(height: 36)
  }
}

private struct TerminalSidebarGroupedTabPreviewGallery: View {
  let colorScheme: ColorScheme

  private var palette: TerminalPalette {
    .init(colorScheme: colorScheme)
  }

  var body: some View {
    VStack(spacing: 0) {
      TerminalSidebarPreviewWindowHeader()
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 10)

      ScrollView {
        VStack(alignment: .leading, spacing: 8) {
          ForEach(TerminalSidebarGroupedTabPreviewFixtures.leadingItems) { item in
            TerminalSidebarTabPreviewRow(
              item: item,
              palette: palette
            )
          }

          TerminalSidebarGroupedTabPreview(
            group: TerminalSidebarGroupedTabPreviewFixtures.group,
            palette: palette
          )

          TerminalSidebarGroupedTabNewRowPreview(palette: palette)
        }
        .padding(8)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .frame(width: 320, height: 420)
    .background(palette.windowBackgroundTint)
    .background(palette.detailBackground)
  }
}

private struct TerminalSidebarGroupedTabPreviewColumn: View {
  let title: String
  let colorScheme: ColorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(.secondary)

      TerminalSidebarGroupedTabPreviewGallery(colorScheme: colorScheme)
        .environment(\.colorScheme, colorScheme)
    }
    .frame(width: 320, alignment: .leading)
  }
}

private struct TerminalSidebarGroupPreviewComparison: View {
  var body: some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: 16) {
        TerminalSidebarGroupedTabPreviewColumn(
          title: "Light",
          colorScheme: .light
        )

        TerminalSidebarGroupedTabPreviewColumn(
          title: "Dark",
          colorScheme: .dark
        )
      }
      .padding(16)
    }
    .frame(width: 704, height: 460)
  }
}

private struct TerminalSidebarPreviewShowcase: View {
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        VStack(alignment: .leading, spacing: 10) {
          Text("Row States")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.secondary)

          TerminalSidebarTabPreviewComparison()
        }

        VStack(alignment: .leading, spacing: 10) {
          Text("Grouped Tabs")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.secondary)

          TerminalSidebarGroupPreviewComparison()
        }
      }
      .padding(16)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(width: 736, height: 1680)
  }
}

#Preview("Sidebar") {
  TerminalSidebarPreviewShowcase()
}
