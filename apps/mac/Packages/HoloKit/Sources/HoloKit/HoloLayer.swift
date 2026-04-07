import SwiftUI

public struct HoloLayer: Identifiable {
  public let id = UUID()

  var kind: Kind
  var parallaxFactor: CGFloat = 0
  var layerBlendMode: BlendMode?
  var layerOpacity: Double = 1
  var prismConfiguration = HoloPrismConfiguration()
  var sweepConfiguration = HoloSweepConfiguration()
  var glintConfiguration = HoloGlintConfiguration()

  enum Kind {
    case color(Color)
    case image(Image)
    case content(AnyView)
    case prism(HoloPrismTone, HoloPattern)
    case lightSweep(Color)
    case glintField
    case group([HoloLayer])
  }

  public static func color(_ color: Color) -> HoloLayer {
    HoloLayer(kind: .color(color))
  }

  public static func image(_ image: Image) -> HoloLayer {
    HoloLayer(kind: .image(image))
  }

  public static func content<Content: View>(@ViewBuilder _ content: () -> Content) -> HoloLayer {
    HoloLayer(kind: .content(AnyView(content())))
  }

  public static func prism(
    _ tone: HoloPrismTone = .aurora,
    pattern: HoloPattern = .bands
  ) -> HoloLayer {
    var layer = HoloLayer(kind: .prism(tone, pattern))
    layer.parallaxFactor = 0.45
    return layer
  }

  public static func lightSweep(_ color: Color = .white) -> HoloLayer {
    var layer = HoloLayer(kind: .lightSweep(color))
    layer.parallaxFactor = 0.75
    return layer
  }

  public static func glintField() -> HoloLayer {
    var layer = HoloLayer(kind: .glintField)
    layer.parallaxFactor = 1
    return layer
  }

  public static func group(@HoloLayerBuilder _ content: () -> [HoloLayer]) -> HoloLayer {
    HoloLayer(kind: .group(content()))
  }

  public func parallax(_ factor: CGFloat) -> HoloLayer {
    var copy = self
    copy.parallaxFactor = factor
    return copy
  }

  public func blendMode(_ mode: BlendMode) -> HoloLayer {
    var copy = self
    copy.layerBlendMode = mode
    return copy
  }

  public func opacity(_ value: Double) -> HoloLayer {
    var copy = self
    copy.layerOpacity = value
    return copy
  }

  public func intensity(_ value: Float) -> HoloLayer {
    var copy = self
    switch copy.kind {
    case .prism:
      copy.prismConfiguration.intensity = value
    case .lightSweep:
      copy.sweepConfiguration.intensity = value
    default:
      break
    }
    return copy
  }

  public func scale(_ value: Float) -> HoloLayer {
    var copy = self
    switch copy.kind {
    case .prism:
      copy.prismConfiguration.scale = value
    case .glintField:
      copy.glintConfiguration.size = value
    default:
      break
    }
    return copy
  }

  public func speed(_ value: Float) -> HoloLayer {
    var copy = self
    switch copy.kind {
    case .prism:
      copy.prismConfiguration.speed = value
    case .glintField:
      copy.glintConfiguration.speed = value
    default:
      break
    }
    return copy
  }

  public func size(_ value: Float) -> HoloLayer {
    var copy = self
    switch copy.kind {
    case .lightSweep:
      copy.sweepConfiguration.size = value
    case .glintField:
      copy.glintConfiguration.size = value
    default:
      break
    }
    return copy
  }

  public func density(_ value: Float) -> HoloLayer {
    var copy = self
    if case .glintField = copy.kind {
      copy.glintConfiguration.density = value
    }
    return copy
  }

  public func falloff(_ value: Float) -> HoloLayer {
    var copy = self
    if case .lightSweep = copy.kind {
      copy.sweepConfiguration.falloff = value
    }
    return copy
  }
}

struct HoloPrismConfiguration {
  var intensity: Float = 0.72
  var scale: Float = 1
  var speed: Float = 0.55
}

struct HoloSweepConfiguration {
  var intensity: Float = 0.82
  var size: Float = 0.42
  var falloff: Float = 1.45
}

struct HoloGlintConfiguration {
  var density: Float = 0.55
  var size: Float = 1
  var speed: Float = 2.8
}
