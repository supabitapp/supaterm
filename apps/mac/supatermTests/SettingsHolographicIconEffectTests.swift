import CoreGraphics
import Testing

@testable import supaterm

struct SettingsHolographicIconEffectTests {
  @Test
  func pointerRatioUsesCenterForMidpoint() {
    let ratio = SettingsHolographicIconEffect.pointerRatio(
      for: CGPoint(x: 42, y: 42),
      in: CGSize(width: 84, height: 84)
    )

    #expect(ratio == CGPoint(x: 0.5, y: 0.5))
  }

  @Test
  func pointerRatioClampsToBounds() {
    let ratio = SettingsHolographicIconEffect.pointerRatio(
      for: CGPoint(x: -12, y: 99),
      in: CGSize(width: 84, height: 84)
    )

    #expect(ratio == CGPoint(x: 0, y: 1))
  }

  @Test
  func centerPositionHasNeutralTilt() {
    let effect = SettingsHolographicIconEffect(
      pointerRatio: CGPoint(x: 0.5, y: 0.5),
      isHovering: true
    )

    #expect(effect.pitchDegrees == 0)
    #expect(effect.yawDegrees == 0)
  }

  @Test
  func cornerPositionsClampToMaximumTilt() {
    let topLeft = SettingsHolographicIconEffect(
      pointerRatio: CGPoint(x: -2, y: -2),
      isHovering: true
    )
    let bottomRight = SettingsHolographicIconEffect(
      pointerRatio: CGPoint(x: 3, y: 3),
      isHovering: true
    )

    #expect(topLeft.pitchDegrees == SettingsHolographicIconEffect.maxPitchDegrees)
    #expect(topLeft.yawDegrees == -SettingsHolographicIconEffect.maxYawDegrees)
    #expect(bottomRight.pitchDegrees == -SettingsHolographicIconEffect.maxPitchDegrees)
    #expect(bottomRight.yawDegrees == SettingsHolographicIconEffect.maxYawDegrees)
  }

  @Test
  func foilCenterTracksHorizontalMovement() {
    let leading = SettingsHolographicIconEffect(
      pointerRatio: CGPoint(x: 0, y: 0.5),
      isHovering: true
    )
    let center = SettingsHolographicIconEffect(
      pointerRatio: CGPoint(x: 0.5, y: 0.5),
      isHovering: true
    )
    let trailing = SettingsHolographicIconEffect(
      pointerRatio: CGPoint(x: 1, y: 0.5),
      isHovering: true
    )

    #expect(leading.foilCenter == SettingsHolographicIconEffect.foilCenterRange.lowerBound)
    #expect(abs(center.foilCenter - 0.5) < 0.000_1)
    #expect(abs(trailing.foilCenter - SettingsHolographicIconEffect.foilCenterRange.upperBound) < 0.000_1)
  }

  @Test
  func restingStateReturnsToCenteredPointer() {
    #expect(SettingsHolographicIconEffect.resting.pointerRatio == SettingsHolographicIconEffect.restingPointerRatio)
    #expect(SettingsHolographicIconEffect.resting.pointerRatio == CGPoint(x: 0.5, y: 0.5))
    #expect(!SettingsHolographicIconEffect.resting.isHovering)
  }
}
