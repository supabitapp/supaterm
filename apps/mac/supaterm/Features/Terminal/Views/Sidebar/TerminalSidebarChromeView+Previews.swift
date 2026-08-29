import Foundation
import SupaTheme
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
  let isSelected: Bool
  let isTitleLocked: Bool
  let paneTitles: [String]
  let paneAgentStatuses: [TerminalHostState.TabAgentStatus?]
  let paneHasAttention: [Bool]
  let terminalProgress: TerminalSidebarTerminalProgress?

  var id: String {
    previewID
  }

  var tab: TerminalTabItem {
    TerminalTabItem(
      id: tabID,
      title: title,
      isDirty: section == .terminalProgress,
      isTitleLocked: isTitleLocked
    )
  }

  var panes: [TerminalHostState.TabPanePresentation] {
    paneTitles.enumerated().map { index, title in
      TerminalHostState.TabPanePresentation(
        id: Self.paneID(index),
        title: title,
        agentStatus: paneAgentStatuses.indices.contains(index) ? paneAgentStatuses[index] : nil,
        hasAttention: paneHasAttention.indices.contains(index) && paneHasAttention[index]
      )
    }
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
    if let status = paneAgentStatuses.compactMap({ $0 }).first {
      return "Agent \(statusLabel(status))"
    }
    if paneHasAttention.contains(true) { return "Attention" }
    if terminalProgress != nil { return "Terminal Progress" }
    return nil
  }

  private var paneCountLabel: String? {
    guard !paneTitles.isEmpty else { return nil }
    let count = paneTitles.count
    return "\(count) pane\(count == 1 ? "" : "s")"
  }

  init(
    section: TerminalSidebarTabPreviewSection,
    scenario: String,
    title: String,
    id: String,
    isSelected: Bool = false,
    isTitleLocked: Bool = false,
    paneTitles: [String] = [],
    paneAgentStatuses: [TerminalHostState.TabAgentStatus?] = [],
    paneHasAttention: [Bool] = [],
    terminalProgress: TerminalSidebarTerminalProgress? = nil
  ) {
    previewID = id
    tabID = TerminalTabID(rawValue: Self.uuid(id))
    self.section = section
    self.scenario = scenario
    self.title = title
    self.isSelected = isSelected
    self.isTitleLocked = isTitleLocked
    self.paneTitles = paneTitles
    self.paneAgentStatuses = paneAgentStatuses
    self.paneHasAttention = paneHasAttention
    self.terminalProgress = terminalProgress
  }

  private func statusLabel(_ status: TerminalHostState.TabAgentStatus) -> String {
    switch status {
    case .needsInput:
      return "Needs Input"
    case .done:
      return "Done"
    case .working:
      return "Working"
    }
  }

  private static func uuid(_ id: String) -> UUID {
    guard let value = UUID(uuidString: id) else {
      fatalError("Invalid preview UUID: \(id)")
    }
    return value
  }

  private static func paneID(_ index: Int) -> UUID {
    UUID(uuidString: String(format: "00000000-0000-0000-0000-%012X", index + 1))!
  }
}

private enum TerminalSidebarTabPreviewFixtures {
  static let items: [TerminalSidebarTabPreviewItem] = [
    TerminalSidebarTabPreviewItem(
      section: .shellTitles,
      scenario: "Prompt title from fish, one pane",
      title: "fish",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A01",
      paneTitles: ["fish"]
    ),
    TerminalSidebarTabPreviewItem(
      section: .shellTitles,
      scenario: "Selected manual title for focused work",
      title: "Sidebar polish",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A02",
      isSelected: true,
      isTitleLocked: true,
      paneTitles: ["codex"]
    ),
    TerminalSidebarTabPreviewItem(
      section: .splitPanes,
      scenario: "Three panes in split order",
      title: "Socket routing",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A03",
      paneTitles: ["codex", "swift test", "git status"]
    ),
    TerminalSidebarTabPreviewItem(
      section: .splitPanes,
      scenario: "Four panes with repeated terminal titles",
      title: "mac-check",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A04",
      paneTitles: ["codex", "codex", "swift test", "swift test"]
    ),
    TerminalSidebarTabPreviewItem(
      section: .codingAgents,
      scenario: "Six mixed agent panes",
      title: "Socket cleanup",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A05",
      paneTitles: ["Codex 1", "Codex 2", "Codex 3", "Review 1", "Review 2", "Review 3"],
      paneAgentStatuses: [.working, .done, .needsInput, .working, .done, .needsInput]
    ),
    TerminalSidebarTabPreviewItem(
      section: .codingAgents,
      scenario: "Agent is waiting for input",
      title: "Release note pass",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A06",
      paneTitles: ["Review agent", "release notes"],
      paneAgentStatuses: [.needsInput, nil]
    ),
    TerminalSidebarTabPreviewItem(
      section: .codingAgents,
      scenario: "Agent finished in a background tab",
      title: "Docs audit",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A07",
      paneTitles: ["Codex"],
      paneAgentStatuses: [.done]
    ),
    TerminalSidebarTabPreviewItem(
      section: .terminalProgress,
      scenario: "Shell command is reporting OSC 9;4 progress",
      title: "Archive export",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A10",
      paneTitles: ["tar -czf release.tar.gz", "fish"],
      terminalProgress: TerminalSidebarTerminalProgress(fraction: 0.68, tone: .active)
    ),
    TerminalSidebarTabPreviewItem(
      section: .attention,
      scenario: "Raw terminal bell",
      title: "Background job done",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A11",
      paneTitles: ["make mac-check"],
      paneHasAttention: [true]
    ),
    TerminalSidebarTabPreviewItem(
      section: .attention,
      scenario: "Single unread pane",
      title: "Deploy smoke test",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A08",
      paneTitles: ["wrangler deploy", "curl smoke test"],
      paneHasAttention: [false, true]
    ),
    TerminalSidebarTabPreviewItem(
      section: .attention,
      scenario: "Agent state hides same-pane attention",
      title: "Build failures",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1A09",
      paneTitles: ["Codex", "swift test"],
      paneAgentStatuses: [.working, nil],
      paneHasAttention: [true, true],
    ),
  ]
}

private struct TerminalSidebarTabPreviewRow: View {
  let item: TerminalSidebarTabPreviewItem
  let palette: Palette

  var body: some View {
    TerminalSidebarTabSummaryView(
      tab: item.tab,
      palette: palette,
      isSelected: item.isSelected,
      isPinned: false,
      panes: item.panes,
      terminalProgress: item.terminalProgress,
      shortcutHint: nil,
      showsShortcutHint: false,
      isRowHovering: false
    )
    .lineLimit(10)
    .padding(.horizontal, TerminalSidebarLayout.rowHorizontalPadding)
    .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
    .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      rowAppearance.fill(
        selection: item.isSelected ? .primary : .none,
        isPressed: false,
        isHovering: false
      )
    )
    .modifier(
      SelectableRowChrome(
        selection: item.isSelected ? .primary : .none,
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        appearance: rowAppearance,
        showsSelectionEdge: true
      )
    )
  }

  private var rowAppearance: SelectableRowStyle.ResolvedAppearance {
    SelectableRowStyle.Appearance.sidebar.resolve(palette: palette)
  }
}

private struct TerminalSidebarTabPreviewGallery: View {
  let colorScheme: ColorScheme

  private var palette: Palette {
    Palette(colorScheme: colorScheme)
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
  let tone: TerminalSidebarTabGroupPreviewTone
  let items: [TerminalSidebarTabPreviewItem]
}

private enum TerminalSidebarTabGroupPreviewTone {
  case warning
  case danger
  case success
  case accent
  case muted
  case merged
}

private enum TerminalSidebarGroupedTabPreviewFixtures {
  static let leadingItems: [TerminalSidebarTabPreviewItem] = [
    item(
      title: "Socket routing",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B01",
      paneTitles: ["codex", "swift test"]
    ),
    item(
      title: "Ghostty vendor bump",
      id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B02",
      paneTitles: ["git submodule update"],
      paneHasAttention: [true]
    ),
  ]

  static let group = TerminalSidebarTabGroupPreviewModel(
    title: "Launch Prep",
    tone: .warning,
    items: [
      item(
        title: "supaterm.com polish",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B03",
        isSelected: true,
        paneTitles: ["pnpm dev"]
      ),
      item(
        title: "Release notes",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B04",
        paneTitles: ["codex"]
      ),
      item(
        title: "Smoke test",
        id: "A379CB4E-2B01-4A6F-9388-A06B4E9C1B05",
        paneTitles: ["Review agent", "make smoke-test"],
        paneAgentStatuses: [.needsInput, nil]
      ),
    ]
  )

  private static func item(
    title: String,
    id: String,
    isSelected: Bool = false,
    paneTitles: [String] = [],
    paneAgentStatuses: [TerminalHostState.TabAgentStatus?] = [],
    paneHasAttention: [Bool] = [],
  ) -> TerminalSidebarTabPreviewItem {
    TerminalSidebarTabPreviewItem(
      section: .attention,
      scenario: "",
      title: title,
      id: id,
      isSelected: isSelected,
      paneTitles: paneTitles,
      paneAgentStatuses: paneAgentStatuses,
      paneHasAttention: paneHasAttention,
    )
  }
}

private struct TerminalSidebarGroupedTabPreview: View {
  let group: TerminalSidebarTabGroupPreviewModel
  let palette: Palette

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
        .fill(palette.unselectedFill)
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
    switch group.tone {
    case .warning:
      palette.warning.opacity(0.85)
    case .danger:
      palette.danger.opacity(0.85)
    case .success:
      palette.success.opacity(0.85)
    case .accent:
      palette.accent.opacity(0.85)
    case .muted:
      palette.secondaryText.opacity(0.85)
    case .merged:
      palette.merged.opacity(0.85)
    }
  }

  private var innerFill: Color {
    palette.unselectedFill
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
  let palette: Palette

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

  private var palette: Palette {
    Palette(colorScheme: colorScheme)
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
