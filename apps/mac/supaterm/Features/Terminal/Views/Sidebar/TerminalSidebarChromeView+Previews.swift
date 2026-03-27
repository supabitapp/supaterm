import Foundation
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
  let hasFocusedNotificationAttention: Bool
  let latestNotificationText: String?
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let claudeActivity: TerminalHostState.ClaudeActivity?
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
      latestNotificationText == nil ? nil : "Message",
    ]
    .compactMap { $0 }

    guard !values.isEmpty else { return nil }
    return values.joined(separator: " • ")
  }

  private var stateLabel: String? {
    switch leadingIndicator {
    case .claudeActivity(.running):
      return "Running"
    case .claudeActivity(.needsInput):
      return "Needs Input"
    case .claudeActivity(.idle):
      return "Idle"
    case .terminalProgress:
      return "Terminal Progress"
    case .focusedNotification:
      return "Focused Alert"
    case .unreadCount(let count):
      return "Unread \(count)"
    case .tabSymbol:
      return nil
    }
  }

  private var paneCountLabel: String? {
    guard !paneWorkingDirectories.isEmpty else { return nil }
    let count = paneWorkingDirectories.count
    return "\(count) pane\(count == 1 ? "" : "s")"
  }

  private var leadingIndicator: TerminalSidebarTabSummaryView.LeadingIndicator {
    TerminalSidebarTabSummaryView.leadingIndicator(
      hasFocusedNotificationAttention: hasFocusedNotificationAttention,
      tab: tab,
      unreadCount: unreadCount,
      claudeActivity: claudeActivity,
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
    hasFocusedNotificationAttention: Bool = false,
    latestNotificationText: String? = nil,
    paneWorkingDirectories: [String] = [],
    unreadCount: Int = 0,
    claudeActivity: TerminalHostState.ClaudeActivity? = nil,
    terminalProgress: TerminalSidebarTerminalProgress? = nil
  ) {
    previewID = id
    tabID = .init(rawValue: Self.uuid(id))
    self.section = section
    self.scenario = scenario
    self.title = title
    self.icon = icon
    self.isSelected = isSelected
    self.hasFocusedNotificationAttention = hasFocusedNotificationAttention
    self.latestNotificationText = latestNotificationText
    self.paneWorkingDirectories = paneWorkingDirectories
    self.unreadCount = unreadCount
    self.claudeActivity = claudeActivity
    self.terminalProgress = terminalProgress
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
      latestNotificationText: "Applying patch to socket notification routing",
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac"),
        cwd("docs")
      ),
      claudeActivity: .running
    ),
    .init(
      section: .codingAgents,
      scenario: "Agent is waiting for input",
      title: "Release note pass",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A06",
      icon: "doc.text",
      latestNotificationText: "Need input on wording before publish",
      paneWorkingDirectories: cwdList(
        cwd("apps", "supaterm.com"),
        cwd("docs")
      ),
      claudeActivity: .needsInput
    ),
    .init(
      section: .codingAgents,
      scenario: "Agent finished and the leading indicator is hidden",
      title: "Docs audit",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A07",
      icon: "doc.text.magnifyingglass",
      latestNotificationText: "Review complete: no further changes needed",
      paneWorkingDirectories: cwdList(cwd("docs")),
      claudeActivity: .idle
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
      scenario: "Focused notification without unread count",
      title: "Deploy smoke test",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A08",
      icon: "shippingbox",
      hasFocusedNotificationAttention: true,
      latestNotificationText: "Local preview server is ready",
      paneWorkingDirectories: cwdList(
        cwd("apps", "supaterm.com"),
        cwd("docs")
      )
    ),
    .init(
      section: .attention,
      scenario: "Unread count overrides agent attention",
      title: "Build failures",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A09",
      icon: "hammer",
      hasFocusedNotificationAttention: true,
      latestNotificationText: "2 failures in TerminalSidebarChromeViewTests",
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac"),
        cwd("apps", "mac", "supatermTests")
      ),
      unreadCount: 12,
      claudeActivity: .needsInput
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
      displayTitle: item.title,
      palette: palette,
      isSelected: item.isSelected,
      notificationColor: palette.attention,
      hasFocusedNotificationAttention: item.hasFocusedNotificationAttention,
      latestNotificationText: item.latestNotificationText,
      paneWorkingDirectories: item.paneWorkingDirectories,
      unreadCount: item.unreadCount,
      claudeActivity: item.claudeActivity,
      terminalProgress: item.terminalProgress
    )
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

#Preview("Sidebar Row States") {
  TerminalSidebarTabPreviewComparison()
}
