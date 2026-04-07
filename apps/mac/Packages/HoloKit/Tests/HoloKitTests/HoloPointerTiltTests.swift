import CoreGraphics
import Testing

@testable import HoloKit

struct HoloPointerTiltTests {
  @Test
  func centerIsNeutral() {
    let tilt = HoloPointerTilt.normalized(
      location: CGPoint(x: 42, y: 42),
      in: CGSize(width: 84, height: 84)
    )

    #expect(tilt == .zero)
  }

  @Test
  func cornersClamp() {
    let topLeft = HoloPointerTilt.normalized(
      location: .zero,
      in: CGSize(width: 84, height: 84)
    )
    let bottomRight = HoloPointerTilt.normalized(
      location: CGPoint(x: 84, y: 84),
      in: CGSize(width: 84, height: 84)
    )

    #expect(topLeft == HoloTilt(pitch: 1, roll: -1))
    #expect(bottomRight == HoloTilt(pitch: -1, roll: 1))
  }

  @Test
  func outOfBoundsInputClamps() {
    let tilt = HoloPointerTilt.normalized(
      location: CGPoint(x: 240, y: -80),
      in: CGSize(width: 84, height: 84)
    )

    #expect(tilt == HoloTilt(pitch: 1, roll: 1))
  }

  @Test
  func interactionStateCanReturnToResting() {
    let active = HoloInteractionState.active(
      location: CGPoint(x: 12, y: 18),
      in: CGSize(width: 84, height: 84)
    )

    #expect(active.isActive)
    #expect(HoloInteractionState.resting == HoloInteractionState(tilt: .zero, isActive: false))
  }
}
