import SwiftUI

private struct HoloGlintSpec {
  let center: CGPoint
  let diameter: CGFloat
  let blurRadius: CGFloat
  let travel: CGFloat
  let phase: Float
  let opacity: Double
}

@MainActor
struct HoloLayerRenderer {
  let cardSize: CGSize
  let cornerRadius: CGFloat
  let parallaxDistance: CGFloat

  private static let glintSpecs = [
    HoloGlintSpec(
      center: CGPoint(x: 0.2, y: 0.24), diameter: 6, blurRadius: 0.8, travel: 0.7, phase: 0.2, opacity: 0.52),
    HoloGlintSpec(
      center: CGPoint(x: 0.72, y: 0.18), diameter: 4.5, blurRadius: 0.6, travel: 0.9, phase: 1.0, opacity: 0.48),
    HoloGlintSpec(
      center: CGPoint(x: 0.64, y: 0.44), diameter: 5.5, blurRadius: 0.9, travel: 0.8, phase: 1.8, opacity: 0.44),
    HoloGlintSpec(
      center: CGPoint(x: 0.3, y: 0.68), diameter: 4, blurRadius: 0.5, travel: 1.1, phase: 2.3, opacity: 0.4),
    HoloGlintSpec(
      center: CGPoint(x: 0.78, y: 0.76), diameter: 6.5, blurRadius: 1.1, travel: 0.65, phase: 2.9, opacity: 0.46),
  ]

  func render(layer: HoloLayer, tilt: HoloTilt, time: Float) -> AnyView {
    switch layer.kind {
    case .color(let color):
      AnyView(
        RoundedRectangle(cornerRadius: cornerRadius)
          .fill(color)
          .opacity(layer.layerOpacity)
          .holoBlendMode(layer.layerBlendMode)
      )

    case .image(let image):
      AnyView(
        imageView(image)
          .opacity(layer.layerOpacity)
          .holoBlendMode(layer.layerBlendMode)
      )

    case .content(let view):
      AnyView(
        view
          .opacity(layer.layerOpacity)
          .holoBlendMode(layer.layerBlendMode)
      )

    case .prism(let tone, let pattern):
      AnyView(prismLayer(tone: tone, pattern: pattern, layer: layer, tilt: tilt))

    case .lightSweep(let color):
      AnyView(lightSweepLayer(color: color, layer: layer, tilt: tilt))

    case .glintField:
      AnyView(glintLayer(layer: layer, tilt: tilt, time: time))

    case .group(let sublayers):
      AnyView(groupLayer(sublayers: sublayers, layer: layer, tilt: tilt, time: time))
    }
  }

  private func prismLayer(
    tone: HoloPrismTone,
    pattern: HoloPattern,
    layer: HoloLayer,
    tilt: HoloTilt
  ) -> some View {
    let startPoint = UnitPoint(
      x: clampedUnit(0.2 + Double(tilt.roll) * 0.18),
      y: clampedUnit(0.2 - Double(tilt.pitch) * 0.18)
    )
    let endPoint = UnitPoint(
      x: clampedUnit(0.8 - Double(tilt.roll) * 0.18),
      y: clampedUnit(0.8 + Double(tilt.pitch) * 0.18)
    )
    let accentCenter = UnitPoint(
      x: clampedUnit(0.5 + Double(tilt.roll) * 0.22),
      y: clampedUnit(0.5 - Double(tilt.pitch) * 0.22)
    )
    let colors = prismColors(for: tone)
    let opacity = Double(layer.prismConfiguration.intensity) * layer.layerOpacity

    return ZStack {
      LinearGradient(
        colors: colors.map { $0.opacity(opacity) },
        startPoint: startPoint,
        endPoint: endPoint
      )
      .scaleEffect(prismScale(for: pattern, scale: layer.prismConfiguration.scale))
      .rotationEffect(.degrees(prismRotation(for: pattern)))

      RadialGradient(
        colors: [
          .white.opacity(opacity * 0.32),
          .white.opacity(opacity * 0.08),
          .clear,
        ],
        center: accentCenter,
        startRadius: 0,
        endRadius: 54
      )
    }
    .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    .holoBlendMode(layer.layerBlendMode ?? .overlay)
  }

  private func lightSweepLayer(
    color: Color,
    layer: HoloLayer,
    tilt: HoloTilt
  ) -> some View {
    let width = cardSize.width * CGFloat(layer.sweepConfiguration.size) * 1.6
    let height = cardSize.height * 1.8
    let offset = CGSize(
      width: CGFloat(tilt.roll) * cardSize.width * 0.22,
      height: CGFloat(-tilt.pitch) * cardSize.height * 0.22
    )
    let opacity = Double(layer.sweepConfiguration.intensity) * layer.layerOpacity

    return Capsule()
      .fill(
        LinearGradient(
          colors: [
            .clear,
            color.opacity(opacity * 0.2),
            color.opacity(opacity),
            color.opacity(opacity * 0.2),
            .clear,
          ],
          startPoint: .top,
          endPoint: .bottom
        )
      )
      .frame(width: width, height: height)
      .rotationEffect(.degrees(-28))
      .blur(radius: CGFloat(layer.sweepConfiguration.falloff) * 2.4)
      .offset(offset)
      .frame(width: cardSize.width, height: cardSize.height)
      .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
      .holoBlendMode(layer.layerBlendMode ?? .screen)
  }

  private func glintLayer(layer: HoloLayer, tilt: HoloTilt, time: Float) -> some View {
    let densityScale = max(0.35, Double(layer.glintConfiguration.density))
    let sizeScale = CGFloat(layer.glintConfiguration.size)

    return ZStack {
      ForEach(Array(Self.glintSpecs.enumerated()), id: \.offset) { _, spec in
        glintView(
          spec,
          opacity: glintOpacity(
            spec: spec,
            density: densityScale,
            speed: layer.glintConfiguration.speed,
            time: time
          ) * layer.layerOpacity,
          offset: glintOffset(spec: spec, tilt: tilt),
          sizeScale: sizeScale
        )
      }
    }
    .frame(width: cardSize.width, height: cardSize.height)
    .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    .holoBlendMode(layer.layerBlendMode ?? .plusLighter)
  }

  private func glintView(
    _ spec: HoloGlintSpec,
    opacity: Double,
    offset: CGSize,
    sizeScale: CGFloat
  ) -> some View {
    ZStack {
      Circle()
        .fill(.white.opacity(opacity))
        .frame(width: spec.diameter * sizeScale, height: spec.diameter * sizeScale)
        .blur(radius: spec.blurRadius)

      Capsule()
        .fill(.white.opacity(opacity * 0.75))
        .frame(width: spec.diameter * 2.2 * sizeScale, height: 1.2)
        .blur(radius: spec.blurRadius * 0.5)

      Capsule()
        .fill(.white.opacity(opacity * 0.75))
        .frame(width: 1.2, height: spec.diameter * 2.2 * sizeScale)
        .blur(radius: spec.blurRadius * 0.5)
    }
    .position(x: spec.center.x * cardSize.width, y: spec.center.y * cardSize.height)
    .offset(offset)
  }

  private func groupLayer(
    sublayers: [HoloLayer],
    layer: HoloLayer,
    tilt: HoloTilt,
    time: Float
  ) -> some View {
    let enumeratedSublayers = Array(sublayers.enumerated())

    return ZStack {
      ForEach(enumeratedSublayers, id: \.element.id) { _, sublayer in
        render(layer: sublayer, tilt: tilt, time: time)
          .offset(parallaxOffset(for: sublayer, tilt: tilt))
      }
    }
    .compositingGroup()
    .opacity(layer.layerOpacity)
    .holoBlendMode(layer.layerBlendMode)
  }

  private func imageView(_ image: Image) -> some View {
    Color.clear
      .frame(width: cardSize.width, height: cardSize.height)
      .overlay {
        image
          .resizable()
          .interpolation(.high)
          .scaledToFill()
      }
      .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
  }

  private func prismColors(for tone: HoloPrismTone) -> [Color] {
    switch tone {
    case .aurora:
      [
        Color(red: 0.93, green: 0.61, blue: 0.71),
        Color(red: 0.8, green: 0.67, blue: 0.44),
        Color(red: 0.56, green: 0.77, blue: 0.84),
        Color(red: 0.73, green: 0.55, blue: 0.81),
      ]
    case .spectrum:
      [
        Color(red: 0.93, green: 0.61, blue: 0.71),
        Color(red: 0.8, green: 0.67, blue: 0.44),
        Color(red: 0.41, green: 0.89, blue: 0.65),
        Color(red: 0.56, green: 0.77, blue: 0.84),
        Color(red: 0.73, green: 0.55, blue: 0.81),
      ]
    }
  }

  private func prismRotation(for pattern: HoloPattern) -> Double {
    switch pattern {
    case .bands:
      22
    case .ripple:
      -18
    case .shard:
      38
    }
  }

  private func prismScale(for pattern: HoloPattern, scale: Float) -> CGFloat {
    let base: CGFloat
    switch pattern {
    case .bands:
      base = 1.7
    case .ripple:
      base = 1.9
    case .shard:
      base = 1.45
    }
    return base * CGFloat(scale)
  }

  private func glintOpacity(
    spec: HoloGlintSpec,
    density: Double,
    speed: Float,
    time: Float
  ) -> Double {
    let pulse = max(sin(Double(time * speed) + Double(spec.phase)), 0)
    return spec.opacity * density * pulse
  }

  private func glintOffset(spec: HoloGlintSpec, tilt: HoloTilt) -> CGSize {
    CGSize(
      width: CGFloat(tilt.roll) * spec.travel * parallaxDistance,
      height: CGFloat(-tilt.pitch) * spec.travel * parallaxDistance
    )
  }

  private func parallaxOffset(for layer: HoloLayer, tilt: HoloTilt) -> CGSize {
    CGSize(
      width: CGFloat(tilt.roll) * parallaxDistance * layer.parallaxFactor,
      height: CGFloat(-tilt.pitch) * parallaxDistance * layer.parallaxFactor
    )
  }

  private func clampedUnit(_ value: Double) -> Double {
    min(max(value, 0), 1)
  }
}

extension View {
  @ViewBuilder
  fileprivate func holoBlendMode(_ mode: BlendMode?) -> some View {
    if let mode {
      blendMode(mode)
    } else {
      self
    }
  }
}
