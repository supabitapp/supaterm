import AppKit
import SupaTheme
import SwiftUI

extension SnapshotCatalog {
  static let chromeScenarios: [SnapshotScenario] = [
    scenario(
      "background",
      group: "Chrome",
      title: "Background",
      size: CGSize(width: 480, height: 300)
    ) { appearance in
      AnyView(ChromeBackgroundSnapshotFixture(appearance: appearance))
    },
    scenario(
      "palette-tokens",
      group: "Chrome",
      title: "Palette token sheet",
      size: CGSize(width: 760, height: 920)
    ) { appearance in
      AnyView(PaletteTokenSheetSnapshotFixture(appearance: appearance))
    },
    scenario(
      "group-surfaces",
      group: "Chrome",
      title: "Group surfaces",
      size: CGSize(width: 680, height: 230)
    ) { appearance in
      AnyView(GroupSurfaceSnapshotFixture(appearance: appearance))
    },
    scenario(
      "terminal-theme-backgrounds",
      group: "Chrome",
      title: "Terminal theme backgrounds",
      size: CGSize(width: 1020, height: 500),
      appearances: [.dark]
    ) { appearance in
      AnyView(TerminalThemeBackgroundSnapshotFixture(appearance: appearance))
    },
  ]
}

private struct TerminalThemeBackgroundSnapshotFixture: View {
  let appearance: SnapshotAppearance

  var body: some View {
    let canvas = Palette(
      colorScheme: appearance.colorScheme,
      backgroundSeed: appearance.terminalBackground
    )
    ZStack {
      canvas.detailBackground
      LazyVGrid(
        columns: Array(repeating: GridItem(.flexible(), spacing: 14), count: 3),
        spacing: 14
      ) {
        ForEach(samples) { sample in
          TerminalThemeChromeSample(sample: sample)
        }
      }
      .padding(20)
    }
  }

  private var samples: [TerminalThemeSample] {
    [
      TerminalThemeSample(
        name: "Default dark",
        colorScheme: .dark,
        background: ThemeColor(hex: 0x1C1917)
      ),
      TerminalThemeSample(
        name: "Default light",
        colorScheme: .light,
        background: ThemeColor(hex: 0xF0EDEC)
      ),
      TerminalThemeSample(
        name: "Warm light",
        colorScheme: .light,
        background: ThemeColor(hex: 0xFBF1C7)
      ),
      TerminalThemeSample(
        name: "Cool dark",
        colorScheme: .dark,
        background: ThemeColor(hex: 0x2E3440)
      ),
      TerminalThemeSample(
        name: "Neutral dark",
        colorScheme: .dark,
        background: ThemeColor(hex: 0x191919)
      ),
      TerminalThemeSample(
        name: "Saturated dark",
        colorScheme: .dark,
        background: ThemeColor(hex: 0x21084A)
      ),
    ]
  }
}

private struct TerminalThemeSample: Identifiable {
  let name: String
  let colorScheme: ColorScheme
  let background: ThemeColor

  var id: String { name }
}

private struct TerminalThemeChromeSample: View {
  let sample: TerminalThemeSample

  var body: some View {
    let palette = Palette(
      colorScheme: sample.colorScheme,
      backgroundSeed: sample.background
    )
    ChromeBackgroundView(palette: palette)
      .overlay {
        VStack(spacing: 12) {
          HStack(spacing: 8) {
            Image(systemName: "terminal")
              .accessibilityHidden(true)
            Text(sample.name)
              .fontWeight(.semibold)
            Spacer()
            Image(systemName: "plus")
              .accessibilityHidden(true)
          }
          .font(.system(size: 12))
          .foregroundStyle(palette.primaryText)

          Spacer(minLength: 0)

          HStack(spacing: 10) {
            Text("Terminal")
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(palette.selectableRow.selectedTitle)
              .padding(.horizontal, 12)
              .frame(height: 30)
              .background(
                palette.selectableRow.primarySelectionFill,
                in: RoundedRectangle(cornerRadius: 8, style: .continuous)
              )
            Spacer()
            Text(sample.colorScheme == .dark ? "Dark" : "Light")
              .font(.system(size: 10, weight: .medium))
              .foregroundStyle(palette.secondaryText)
          }
        }
        .padding(14)
      }
      .frame(height: 216)
      .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .strokeBorder(canvasStroke, lineWidth: 1)
      }
  }

  private var canvasStroke: Color {
    sample.colorScheme == .dark ? Color.white.opacity(0.12) : Color.black.opacity(0.12)
  }
}

private struct ChromeBackgroundSnapshotFixture: View {
  let appearance: SnapshotAppearance

  var body: some View {
    ChromeBackgroundView(
      palette: Palette(colorScheme: appearance.colorScheme, backgroundSeed: appearance.terminalBackground))
  }
}

private struct PaletteTokenSheetSnapshotFixture: View {
  let appearance: SnapshotAppearance

  var body: some View {
    let palette = Palette(colorScheme: appearance.colorScheme, backgroundSeed: appearance.terminalBackground)
    ZStack {
      palette.detailBackground
      LazyVGrid(
        columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 14
      ) {
        ForEach(tokens(for: palette), id: \.name) { token in
          VStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
              .fill(token.style)
              .frame(height: 34)
              .overlay {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                  .strokeBorder(palette.detailStroke, lineWidth: 1)
              }
            Text(token.name)
              .font(.system(size: 9, weight: .medium))
              .foregroundStyle(palette.secondaryText)
              .lineLimit(1)
          }
        }
      }
      .padding(20)
    }
  }

  private struct TokenSwatch {
    let name: String
    let style: AnyShapeStyle

    init<Style: ShapeStyle>(name: String, color: Style) {
      self.name = name
      style = AnyShapeStyle(color)
    }
  }

  private func tokens(for palette: Palette) -> [TokenSwatch] {
    let sidebarTabRow = palette.selectableRow
    let semanticTokens = [
      TokenSwatch(name: "backgroundIlluminationTop", color: palette.backgroundIlluminationTopValue.color),
      TokenSwatch(name: "backgroundIlluminationBody", color: palette.backgroundIlluminationBodyValue.color),
      TokenSwatch(name: "backgroundIlluminationFooter", color: palette.backgroundIlluminationFooterValue.color),
      TokenSwatch(name: "chromeBackgroundStart", color: palette.chromeBackgroundStartValue.color),
      TokenSwatch(name: "chromeBackgroundStop", color: palette.chromeBackgroundStopValue.color),
      TokenSwatch(name: "windowBackgroundTint", color: palette.windowBackgroundTint),
      TokenSwatch(name: "detailBackground", color: palette.detailBackground),
      TokenSwatch(name: "agentPanelBackground", color: palette.agentPanelBackground),
      TokenSwatch(name: "detailStroke", color: palette.detailStroke),
      TokenSwatch(name: "detailShadow", color: palette.detailShadow),
      TokenSwatch(name: "unselectedFill", color: palette.unselectedFill),
      TokenSwatch(name: "hoverFill", color: palette.hoverFill),
      TokenSwatch(name: "pressedFill", color: palette.pressedFill),
      TokenSwatch(name: "selectedFill", color: palette.selectedFill),
      TokenSwatch(name: "selectedText", color: palette.selectedText),
      TokenSwatch(name: "selectedSecondaryText", color: palette.selectedSecondaryText),
      TokenSwatch(name: "selectedPillFill", color: palette.selectedPillFill),
      TokenSwatch(name: "selectedPillStroke", color: palette.selectedPillStroke),
      TokenSwatch(name: "selectedStrokeBright", color: palette.selectedStrokeBright),
      TokenSwatch(name: "selectedStrokeDim", color: palette.selectedStrokeDim),
      TokenSwatch(name: "selectedShadow", color: palette.selectedShadow),
      TokenSwatch(name: "primaryText", color: palette.primaryText),
      TokenSwatch(name: "secondaryText", color: palette.secondaryText),
      TokenSwatch(name: "sidebarTabRowRest", color: sidebarTabRow.restFill),
      TokenSwatch(name: "sidebarTabRowHover", color: sidebarTabRow.hoverFill),
      TokenSwatch(name: "sidebarTabRowPressed", color: sidebarTabRow.pressedFill),
      TokenSwatch(name: "sidebarTabRowPrimarySelection", color: sidebarTabRow.primarySelectionFill),
      TokenSwatch(name: "sidebarTabRowSecondarySelection", color: sidebarTabRow.secondarySelectionFill),
      TokenSwatch(name: "sidebarTabRowSelectedTitle", color: sidebarTabRow.selectedTitle),
      TokenSwatch(name: "sidebarTabRowTitle", color: sidebarTabRow.title),
      TokenSwatch(name: "sidebarTabRowSelectedEdgeStrong", color: palette.sidebarTabRowSelectedEdgeStrong),
      TokenSwatch(name: "sidebarTabRowSelectedEdgeWeak", color: palette.sidebarTabRowSelectedEdgeWeak),
      TokenSwatch(name: "sidebarTabRowShadow", color: sidebarTabRow.shadow),
      TokenSwatch(name: "sidebarSeparator", color: palette.sidebarSeparator),
      TokenSwatch(name: "shadow", color: palette.shadow),
      TokenSwatch(name: "scrim", color: palette.scrim),
      TokenSwatch(name: "overlayShadow", color: palette.overlayShadow),
      TokenSwatch(name: "divider", color: palette.divider),
      TokenSwatch(name: "accent", color: palette.accent),
      TokenSwatch(name: "warning", color: palette.warning),
      TokenSwatch(name: "success", color: palette.success),
      TokenSwatch(name: "danger", color: palette.danger),
      TokenSwatch(name: "merged", color: palette.merged),
      TokenSwatch(name: "queued", color: palette.queued),
      TokenSwatch(name: "warningFill", color: palette.warningFill),
      TokenSwatch(name: "dangerFill", color: palette.dangerFill),
      TokenSwatch(name: "dangerHoverFill", color: palette.dangerHoverFill),
      TokenSwatch(
        name: "sidebarGroupNeutralHoverFill",
        color: palette.sidebarGroupNeutralHoverFillValue.color
      ),
      TokenSwatch(name: "sidebarGroupStroke", color: palette.sidebarGroupStrokeValue.color),
      TokenSwatch(name: "onAccent", color: palette.onAccent),
      TokenSwatch(name: "onWarning", color: palette.onWarning),
      TokenSwatch(name: "onSuccess", color: palette.onSuccess),
      TokenSwatch(name: "onDanger", color: palette.onDanger),
      TokenSwatch(name: "onMerged", color: palette.onMerged),
      TokenSwatch(name: "onWarningFill", color: palette.onWarningFill),
      TokenSwatch(name: "onDangerFill", color: palette.onDangerFill),
    ]
    return semanticTokens
      + palette.referenceSwatches.map {
        TokenSwatch(name: $0.name, color: $0.color)
      }
  }
}

private struct GroupSurfaceSnapshotFixture: View {
  let appearance: SnapshotAppearance

  var body: some View {
    let palette = Palette(colorScheme: appearance.colorScheme, backgroundSeed: appearance.terminalBackground)
    ZStack {
      palette.detailBackground
      VStack(spacing: 14) {
        ForEach([ThemeTint.neutral, .blue], id: \.self) { color in
          HStack(spacing: 12) {
            ForEach(
              [
                TerminalSidebarGroupSurfaceState.resting,
                .hovered,
                .dropTarget,
              ],
              id: \.self
            ) { state in
              VStack(spacing: 5) {
                GroupSurfaceRepresentable(color: color, palette: palette, state: state)
                  .frame(width: 190, height: 58)
                Text("\(color.displayName) · \(name(state))")
                  .font(.system(size: 10, weight: .medium))
                  .foregroundStyle(palette.secondaryText)
              }
            }
          }
        }
      }
      .padding(20)
    }
  }

  private func name(_ state: TerminalSidebarGroupSurfaceState) -> String {
    switch state {
    case .resting: "Resting"
    case .hovered: "Hovered"
    case .dropTarget: "Drop target"
    }
  }
}

private struct GroupSurfaceRepresentable: NSViewRepresentable {
  let color: ThemeTint
  let palette: Palette
  let state: TerminalSidebarGroupSurfaceState

  func makeNSView(context: Context) -> TerminalSidebarGroupBackgroundView {
    TerminalSidebarGroupBackgroundView(frame: .zero)
  }

  func updateNSView(_ view: TerminalSidebarGroupBackgroundView, context: Context) {
    view.update(
      color: color,
      palette: palette,
      surfaceState: state,
      alpha: 1,
      reduceMotion: true
    )
  }
}
