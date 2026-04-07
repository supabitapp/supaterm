import SwiftUI

private struct HoloCardSizeKey: EnvironmentKey {
  static let defaultValue = CGSize(width: 84, height: 84)
}

private struct HoloCardCornerRadiusKey: EnvironmentKey {
  static let defaultValue: CGFloat = 20
}

private struct HoloCardTiltDegreesKey: EnvironmentKey {
  static let defaultValue = 7.0
}

private struct HoloCardParallaxDistanceKey: EnvironmentKey {
  static let defaultValue: CGFloat = 6
}

private struct HoloMotionSourceKey: EnvironmentKey {
  static let defaultValue = HoloMotionSource.pointer
}

extension EnvironmentValues {
  var holoCardSize: CGSize {
    get { self[HoloCardSizeKey.self] }
    set { self[HoloCardSizeKey.self] = newValue }
  }

  var holoCardCornerRadius: CGFloat {
    get { self[HoloCardCornerRadiusKey.self] }
    set { self[HoloCardCornerRadiusKey.self] = newValue }
  }

  var holoCardTiltDegrees: Double {
    get { self[HoloCardTiltDegreesKey.self] }
    set { self[HoloCardTiltDegreesKey.self] = newValue }
  }

  var holoCardParallaxDistance: CGFloat {
    get { self[HoloCardParallaxDistanceKey.self] }
    set { self[HoloCardParallaxDistanceKey.self] = newValue }
  }

  var holoMotionSource: HoloMotionSource {
    get { self[HoloMotionSourceKey.self] }
    set { self[HoloMotionSourceKey.self] = newValue }
  }
}

extension View {
  public func holoSize(width: CGFloat, height: CGFloat) -> some View {
    environment(\.holoCardSize, CGSize(width: width, height: height))
  }

  public func holoCornerRadius(_ radius: CGFloat) -> some View {
    environment(\.holoCardCornerRadius, radius)
  }

  public func holoTilt(_ degrees: Double) -> some View {
    environment(\.holoCardTiltDegrees, degrees)
  }

  public func holoParallax(_ distance: CGFloat) -> some View {
    environment(\.holoCardParallaxDistance, distance)
  }

  public func holoMotionSource(_ source: HoloMotionSource) -> some View {
    environment(\.holoMotionSource, source)
  }
}
