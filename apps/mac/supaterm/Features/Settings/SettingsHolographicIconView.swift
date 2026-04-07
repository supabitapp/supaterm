import AppKit
import SwiftUI

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

  @Environment(\.accessibilityReduceMotion) private var accessibilityReduceMotion
  @State private var effect = SettingsHolographicIconEffect.resting

  private let size = CGSize(width: 84, height: 84)
  private let cornerRadius: CGFloat = 21
  private let iconScale: CGFloat = 1.12

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
