import Foundation
import SupatermTerminalFeature
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SwiftUI

private struct TerminalSidebarTabPreviewRow: View {
  let item: TerminalSidebarTabPreviewItem
  let palette: TerminalPalette

  var body: some View {
    TerminalSidebarTabSummaryView(
      tab: item.tab,
      palette: palette,
      isSelected: item.isSelected,
      notificationPreviewMarkdown: item.notificationPreviewMarkdown,
      paneWorkingDirectories: item.paneWorkingDirectories,
      unreadCount: item.unreadCount,
      badgeActivities: item.agentActivity.map { [$0] } ?? [],
      badgeActivity: item.agentActivity,
      badgeActivityIsFocused: false,
      hasTerminalBell: item.hasTerminalBell,
      terminalProgress: item.terminalProgress,
      showsAgentMarks: true,
      showsAgentSpinner: true,
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
    TerminalPalette(colorScheme: colorScheme)
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
    TerminalPalette(colorScheme: colorScheme)
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
