import AppKit
import SwiftUI

private struct SettingsHolographicSparkle: Equatable {
  let center: CGPoint
  let diameter: CGFloat
  let blurRadius: CGFloat
  let travel: CGFloat
  let opacity: Double
}

struct SettingsHolographicIconEffect: Equatable {
  static let restingPointerRatio = CGPoint(x: 0.5, y: 0.5)
  static let maxPitchDegrees: CGFloat = 7
  static let maxYawDegrees: CGFloat = 7
  static let foilCenterRange: ClosedRange<CGFloat> = 0.18...0.82

  let pointerRatio: CGPoint
  let isHovering: Bool

  init(pointerRatio: CGPoint, isHovering: Bool) {
    self.pointerRatio = Self.clamp(pointerRatio)
    self.isHovering = isHovering
  }

  static let resting = Self(pointerRatio: restingPointerRatio, isHovering: false)

  static func pointerRatio(for location: CGPoint, in size: CGSize) -> CGPoint {
    guard size.width > 0, size.height > 0 else { return restingPointerRatio }
    return clamp(
      CGPoint(
        x: location.x / size.width,
        y: location.y / size.height
      )
    )
  }

  static func clamp(_ point: CGPoint) -> CGPoint {
    CGPoint(
      x: min(max(point.x, 0), 1),
      y: min(max(point.y, 0), 1)
    )
  }

  var pitchDegrees: CGFloat {
    (0.5 - pointerRatio.y) * Self.maxPitchDegrees * 2
  }

  var yawDegrees: CGFloat {
    (pointerRatio.x - 0.5) * Self.maxYawDegrees * 2
  }

  var highlightCenter: UnitPoint {
    UnitPoint(x: pointerRatio.x, y: pointerRatio.y)
  }

  var foilCenter: CGFloat {
    Self.foilCenterRange.lowerBound
      + (Self.foilCenterRange.upperBound - Self.foilCenterRange.lowerBound) * pointerRatio.x
  }

  var overlayOpacity: Double {
    isHovering ? 1 : 0.7
  }
}

struct SettingsHolographicIconView: View {
  let appName: String
  let enableSparkleEffect: Bool
  let enableRainbowHolographicEffect: Bool

  @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
  @State private var effect = SettingsHolographicIconEffect.resting

  private let size = CGSize(width: 84, height: 84)
  private let cornerRadius: CGFloat = 21
  private let iconScale: CGFloat = 1.12
  private let sparkleDriftDistance: CGFloat = 6

  private static let sparkles = [
    SettingsHolographicSparkle(
      center: CGPoint(x: 0.2, y: 0.24),
      diameter: 6,
      blurRadius: 0.8,
      travel: 0.7,
      opacity: 0.52
    ),
    SettingsHolographicSparkle(
      center: CGPoint(x: 0.72, y: 0.18),
      diameter: 4.5,
      blurRadius: 0.6,
      travel: 0.9,
      opacity: 0.48
    ),
    SettingsHolographicSparkle(
      center: CGPoint(x: 0.64, y: 0.44),
      diameter: 5.5,
      blurRadius: 0.9,
      travel: 0.8,
      opacity: 0.44
    ),
    SettingsHolographicSparkle(
      center: CGPoint(x: 0.3, y: 0.68),
      diameter: 4,
      blurRadius: 0.5,
      travel: 1.1,
      opacity: 0.4
    ),
    SettingsHolographicSparkle(
      center: CGPoint(x: 0.78, y: 0.76),
      diameter: 6.5,
      blurRadius: 1.1,
      travel: 0.65,
      opacity: 0.46
    ),
  ]

  var body: some View {
    ZStack {
      iconImage

      holoOverlays
        .mask(iconImage)
    }
    .frame(width: size.width, height: size.height)
    .clipShape(.rect(cornerRadius: cornerRadius))
    .contentShape(.rect(cornerRadius: cornerRadius))
    .shadow(
      color: .black.opacity(effect.isHovering ? 0.28 : 0.18), radius: effect.isHovering ? 12 : 8,
      y: effect.isHovering ? 9 : 6
    )
    .rotation3DEffect(
      .degrees(accessibilityReduceMotion ? 0 : effect.pitchDegrees),
      axis: (x: 1, y: 0, z: 0),
      perspective: 0.7
    )
    .rotation3DEffect(
      .degrees(accessibilityReduceMotion ? 0 : effect.yawDegrees),
      axis: (x: 0, y: 1, z: 0),
      perspective: 0.7
    )
    .onContinuousHover(coordinateSpace: .local) { phase in
      updateEffect(phase)
    }
    .accessibilityLabel("\(appName) app icon")
  }

  private var iconImage: some View {
    Image(nsImage: NSApplication.shared.applicationIconImage ?? NSImage())
      .resizable()
      .interpolation(.high)
      .scaleEffect(iconScale)
      .accessibilityHidden(true)
  }

  private var holoOverlays: some View {
    ZStack {
      LinearGradient(
        colors: [
          .white.opacity(effect.isHovering ? 0.08 : 0.05),
          .clear,
          .white.opacity(effect.isHovering ? 0.16 : 0.08),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
      .blendMode(.screen)

      RadialGradient(
        colors: [
          .white.opacity(effect.isHovering ? 0.44 : 0.22),
          .white.opacity(effect.isHovering ? 0.14 : 0.06),
          .clear,
        ],
        center: effect.highlightCenter,
        startRadius: 0,
        endRadius: 64
      )
      .blendMode(.screen)

      if enableSparkleEffect {
        sparkleOverlay
      }

      LinearGradient(
        stops: [
          .init(color: .clear, location: 0),
          .init(color: Color(red: 0.48, green: 0.91, blue: 1).opacity(0.46), location: effect.foilCenter - 0.18),
          .init(color: Color(red: 0.63, green: 0.98, blue: 0.8).opacity(0.42), location: effect.foilCenter - 0.05),
          .init(color: Color(red: 1, green: 0.63, blue: 0.85).opacity(0.44), location: effect.foilCenter + 0.08),
          .init(color: .clear, location: 1),
        ],
        startPoint: .leading,
        endPoint: .trailing
      )
      .scaleEffect(1.7)
      .rotationEffect(.degrees(22))
      .blendMode(.overlay)

      if enableRainbowHolographicEffect {
        rainbowOverlay
      }

      LinearGradient(
        stops: [
          .init(color: .clear, location: 0.08),
          .init(color: .white.opacity(effect.isHovering ? 0.16 : 0.08), location: 0.32),
          .init(color: .clear, location: 0.6),
        ],
        startPoint: .top,
        endPoint: .bottom
      )
      .scaleEffect(1.3)
      .rotationEffect(.degrees(-24))
      .blendMode(.screen)
    }
    .opacity(effect.overlayOpacity)
    .compositingGroup()
  }

  private var rainbowOverlay: some View {
    LinearGradient(
      stops: [
        .init(color: .clear, location: 0),
        .init(color: Color(red: 1, green: 0.45, blue: 0.78).opacity(0.42), location: effect.foilCenter - 0.28),
        .init(color: Color(red: 1, green: 0.71, blue: 0.38).opacity(0.36), location: effect.foilCenter - 0.16),
        .init(color: Color(red: 0.95, green: 0.9, blue: 0.42).opacity(0.28), location: effect.foilCenter - 0.06),
        .init(color: Color(red: 0.44, green: 0.94, blue: 0.65).opacity(0.34), location: effect.foilCenter + 0.04),
        .init(color: Color(red: 0.42, green: 0.84, blue: 1).opacity(0.42), location: effect.foilCenter + 0.16),
        .init(color: Color(red: 0.72, green: 0.58, blue: 1).opacity(0.4), location: effect.foilCenter + 0.28),
        .init(color: .clear, location: 1),
      ],
      startPoint: .leading,
      endPoint: .trailing
    )
    .scaleEffect(1.9)
    .rotationEffect(.degrees(-18))
    .blendMode(.colorDodge)
    .opacity(effect.isHovering ? 0.72 : 0.3)
  }

  private var sparkleOverlay: some View {
    ZStack {
      ForEach(Array(Self.sparkles.enumerated()), id: \.offset) { _, sparkle in
        sparkleView(sparkle)
      }
    }
    .blendMode(.plusLighter)
  }

  private func sparkleView(_ sparkle: SettingsHolographicSparkle) -> some View {
    let offset = sparkleOffset(for: sparkle)
    let opacity = effect.isHovering ? sparkle.opacity : sparkle.opacity * 0.35

    return ZStack {
      Circle()
        .fill(.white.opacity(opacity))
        .frame(width: sparkle.diameter, height: sparkle.diameter)
        .blur(radius: sparkle.blurRadius)

      Capsule()
        .fill(.white.opacity(opacity * 0.75))
        .frame(width: sparkle.diameter * 2.2, height: 1.2)
        .blur(radius: sparkle.blurRadius * 0.5)

      Capsule()
        .fill(.white.opacity(opacity * 0.75))
        .frame(width: 1.2, height: sparkle.diameter * 2.2)
        .blur(radius: sparkle.blurRadius * 0.5)
    }
    .position(x: sparkle.center.x * size.width, y: sparkle.center.y * size.height)
    .offset(offset)
  }

  private func sparkleOffset(for sparkle: SettingsHolographicSparkle) -> CGSize {
    CGSize(
      width: (effect.pointerRatio.x - 0.5) * sparkle.travel * sparkleDriftDistance,
      height: (effect.pointerRatio.y - 0.5) * sparkle.travel * sparkleDriftDistance
    )
  }

  private func updateEffect(_ phase: HoverPhase) {
    switch phase {
    case .active(let location):
      effect = .init(
        pointerRatio: SettingsHolographicIconEffect.pointerRatio(for: location, in: size),
        isHovering: true
      )
    case .ended:
      if accessibilityReduceMotion {
        effect = .resting
      } else {
        withAnimation(.smooth(duration: 0.18)) {
          effect = .resting
        }
      }
    }
  }
}
