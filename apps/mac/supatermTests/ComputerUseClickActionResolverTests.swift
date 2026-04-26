import ApplicationServices
import Testing

@testable import SupatermCLIShared
@testable import SupatermComputerUseFeature

struct ComputerUseClickActionResolverTests {
  @Test
  func singleUnmodifiedElementClicksTryResolvedActionEvenWhenUnadvertised() {
    let action = ComputerUseClickActionResolver.accessibilityAction(
      request: .init(pid: 1, windowID: 2, elementIndex: 3),
      advertisedActions: []
    )

    #expect(action == kAXPressAction as String)
    #expect(
      ComputerUseClickActionResolver.warning(
        role: kAXButtonRole as String,
        action: kAXPressAction as String,
        advertisedActions: []
      ) == "action_not_advertised")
  }

  @Test
  func rightPressMapsToShowMenu() {
    let action = ComputerUseClickActionResolver.accessibilityAction(
      request: .init(pid: 1, windowID: 2, elementIndex: 3, button: .right),
      advertisedActions: []
    )

    #expect(action == kAXShowMenuAction as String)
  }

  @Test
  func doubleClickUsesOpenWhenAdvertised() {
    let action = ComputerUseClickActionResolver.accessibilityAction(
      request: .init(pid: 1, windowID: 2, elementIndex: 3, count: 2),
      advertisedActions: ["AXOpen"]
    )

    #expect(action == "AXOpen")
  }

  @Test
  func doubleClickWithoutOpenFallsBackToPixelPath() {
    let action = ComputerUseClickActionResolver.accessibilityAction(
      request: .init(pid: 1, windowID: 2, elementIndex: 3, count: 2),
      advertisedActions: [kAXPressAction as String]
    )

    #expect(action == nil)
  }

  @Test
  func popupWarningTakesPrecedence() {
    let warning = ComputerUseClickActionResolver.warning(
      role: kAXPopUpButtonRole as String,
      action: kAXPressAction as String,
      advertisedActions: []
    )

    #expect(warning == "popup_value_may_require_set_value")
  }

  @Test
  func failedSelectedAccessibilityActionUsesActionFailedError() {
    let error = ComputerUseError.actionFailed(3, kAXPressAction as String)

    #expect(error.code == "action_failed")
    #expect(error.errorDescription == "Element 3 failed AXPress.")
  }
}
