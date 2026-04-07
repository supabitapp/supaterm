import SwiftUI
import Testing

@testable import HoloKit

struct HoloLayerBuilderTests {
  @Test
  func builderPreservesOrderAndConditionals() {
    let showsGlint = true
    let layers = buildLayers {
      HoloLayer.color(.black)
      HoloLayer.prism()
      if showsGlint {
        HoloLayer.glintField()
      }
      HoloLayer.lightSweep()
    }

    #expect(layers.count == 4)
    if case .color = layers[0].kind {
      #expect(Bool(true))
    } else {
      Issue.record("Expected first layer to be a color layer.")
    }
    if case .glintField = layers[2].kind {
      #expect(Bool(true))
    } else {
      Issue.record("Expected third layer to be a glint layer.")
    }
  }

  @Test
  func modifiersUpdateLayerConfiguration() {
    let prism = HoloLayer.prism(.spectrum, pattern: .ripple)
      .parallax(0.6)
      .intensity(0.4)
      .scale(1.8)
      .speed(0.9)
      .opacity(0.7)
      .blendMode(.overlay)
    let sweep = HoloLayer.lightSweep()
      .intensity(0.5)
      .size(0.3)
      .falloff(2.1)
    let glint = HoloLayer.glintField()
      .density(0.8)
      .size(1.6)
      .speed(4.2)

    #expect(prism.parallaxFactor == 0.6)
    #expect(prism.prismConfiguration.intensity == 0.4)
    #expect(prism.prismConfiguration.scale == 1.8)
    #expect(prism.prismConfiguration.speed == 0.9)
    #expect(prism.layerOpacity == 0.7)
    #expect(prism.layerBlendMode == .overlay)
    #expect(sweep.sweepConfiguration.intensity == 0.5)
    #expect(sweep.sweepConfiguration.size == 0.3)
    #expect(sweep.sweepConfiguration.falloff == 2.1)
    #expect(glint.glintConfiguration.density == 0.8)
    #expect(glint.glintConfiguration.size == 1.6)
    #expect(glint.glintConfiguration.speed == 4.2)
  }

  private func buildLayers(@HoloLayerBuilder _ content: () -> [HoloLayer]) -> [HoloLayer] {
    content()
  }
}
