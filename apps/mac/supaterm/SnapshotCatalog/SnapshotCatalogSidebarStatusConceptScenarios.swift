import SupaTheme
import SwiftUI

extension SnapshotCatalog {
  static let sidebarStatusConceptScenarios: [SnapshotScenario] = [
    scenario(
      "simple-marks",
      group: "Sidebar Status Concepts",
      title: "Simple marks and words",
      size: CGSize(width: 320, height: 208)
    ) { appearance in
      AnyView(
        SidebarStatusConceptFixture(
          appearance: appearance,
          markStyle: .simple,
          rows: SidebarStatusConceptRow.samples
        )
      )
    },
    scenario(
      "supaterm-symbols",
      group: "Sidebar Status Concepts",
      title: "Supaterm symbols and words",
      size: CGSize(width: 320, height: 208)
    ) { appearance in
      AnyView(
        SidebarStatusConceptFixture(
          appearance: appearance,
          markStyle: .symbols,
          rows: SidebarStatusConceptRow.samples
        )
      )
    },
    scenario(
      "selected",
      group: "Sidebar Status Concepts",
      title: "Selected live states",
      size: CGSize(width: 320, height: 112)
    ) { appearance in
      AnyView(
        SidebarStatusConceptFixture(
          appearance: appearance,
          markStyle: .symbols,
          rows: [
            SidebarStatusConceptRow(
              title: "Refine agent status row",
              path: "~/code/supaterm/apps/mac",
              state: .working,
              selection: .primary
            ),
            SidebarStatusConceptRow(
              title: "Ship release notes",
              path: "~/code/supaterm/apps/supaterm.com",
              state: .input,
              selection: .primary
            ),
          ]
        )
      )
    },
    scenario(
      "notification-preview",
      group: "Sidebar Status Concepts",
      title: "Done with notification preview",
      size: CGSize(width: 320, height: 104)
    ) { appearance in
      AnyView(
        SidebarStatusConceptFixture(
          appearance: appearance,
          markStyle: .symbols,
          rows: [
            SidebarStatusConceptRow(
              title: "Snapshot catalog",
              path: "~/code/supaterm/apps/mac",
              preview: "Finished the tab status concepts and snapshot baselines",
              state: .done
            )
          ]
        )
      )
    },
    scenario(
      "narrow",
      group: "Sidebar Status Concepts",
      title: "Narrow icon-only rows",
      size: CGSize(width: 220, height: 208)
    ) { appearance in
      AnyView(
        SidebarStatusConceptFixture(
          appearance: appearance,
          markStyle: .symbols,
          showsStatusText: false,
          rows: SidebarStatusConceptRow.samples
        )
      )
    },
  ]
}

private enum SidebarStatusConceptState: Hashable {
  case working
  case input
  case done
  case idle

  var label: String {
    switch self {
    case .working:
      "Working"
    case .input:
      "Input"
    case .done:
      "Done"
    case .idle:
      "2m"
    }
  }

  var accessibilityLabel: String {
    switch self {
    case .working:
      "Agent working"
    case .input:
      "Agent needs input"
    case .done:
      "Agent finished"
    case .idle:
      "Last active 2 minutes ago"
    }
  }

  func color(palette: Palette, isSelected: Bool) -> Color {
    switch self {
    case .working:
      palette.accent
    case .input:
      palette.warning
    case .done:
      palette.success
    case .idle:
      isSelected ? palette.selectedSecondaryText : palette.secondaryText
    }
  }
}

private enum SidebarStatusConceptMarkStyle {
  case simple
  case symbols
}

private struct SidebarStatusConceptRow: Identifiable {
  let title: String
  let path: String
  var preview: String?
  let state: SidebarStatusConceptState
  var selection: SelectableRowSelection = .none

  var id: SidebarStatusConceptState { state }

  static let samples = [
    SidebarStatusConceptRow(
      title: "Refine agent status row",
      path: "~/code/supaterm/apps/mac",
      state: .working
    ),
    SidebarStatusConceptRow(
      title: "Ship release notes",
      path: "~/code/supaterm/apps/supaterm.com",
      state: .input
    ),
    SidebarStatusConceptRow(
      title: "Fix snapshot catalog",
      path: "~/code/supaterm/apps/mac",
      state: .done
    ),
    SidebarStatusConceptRow(
      title: "Shell",
      path: "~/code/supaterm",
      state: .idle
    ),
  ]
}

private struct SidebarStatusConceptFixture: View {
  let appearance: SnapshotAppearance
  let markStyle: SidebarStatusConceptMarkStyle
  var showsStatusText = true
  let rows: [SidebarStatusConceptRow]

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    VStack(spacing: 2) {
      ForEach(rows) { row in
        SidebarStatusConceptRowView(
          row: row,
          markStyle: markStyle,
          showsStatusText: showsStatusText,
          palette: palette
        )
      }
    }
    .padding(10)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(palette.detailBackground)
  }
}

private struct SidebarStatusConceptRowView: View {
  let row: SidebarStatusConceptRow
  let markStyle: SidebarStatusConceptMarkStyle
  let showsStatusText: Bool
  let palette: Palette

  private var isSelected: Bool {
    row.selection != .none
  }

  private var rowAppearance: SelectableRowStyle.ResolvedAppearance {
    SelectableRowStyle.Appearance.sidebar.resolve(palette: palette)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(row.title)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(isSelected ? palette.selectedText : palette.selectableRow.title)
          .lineLimit(1)
          .truncationMode(.tail)
          .frame(maxWidth: .infinity, alignment: .leading)

        SidebarStatusConceptIndicator(
          state: row.state,
          markStyle: markStyle,
          showsText: showsStatusText,
          isSelected: isSelected,
          palette: palette
        )
      }

      if let preview = row.preview {
        Text(preview)
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(isSelected ? palette.selectedText.opacity(0.82) : palette.secondaryText)
          .lineLimit(2)
          .truncationMode(.tail)
      }

      Text(row.path)
        .font(.system(size: 11, weight: .regular, design: .monospaced))
        .foregroundStyle(isSelected ? palette.selectedSecondaryText : palette.secondaryText)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .padding(.horizontal, TerminalSidebarLayout.rowHorizontalPadding)
    .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
    .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      rowAppearance.fill(
        selection: row.selection,
        isPressed: false,
        isHovering: false
      )
    )
    .modifier(
      SelectableRowChrome(
        selection: row.selection,
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        appearance: rowAppearance,
        showsSelectionEdge: true
      )
    )
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(isSelected ? .isSelected : [])
  }
}

private struct SidebarStatusConceptIndicator: View {
  let state: SidebarStatusConceptState
  let markStyle: SidebarStatusConceptMarkStyle
  let showsText: Bool
  let isSelected: Bool
  let palette: Palette

  private var color: Color {
    state.color(palette: palette, isSelected: isSelected)
  }

  var body: some View {
    HStack(spacing: 4) {
      SidebarStatusConceptMark(
        state: state,
        style: markStyle,
        color: color
      )

      if showsText {
        Text(state.label)
          .font(.system(size: 10, weight: .semibold))
      }
    }
    .foregroundStyle(color)
    .fixedSize()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(state.accessibilityLabel)
  }
}

private struct SidebarStatusConceptMark: View {
  let state: SidebarStatusConceptState
  let style: SidebarStatusConceptMarkStyle
  let color: Color

  var body: some View {
    Group {
      switch (style, state) {
      case (.simple, .working), (.simple, .input):
        Circle()
          .fill(color)
          .frame(width: 6, height: 6)
      case (_, .done):
        Image(systemName: "checkmark")
          .font(.system(size: 9, weight: .bold))
      case (.simple, .idle):
        EmptyView()
      case (.symbols, .working):
        Circle()
          .trim(from: 0.08, to: 0.8)
          .stroke(color, style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
          .rotationEffect(.degrees(-90))
          .frame(width: 9, height: 9)
      case (.symbols, .input):
        Image(systemName: "bell.fill")
          .font(.system(size: 8, weight: .semibold))
      case (.symbols, .idle):
        Image(systemName: "clock")
          .font(.system(size: 9, weight: .medium))
      }
    }
    .accessibilityHidden(true)
  }
}
