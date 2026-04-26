import Testing

@testable import SupatermCLIShared
@testable import SupatermComputerUseFeature

struct ComputerUseMouseInputTests {
  @Test
  func frontmostTargetsUseHIDEvents() {
    let dispatch = ComputerUseMouseInput.dispatch(
      isTargetActive: true,
      button: .left,
      count: 1,
      modifiers: [],
      skyLightAvailable: true
    )

    #expect(dispatch == .hidEvent)
  }

  @Test
  func defaultBackgroundLeftClicksUseSkyLightWhenAvailable() {
    let singleClick = ComputerUseMouseInput.dispatch(
      isTargetActive: false,
      button: .left,
      count: 1,
      modifiers: [],
      skyLightAvailable: true
    )
    let doubleClick = ComputerUseMouseInput.dispatch(
      isTargetActive: false,
      button: .left,
      count: 2,
      modifiers: [],
      skyLightAvailable: true
    )

    #expect(singleClick == .skyLightEvent)
    #expect(doubleClick == .skyLightEvent)
  }

  @Test
  func complexBackgroundClicksUsePidEvents() {
    let tripleClick = ComputerUseMouseInput.dispatch(
      isTargetActive: false,
      button: .left,
      count: 3,
      modifiers: [],
      skyLightAvailable: true
    )
    let rightClick = ComputerUseMouseInput.dispatch(
      isTargetActive: false,
      button: .right,
      count: 1,
      modifiers: [],
      skyLightAvailable: true
    )
    let modifiedClick = ComputerUseMouseInput.dispatch(
      isTargetActive: false,
      button: .left,
      count: 1,
      modifiers: [.command],
      skyLightAvailable: true
    )
    let unavailableSkyLight = ComputerUseMouseInput.dispatch(
      isTargetActive: false,
      button: .left,
      count: 1,
      modifiers: [],
      skyLightAvailable: false
    )

    #expect(tripleClick == .pidEvent)
    #expect(rightClick == .pidEvent)
    #expect(modifiedClick == .pidEvent)
    #expect(unavailableSkyLight == .pidEvent)
  }

  @Test
  func scrollDirectionsMapToKeyboardNavigation() {
    #expect(ComputerUseKeyboardInput.scrollKeys(direction: .up, unit: .line).key == "up")
    #expect(ComputerUseKeyboardInput.scrollKeys(direction: .down, unit: .page).key == "page-down")
    #expect(ComputerUseKeyboardInput.scrollKeys(direction: .left, unit: .page).modifiers == [.option])
    #expect(ComputerUseKeyboardInput.scrollKeys(direction: .right, unit: .page).modifiers == [.option])
  }
}
