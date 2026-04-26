import ApplicationServices
import Foundation
import SupatermCLIShared

enum ComputerUseClickActionResolver {
  static func accessibilityAction(
    request: SupatermComputerUseClickRequest,
    advertisedActions: [String]
  ) -> String? {
    if request.modifiers.isEmpty, request.count == 1 {
      return resolvedAction(button: request.button, action: request.action)
    }
    if request.modifiers.isEmpty,
      request.count == 2,
      request.button == .left,
      advertisedActions.contains("AXOpen")
    {
      return "AXOpen"
    }
    return nil
  }

  static func warning(
    role: String?,
    action: String,
    advertisedActions: [String]
  ) -> String? {
    if role == kAXPopUpButtonRole as String {
      return "popup_value_may_require_set_value"
    }
    if !advertisedActions.contains(action) {
      return "action_not_advertised"
    }
    return nil
  }

  private static func resolvedAction(
    button: SupatermComputerUseClickButton,
    action: SupatermComputerUseClickAction
  ) -> String {
    if button == .right, action == .press {
      return kAXShowMenuAction as String
    }
    switch action {
    case .press:
      return kAXPressAction as String
    case .showMenu:
      return kAXShowMenuAction as String
    case .pick:
      return "AXPick"
    case .confirm:
      return "AXConfirm"
    case .cancel:
      return "AXCancel"
    case .open:
      return "AXOpen"
    }
  }
}
