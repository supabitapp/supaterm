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
  func rampStopsInterpolatePerceptuallyAndHoldAfterRampEnd() {
    let start = ThemeColor(hex: 0x10141B)
    let stop = ThemeColor(hex: 0x2A3242)

    let stops = ChromeBackgroundRamp.stops(from: start, to: stop)

    #expect(stops.count == ChromeBackgroundRamp.sampleCount + 1)
    #expect(stops.first == ChromeBackgroundRamp.Stop(location: 0, color: start))
    #expect(stops[4].location == ChromeBackgroundRamp.rampEnd * 0.5)
    #expect(stops[4].color == ColorMath.perceptualMix(start, stop, by: 0.5))
    #expect(stops[stops.count - 2] == ChromeBackgroundRamp.Stop(location: ChromeBackgroundRamp.rampEnd, color: stop))
    #expect(stops.last == ChromeBackgroundRamp.Stop(location: 1, color: stop))
  }

  @Test
  func rampStopsInterpolateAlpha() {
    let start = ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.35)
    let stop = ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.7)

    let stops = ChromeBackgroundRamp.stops(from: start, to: stop)

    #expect(abs(stops[4].color.alpha - 0.525) < 0.0001)
  }

  @Test
  func gradientRampViewsRunTopDown() {
    let view = ChromeBackgroundNSView()

    for rampView in [view.baseRampView, view.illuminationView] {
      #expect(rampView.isFlipped)
      #expect(rampView.gradientLayer?.startPoint == CGPoint(x: 0.5, y: 0))
      #expect(rampView.gradientLayer?.endPoint == CGPoint(x: 0.5, y: 1))
    }
  }

  @Test
  func applyingPaletteConfiguresLayers() {
    let view = ChromeBackgroundNSView()
    let palette = Palette(colorScheme: .dark)

    view.apply(palette)

    let baseColors = view.baseRampView.gradientLayer?.colors as? [CGColor]
    #expect(baseColors?.count == ChromeBackgroundRamp.sampleCount + 1)
    #expect(baseColors?.first == palette.chromeBackgroundBaseStartValue.cgColor)
    #expect(baseColors?.last == palette.chromeBackgroundBaseStopValue.cgColor)
    #expect(view.baseRampView.gradientLayer?.locations?.first == 0)
    #expect(view.baseRampView.gradientLayer?.locations?.last == 1)
    #expect(abs(view.baseRampView.alphaValue - ChromeBackgroundNSView.themeTintOpacity) < 0.0001)

    let illuminationColors = view.illuminationView.gradientLayer?.colors as? [CGColor]
    #expect(illuminationColors?.allSatisfy { $0.alpha == 0 } == true)

    #expect(view.grainView.layer?.backgroundColor != nil)
  }

  @Test
  func firstPaletteLandsWithoutCrossfade() {
    let view = ChromeBackgroundNSView()

    view.apply(Palette(colorScheme: .dark, tint: .blue))

    #expect(view.baseRampView.gradientLayer?.animation(forKey: "colors") == nil)
    #expect(view.illuminationView.gradientLayer?.animation(forKey: "colors") == nil)
  }

  @Test
  func appearanceChangeKeepingTintLandsWithoutCrossfade() {
    let view = ChromeBackgroundNSView()

    view.apply(Palette(colorScheme: .dark, tint: .blue))
    view.apply(Palette(colorScheme: .light, tint: .blue))

    #expect(view.baseRampView.gradientLayer?.animation(forKey: "colors") == nil)
    #expect(view.illuminationView.gradientLayer?.animation(forKey: "colors") == nil)
  }

  @Test
  func tintChangeCrossfadesBothRampsFromTheOutgoingColors() {
    let view = ChromeBackgroundNSView()
    let outgoing = Palette(colorScheme: .dark, tint: .neutral)

    view.apply(outgoing)
    view.apply(Palette(colorScheme: .dark, tint: .blue))

    let baseCrossfade = view.baseRampView.gradientLayer?.animation(forKey: "colors") as? CABasicAnimation
    #expect(
      baseCrossfade?.fromValue as? [CGColor]
        == ChromeBackgroundRamp.stops(
          from: outgoing.chromeBackgroundBaseStartValue,
          to: outgoing.chromeBackgroundBaseStopValue
        ).map(\.color.cgColor)
    )

    for rampView in [view.baseRampView, view.illuminationView] {
      let crossfade = rampView.gradientLayer?.animation(forKey: "colors") as? CABasicAnimation
      #expect(crossfade?.duration == GradientRampView.crossfadeDuration)
      #expect(crossfade?.timingFunction != nil)
    }
  }
}
