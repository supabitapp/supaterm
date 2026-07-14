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
  ]
}

private struct ChromeBackgroundSnapshotFixture: View {
  let appearance: SnapshotAppearance

  var body: some View {
    ChromeBackgroundView(palette: Palette(colorScheme: appearance.colorScheme))
  }
}

private struct PaletteTokenSheetSnapshotFixture: View {
  let appearance: SnapshotAppearance

  var body: some View {
    let palette = Palette(colorScheme: appearance.colorScheme)
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
    let semanticTokens = [
      TokenSwatch(name: "backgroundIlluminationStart", color: palette.backgroundIlluminationStart),
      TokenSwatch(name: "backgroundIlluminationStop", color: palette.backgroundIlluminationStop),
      TokenSwatch(name: "chromeBackgroundStart", color: palette.chromeBackgroundStartValue.color),
      TokenSwatch(name: "chromeBackgroundStop", color: palette.chromeBackgroundStopValue.color),
      TokenSwatch(name: "windowBackgroundTint", color: palette.windowBackgroundTint),
      TokenSwatch(name: "detailBackground", color: palette.detailBackground),
      TokenSwatch(name: "agentPanelBackground", color: palette.agentPanelBackground),
      TokenSwatch(name: "detailStroke", color: palette.detailStroke),
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
      TokenSwatch(name: "sidebarTabTitle", color: palette.sidebarTabTitle),
      TokenSwatch(name: "sidebarSelectedFill", color: palette.sidebarSelectedFill),
      TokenSwatch(name: "sidebarSelectedStroke", color: palette.sidebarSelectedStroke),
      TokenSwatch(name: "sidebarItemHoverFill", color: palette.sidebarItemHoverFill),
      TokenSwatch(name: "sidebarItemPressedFill", color: palette.sidebarItemPressedFill),
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
      TokenSwatch(name: "warningFill", color: palette.warningFill),
      TokenSwatch(name: "dangerFill", color: palette.dangerFill),
      TokenSwatch(name: "dangerHoverFill", color: palette.dangerHoverFill),
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
