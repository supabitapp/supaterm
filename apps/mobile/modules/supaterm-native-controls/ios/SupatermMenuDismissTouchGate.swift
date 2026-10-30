import ExpoModulesCore
import UIKit.UIGestureRecognizerSubclass

final class SupatermMenuDismissTouchGate: UIGestureRecognizer, UIGestureRecognizerDelegate {
  static func install(in window: UIWindow) {
    guard !(window.gestureRecognizers ?? []).contains(where: { $0 is SupatermMenuDismissTouchGate }) else {
      return
    }
    window.addGestureRecognizer(SupatermMenuDismissTouchGate())
  }

  private init() {
    super.init(target: nil, action: nil)
    delaysTouchesEnded = false
    cancelsTouchesInView = false
    delegate = self
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive event: UIEvent) -> Bool {
    if let touches = event.allTouches {
      ignoreSurfaceTouches(touches.filter { $0.phase == .began }, for: event)
    }
    return true
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    super.touchesBegan(touches, with: event)
    ignoreSurfaceTouches(touches, for: event)
    state = .failed
  }

  private func ignoreSurfaceTouches(_ touches: Set<UITouch>, for event: UIEvent) {
    guard let window = view as? UIWindow, window.subviews.contains(where: Self.isOpenMenuContainer) else {
      return
    }
    for touch in touches {
      var current = touch.view
      while let view = current {
        for recognizer in view.gestureRecognizers ?? []
        where NSStringFromClass(type(of: recognizer)) == "RCTSurfaceTouchHandler" {
          recognizer.ignore(touch, for: event)
        }
        current = view.superview
      }
    }
  }

  private static func isOpenMenuContainer(_ view: UIView) -> Bool {
    view.isUserInteractionEnabled
      && NSStringFromClass(type(of: view)) == "_UI".appending("ContextMenuContainerView")
  }
}

public final class SupatermMenuDismissTouchGateSubscriber: ExpoAppDelegateSubscriber {
  public func subscriberDidRegister() {
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(windowDidBecomeVisible(_:)),
      name: UIWindow.didBecomeVisibleNotification,
      object: nil
    )
  }

  @objc private func windowDidBecomeVisible(_ notification: Notification) {
    guard let window = notification.object as? UIWindow else { return }
    SupatermMenuDismissTouchGate.install(in: window)
  }
}
