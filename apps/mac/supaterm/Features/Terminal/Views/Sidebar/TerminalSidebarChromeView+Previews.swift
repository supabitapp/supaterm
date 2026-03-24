import Foundation
import SwiftUI

private struct TerminalSidebarTabPreviewItem: Identifiable {
  let title: String
  let tab: TerminalTabItem
  let isSelected: Bool
  let hasFocusedNotificationAttention: Bool
  let latestNotificationText: String?
  let unreadCount: Int
  let claudeActivity: TerminalHostState.ClaudeActivity?

  var id: String {
    title
  }
}

private enum TerminalSidebarTabPreviewFixtures {
  static let items: [TerminalSidebarTabPreviewItem] = [
    .init(
      title: "Repo Root Cwd",
      tab: tab(cwd(), id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A01"),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: nil,
      unreadCount: 0,
      claudeActivity: nil
    ),
    .init(
      title: "Selected Deep Cwd",
      tab: tab(
        cwd("apps", "mac", "supaterm", "Features", "Terminal", "Views", "Sidebar"),
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A02"
      ),
      isSelected: true,
      hasFocusedNotificationAttention: false,
      latestNotificationText: nil,
      unreadCount: 0,
      claudeActivity: nil
    ),
    .init(
      title: "Focused Notification",
      tab: tab(
        cwd("apps", "supaterm.com"),
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A03"
      ),
      isSelected: false,
      hasFocusedNotificationAttention: true,
      latestNotificationText: "Preview build finished in 18.4s",
      unreadCount: 0,
      claudeActivity: nil
    ),
    .init(
      title: "Unread Notification",
      tab: tab(cwd("apps", "mac"), id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A04"),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: "make mac-test failed: 1 failure in TerminalWindowFeatureTests",
      unreadCount: 3,
      claudeActivity: nil
    ),
    .init(
      title: "Unread Count Double Digits",
      tab: tab("/var/log", id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A05"),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: "12 new lines matched 'ERROR' in app.log",
      unreadCount: 12,
      claudeActivity: nil
    ),
    .init(
      title: "Notification Text",
      tab: tab(
        cwd("docs"),
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A06"
      ),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: "Socket server restarted on ~/.local/state/supaterm.sock",
      unreadCount: 0,
      claudeActivity: nil
    ),
    .init(
      title: "Claude Running",
      tab: tab(cwd(), id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A07"),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: "Applying patch to TerminalSidebarChromeView+Previews.swift",
      unreadCount: 0,
      claudeActivity: .running
    ),
    .init(
      title: "Claude Needs Input",
      tab: tab(cwd("apps", "mac"), id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A08"),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: "Need approval to run xcodebuild test for supaterm.xcworkspace",
      unreadCount: 0,
      claudeActivity: .needsInput
    ),
    .init(
      title: "Claude Idle",
      tab: tab(
        cwd("apps", "supaterm.com"),
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A09"
      ),
      isSelected: false,
      hasFocusedNotificationAttention: false,
      latestNotificationText: "Review complete: no further changes needed",
      unreadCount: 0,
      claudeActivity: .idle
    ),
    .init(
      title: "Unread Overrides Claude",
      tab: tab(cwd(), id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A0A"),
      isSelected: false,
      hasFocusedNotificationAttention: true,
      latestNotificationText: "Review ready: 3 findings in TerminalSidebarChromeView.swift",
      unreadCount: 4,
      claudeActivity: .needsInput
    ),
  ]

  private static func tab(_ title: String, id: String) -> TerminalTabItem {
    TerminalTabItem(
      id: .init(rawValue: uuid(id)),
      title: title,
      icon: nil
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
      VStack(alignment: .leading, spacing: 12) {
        ForEach(TerminalSidebarTabPreviewFixtures.items) { item in
          VStack(alignment: .leading, spacing: 6) {
            Text(item.title)
              .font(.system(size: 11, weight: .semibold))
              .foregroundStyle(palette.secondaryText)

            TerminalSidebarTabPreviewRow(
              item: item,
              palette: palette
            )
          }
        }
      }
      .padding(8)
      .padding(.top, 6)
      .padding(.bottom, 8)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(width: 320, height: 980)
    .background(palette.windowBackgroundTint)
    .background(palette.detailBackground)
    .preferredColorScheme(colorScheme)
  }
}

#Preview("Sidebar Row States - Light") {
  TerminalSidebarTabPreviewGallery(colorScheme: .light)
}

#Preview("Sidebar Row States - Dark") {
  TerminalSidebarTabPreviewGallery(colorScheme: .dark)
}
