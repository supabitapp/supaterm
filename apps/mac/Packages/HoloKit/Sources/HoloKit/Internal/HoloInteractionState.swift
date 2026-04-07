import CoreGraphics

struct HoloTilt: Equatable {
  var pitch: Float
  var roll: Float

  static let zero = HoloTilt(pitch: 0, roll: 0)
}

enum HoloPointerTilt {
  static func normalized(location: CGPoint, in size: CGSize) -> HoloTilt {
    guard size.width > 0, size.height > 0 else { return .zero }
    let x = max(-1, min(1, ((location.x / size.width) - 0.5) * 2))
    let y = max(-1, min(1, (0.5 - (location.y / size.height)) * 2))
    return HoloTilt(pitch: Float(y), roll: Float(x))
  }
}

struct HoloInteractionState: Equatable {
  let tilt: HoloTilt
  let isActive: Bool

  static let resting = HoloInteractionState(tilt: .zero, isActive: false)

  static func active(location: CGPoint, in size: CGSize) -> HoloInteractionState {
    HoloInteractionState(
      tilt: HoloPointerTilt.normalized(location: location, in: size),
      isActive: true
    )
  }
}
