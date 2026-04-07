public enum HoloMotionSource: Sendable {
  case pointer
  case manual(pitch: Float, roll: Float)

  var usesPointerInput: Bool {
    if case .pointer = self {
      return true
    }
    return false
  }

  func tilt(using state: HoloInteractionState) -> HoloTilt {
    switch self {
    case .pointer:
      state.tilt
    case .manual(let pitch, let roll):
      HoloTilt(pitch: pitch, roll: roll)
    }
  }
}
