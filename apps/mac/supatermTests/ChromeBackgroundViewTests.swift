import AppKit
import QuartzCore
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

@MainActor
struct ChromeBackgroundViewTests {
  @Test
  func effectViewUsesBehindWindowMaterialThatFollowsWindowActivity() {
    let view = ChromeBackgroundNSView()

    #expect(view.effectView.material == .underWindowBackground)
    #expect(view.effectView.blendingMode == .behindWindow)
    #expect(view.effectView.state == .followsWindowActiveState)
    #expect(view.effectView.isEmphasized)
  }

  @Test
  func supportsFloatingSidebarBackdrop() {
    let view = ChromeBackgroundNSView(material: .popover, blendingMode: .withinWindow)

    #expect(view.effectView.material == .popover)
    #expect(view.effectView.blendingMode == .withinWindow)
  }

  @Test
  func rampStopsUseTheSixReferenceGradientLocations() {
    let colors = [
      ThemeColor(hex: 0x10141B),
      ThemeColor(hex: 0x2A3242),
      ThemeColor(hex: 0x485266),
      ThemeColor(hex: 0x66718A),
      ThemeColor(hex: 0x8994AC),
      ThemeColor(hex: 0xB0B8C8),
    ]

    let stops = ChromeBackgroundRamp.stops(colors)

    #expect(stops.count == 6)
    #expect(stops.map(\.location) == [0, 0.2, 0.4, 0.6, 0.8, 1])
    #expect(stops.map(\.color) == colors)
  }

  @Test
  func gradientRampViewRunsTopDown() {
    let view = ChromeBackgroundNSView()

    #expect(view.baseRampView.isFlipped)
    #expect(view.baseRampView.gradientLayer?.startPoint == CGPoint(x: 0.5, y: 0))
    #expect(view.baseRampView.gradientLayer?.endPoint == CGPoint(x: 0.5, y: 1))
  }

  @Test
  func applyingPaletteConfiguresTheMaterialGradientAndGrain() {
    let view = ChromeBackgroundNSView()
    let palette = Palette(colorScheme: .dark, tint: .blue)

    view.apply(palette)

    let baseColors = view.baseRampView.gradientLayer?.colors as? [CGColor]
    #expect(baseColors == palette.backgroundGradientStops.map(\.cgColor))
    #expect(view.baseRampView.gradientLayer?.locations == ChromeBackgroundRamp.locations.map { NSNumber(value: $0) })
    #expect(view.grainView.layer?.backgroundColor != nil)
  }

  @Test
  func firstPaletteLandsWithoutCrossfade() {
    let view = ChromeBackgroundNSView()

    view.apply(Palette(colorScheme: .dark, tint: .blue))

    #expect(view.baseRampView.gradientLayer?.animation(forKey: "colors") == nil)
  }

  @Test
  func appearanceChangeKeepingTintLandsWithoutCrossfade() {
    let view = ChromeBackgroundNSView()

    view.apply(Palette(colorScheme: .dark, tint: .blue))
    view.apply(Palette(colorScheme: .light, tint: .blue))

    #expect(view.baseRampView.gradientLayer?.animation(forKey: "colors") == nil)
  }

  @Test
  func tintChangeCrossfadesTheOutgoingGradient() {
    let view = ChromeBackgroundNSView()
    let outgoing = Palette(colorScheme: .dark, tint: .neutral)

    view.apply(outgoing)
    view.apply(Palette(colorScheme: .dark, tint: .blue))

    let crossfade = view.baseRampView.gradientLayer?.animation(forKey: "colors") as? CABasicAnimation
    #expect(
      crossfade?.fromValue as? [CGColor]
        == ChromeBackgroundRamp.stops(outgoing.backgroundGradientStops).map(\.color.cgColor)
    )
    #expect(crossfade?.duration == GradientRampView.crossfadeDuration)
    #expect(crossfade?.timingFunction != nil)
  }
}
