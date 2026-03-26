import Foundation
import SwiftUI

private enum TerminalSidebarTabPreviewSection: String, CaseIterable, Identifiable {
  case shellTitles = "Shell Titles"
  case splitPanes = "Split Panes"
  case codingAgents = "Coding Agent States"
  case attention = "Attention States"

  var id: String {
    rawValue
  }
}

private struct TerminalSidebarTabPreviewItem: Identifiable {
  let section: TerminalSidebarTabPreviewSection
  let scenario: String
  let tab: TerminalTabItem
  let isSelected: Bool
  let hasFocusedNotificationAttention: Bool
  let latestNotificationText: String?
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let claudeActivity: TerminalHostState.ClaudeActivity?

  var id: String {
    "\(section.rawValue)-\(scenario)"
  }
}

private enum TerminalSidebarTabPreviewFixtures {
  static let items: [TerminalSidebarTabPreviewItem] = [
    .init(
      section: .shellTitles,
      scenario: "Prompt title from fish, one pane",
      tab: tab(
        "\(cwd()) - fish",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A01"
      ),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: nil,
      paneWorkingDirectories: cwdList(cwd()),
      unreadCount: 0,
      claudeActivity: nil
    ),
    .init(
      section: .shellTitles,
      scenario: "Selected manual title for focused work",
      tab: tab(
        "Sidebar polish",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A02",
        icon: "pencil.and.scribble"
      ),
      isSelected: true,
      hasFocusedNotificationAttention: false,
      latestNotificationText: nil,
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac", "supaterm", "Features", "Terminal", "Views", "Sidebar")
      ),
      unreadCount: 0,
      claudeActivity: nil
    ),
    .init(
      section: .splitPanes,
      scenario: "Three panes with distinct working trees",
      tab: tab(
        "Socket routing",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A03",
        icon: "square.split.2x2"
      ),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: nil,
      paneWorkingDirectories: cwdList(
        cwd(),
        cwd("apps", "mac", "supaterm"),
        cwd("apps", "mac", "supatermTests")
      ),
      unreadCount: 0,
      claudeActivity: nil
    ),
    .init(
      section: .splitPanes,
      scenario: "Four panes with duplicate roots collapsed",
      tab: tab(
        "mac-check",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A04",
        icon: "hammer"
      ),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: nil,
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac"),
        cwd("apps", "mac", "supatermTests")
      ),
      unreadCount: 0,
      claudeActivity: nil
    ),
    .init(
      section: .codingAgents,
      scenario: "Running agent inside a split coding tab",
      tab: tab(
        "Socket cleanup",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A05"
      ),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: "Applying patch to socket notification routing",
      paneWorkingDirectories: cwdList(
        cwd("apps", "mac"),
        cwd("docs")
      ),
      unreadCount: 0,
      claudeActivity: .running
    ),
    .init(
      section: .codingAgents,
      scenario: "Agent is waiting for input",
      tab: tab(
        "Release note pass",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A06",
        icon: "doc.text"
      ),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: "Need input on wording before publish",
      paneWorkingDirectories: cwdList(
        cwd("apps", "supaterm.com"),
        cwd("docs")
      ),
      unreadCount: 0,
      claudeActivity: .needsInput
    ),
    .init(
      section: .codingAgents,
      scenario: "Agent finished and the leading indicator is hidden",
      tab: tab(
        "Docs audit",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A07",
        icon: "doc.text.magnifyingglass"
      ),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: "Review complete: no further changes needed",
      paneWorkingDirectories: cwdList(cwd("docs")),
      unreadCount: 0,
      claudeActivity: .idle
    ),
    .init(
      section: .attention,
      scenario: "Focused notification without unread count",
      tab: tab(
        "Deploy smoke test",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A08",
        icon: "shippingbox"
      ),
      isSelected: false,
      hasFocusedNotificationAttention: true,
      latestNotificationText: "Local preview server is ready",
      paneWorkingDirectories: cwdList(
        cwd("apps", "supaterm.com"),
        cwd("docs")
      ),
      unreadCount: 0,
      claudeActivity: nil
    ),
    .init(
      section: .attention,
      scenario: "Unread count overrides agent attention",
      tab: tab(
        "Build failures",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A09",
        icon: "hammer"
      ),
      isSelected: false,
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

  private static func tab(
    _ title: String,
    id: String,
    icon: String? = nil
  ) -> TerminalTabItem {
    TerminalTabItem(
      id: .init(rawValue: uuid(id)),
      title: title,
      icon: icon
    )
  }

  private static func uuid(_ id: String) -> UUID {
    guard let value = UUID(uuidString: id) else {
      fatalError("Invalid preview UUID: \(id)")
    }
    return value
  }

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
      notificationColor: palette.attention,
      hasFocusedNotificationAttention: item.hasFocusedNotificationAttention,
      latestNotificationText: item.latestNotificationText,
      paneWorkingDirectories: item.paneWorkingDirectories,
      unreadCount: item.unreadCount,
      claudeActivity: item.claudeActivity
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
