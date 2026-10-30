import ExpoModulesCore
import UIKit

final class SupatermScrollEdgeBleedView: ExpoView {

  private var scrollView: UIScrollView?
  private var container: UIView?

  private var content: UIView?
  private var bleed = UIEdgeInsets.zero

  private var applied = false

  private var containerClipped: Bool?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    #if canImport(UIKit, _version: 9127.0.85)
    if #available(iOS 27.1, *) {
      registerForTraitChanges(UITraitCollection.systemTraitsAffectingVerticalBarEdge) { (view: SupatermScrollEdgeBleedView, _: UITraitCollection) in
        view.setNeedsLayout()
      }
    }
    #endif
  }

  deinit {
    MainActor.assumeIsolated { detach() }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { detach() } else { setNeedsLayout() }
  }

  override func didAddSubview(_ subview: UIView) {
    super.didAddSubview(subview)
    setNeedsLayout()
  }

  override func willRemoveSubview(_ subview: UIView) {
    if let scrollView, scrollView.isDescendant(of: subview) { detach() }
    super.willRemoveSubview(subview)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard window != nil, let found = findScrollView(), let parent = found.superview else { return }
    if found !== scrollView {
      detach()
      scrollView = found
      container = parent

      content = found.subviews.first { type(of: $0) == UIView.self }
    }
    bleed = verticalBarBleed()

    if content == nil { bleed.left = 0 }
    apply()
  }

  private func verticalBarBleed() -> UIEdgeInsets {
    guard let side = verticalBarSide() else { return .zero }
    var ancestor = superview
    while let view = ancestor {
      let inset = side == .left ? view.safeAreaInsets.left : view.safeAreaInsets.right
      if inset > 0 {
        let frame = convert(bounds, to: view)
        let flush = side == .left
          ? abs(frame.minX - (view.bounds.minX + inset)) < 0.5
          : abs(view.bounds.maxX - inset - frame.maxX) < 0.5
        guard flush else { return .zero }
        return side == .left
          ? UIEdgeInsets(top: 0, left: inset, bottom: 0, right: 0)
          : UIEdgeInsets(top: 0, left: 0, bottom: 0, right: inset)
      }
      ancestor = view.superview
    }
    return .zero
  }

  private enum Side { case left, right }

  private func verticalBarSide() -> Side? {

    #if canImport(UIKit, _version: 9127.0.85)
    if #available(iOS 27.1, *) {
      let rtl = effectiveUserInterfaceLayoutDirection == .rightToLeft
      switch traitCollection.verticalBarEdge {
      case .leading: return rtl ? .right : .left
      case .trailing: return rtl ? .left : .right
      default: return nil
      }
    }
    #endif
    return nil
  }

  private func apply() {
    guard let scrollView, let container else { return }
    let bleeding = bleed != .zero
    guard bleeding || applied else { return }

    let frame = container.bounds.inset(
      by: UIEdgeInsets(top: 0, left: -bleed.left, bottom: 0, right: -bleed.right))
    if scrollView.frame != frame { scrollView.frame = frame }
    if let content, content.bounds.origin.x != -bleed.left {
      content.bounds.origin.x = -bleed.left
    }
    if !bleeding {
      if let clipped = containerClipped {
        containerClipped = nil
        container.layer.masksToBounds = clipped
      }
    } else if container.layer.masksToBounds {

      containerClipped = containerClipped ?? true
      container.layer.masksToBounds = false
    }
    var indicators = scrollView.verticalScrollIndicatorInsets
    if indicators.right != bleed.right {
      indicators.right = bleed.right
      scrollView.verticalScrollIndicatorInsets = indicators
    }
    applied = bleeding
  }

  private func detach() {
    guard scrollView != nil else { return }
    bleed = .zero
    apply()
    scrollView = nil
    container = nil
    content = nil
  }

  private func findScrollView() -> UIScrollView? {
    var level: [UIView] = subviews
    for _ in 0..<4 {
      var next: [UIView] = []
      for view in level {
        if let scrollView = view as? UIScrollView { return scrollView }
        next.append(contentsOf: view.subviews)
      }
      level = next
    }
    return nil
  }
}
