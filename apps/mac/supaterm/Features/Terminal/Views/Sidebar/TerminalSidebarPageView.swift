import AppKit
import SwiftUI

enum TerminalSidebarPageNavigation {
  static func resolvedSelection<SelectionValue: Hashable>(
    preferred: SelectionValue?,
    orderedValues: [SelectionValue]
  ) -> SelectionValue? {
    guard !orderedValues.isEmpty else { return nil }
    if let preferred, orderedValues.contains(preferred) {
      return preferred
    }
    return orderedValues[0]
  }

  static func next<SelectionValue: Hashable>(
    after selection: SelectionValue,
    in orderedValues: [SelectionValue]
  ) -> SelectionValue? {
    guard let currentIndex = orderedValues.firstIndex(of: selection) else { return nil }
    let nextIndex = orderedValues.index(after: currentIndex)
    guard orderedValues.indices.contains(nextIndex) else { return nil }
    return orderedValues[nextIndex]
  }

  static func previous<SelectionValue: Hashable>(
    before selection: SelectionValue,
    in orderedValues: [SelectionValue]
  ) -> SelectionValue? {
    guard let currentIndex = orderedValues.firstIndex(of: selection) else { return nil }
    guard currentIndex != orderedValues.startIndex else { return nil }
    let previousIndex = orderedValues.index(before: currentIndex)
    guard orderedValues.indices.contains(previousIndex) else { return nil }
    return orderedValues[previousIndex]
  }
}

struct TerminalSidebarPageView<SelectionValue, Content>: NSViewControllerRepresentable
where SelectionValue: Hashable & Sendable, Content: View {
  @Binding var selection: SelectionValue
  let next: (SelectionValue) -> SelectionValue?
  let previous: (SelectionValue) -> SelectionValue?
  let swipeEnabled: Bool
  let onSwipeSelectionChange: (SelectionValue) -> Void
  let content: (SelectionValue, Bool) -> Content

  init(
    selection: Binding<SelectionValue>,
    next: @escaping (SelectionValue) -> SelectionValue?,
    previous: @escaping (SelectionValue) -> SelectionValue?,
    swipeEnabled: Bool,
    onSwipeSelectionChange: @escaping (SelectionValue) -> Void,
    @ViewBuilder content: @escaping (SelectionValue, Bool) -> Content
  ) {
    _selection = selection
    self.next = next
    self.previous = previous
    self.swipeEnabled = swipeEnabled
    self.onSwipeSelectionChange = onSwipeSelectionChange
    self.content = content
  }

  func makeNSViewController(context: Context) -> NSPageController {
    let pageController = NSPageController()
    pageController.view = NSView()
    pageController.view.wantsLayer = true
    pageController.delegate = context.coordinator
    let (arrangedObjects, selectedIndex) = arrangedObjects(around: selection)
    pageController.arrangedObjects = arrangedObjects
    pageController.selectedIndex = selectedIndex
    pageController.transitionStyle = .horizontalStrip
    context.coordinator.pageController = pageController
    context.coordinator.swipeEnabled = swipeEnabled
    context.coordinator.updateCachedViews(selectedValue: selection)
    return pageController
  }

  func updateNSViewController(
    _ pageController: NSPageController,
    context: Context
  ) {
    context.coordinator.parent = self
    context.coordinator.pageController = pageController
    context.coordinator.swipeEnabled = swipeEnabled

    if context.coordinator.selectedValue(in: pageController) != selection {
      context.coordinator.go(
        to: selection,
        in: pageController,
        animated: context.transaction.animation != nil
      )
    } else {
      context.coordinator.refreshArrangedObjectsIfNeeded(in: pageController)
      context.coordinator.updateCachedViews(selectedValue: selection)
    }
  }

  func makeCoordinator() -> Coordinator {
    Coordinator(self)
  }

  private func arrangedObjects(
    around value: SelectionValue,
    limit: Int = 1
  ) -> ([Any], Int) {
    var currentValue = value
    var previousObjects = [SelectionValue]()
    while let previousValue = previous(currentValue), previousObjects.count < limit {
      previousObjects.insert(previousValue, at: 0)
      currentValue = previousValue
    }
    currentValue = value
    var nextObjects = [value]
    while let nextValue = next(currentValue), nextObjects.count <= limit {
      nextObjects.append(nextValue)
      currentValue = nextValue
    }
    let allObjects = previousObjects + nextObjects
    let selectedIndex = previousObjects.count
    return (allObjects, selectedIndex)
  }
}

extension TerminalSidebarPageView {
  final class Coordinator: NSObject, NSPageControllerDelegate {
    var parent: TerminalSidebarPageView
    var viewCache: [SelectionValue: HostingView] = [:]
    weak var pageController: NSPageController?
    var swipeEnabled = true
    private var horizontalSwipeRecognizer = HorizontalSwipeGestureRecognizer()
    private var isAnimating = false
    private var shouldCommitSwipeSelection = false

    init(_ parent: TerminalSidebarPageView) {
      self.parent = parent
    }

    func handleScrollWheel(_ event: NSEvent) -> Bool {
      guard swipeEnabled else { return false }

      switch horizontalSwipeRecognizer.handleScrollWheel(event) {
      case .ignored:
        return false
      case .consumed:
        return true
      case .next:
        navigateByDirection(1)
        return true
      case .previous:
        navigateByDirection(-1)
        return true
      }
    }

    func pageController(
      _ pageController: NSPageController,
      identifierFor object: Any
    ) -> NSPageController.ObjectIdentifier {
      .container
    }

    func pageController(
      _ pageController: NSPageController,
      viewControllerForIdentifier identifier: NSPageController.ObjectIdentifier
    ) -> NSViewController {
      let viewController = ContainerViewController()
      viewController.coordinator = self
      return viewController
    }

    func pageController(
      _ pageController: NSPageController,
      prepare viewController: NSViewController,
      with object: Any?
    ) {
      guard
        let viewController = viewController as? ContainerViewController,
        let value = object as? SelectionValue
      else {
        return
      }

      viewController.prepare(value)
    }

    func pageController(
      _ pageController: NSPageController,
      didTransitionTo object: Any
    ) {
      guard let value = object as? SelectionValue else { return }
      pageController.completeTransition()
      refreshArrangedObjectsIfNeeded(in: pageController, preferredSelection: value)
      updateCachedViews(selectedValue: value)
      if shouldCommitSwipeSelection {
        parent.selection = value
        parent.onSwipeSelectionChange(value)
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
        shouldCommitSwipeSelection = false
      }
      isAnimating = false
    }

    func selectedValue(in pageController: NSPageController) -> SelectionValue? {
      guard let container = pageController.selectedViewController as? ContainerViewController else {
        return nil
      }
      return container.representedValue
    }

    func go(
      to value: SelectionValue,
      in pageController: NSPageController,
      animated: Bool
    ) {
      let (arrangedObjects, selectedIndex) = parent.arrangedObjects(around: value)
      pageController.arrangedObjects = arrangedObjects
      if animated {
        isAnimating = true
        NSAnimationContext.runAnimationGroup { context in
          context.duration = 0.18
          context.timingFunction = CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1)
          pageController.animator().selectedIndex = selectedIndex
        }
      } else {
        pageController.selectedIndex = selectedIndex
        refreshArrangedObjectsIfNeeded(in: pageController, preferredSelection: value)
        updateCachedViews(selectedValue: value)
        isAnimating = false
      }
    }

    func refreshArrangedObjectsIfNeeded(
      in pageController: NSPageController,
      preferredSelection: SelectionValue? = nil
    ) {
      guard let selectedValue = preferredSelection ?? selectedValue(in: pageController) else {
        return
      }
      let lastValue = pageController.arrangedObjects.last as? SelectionValue
      let firstValue = pageController.arrangedObjects.first as? SelectionValue
      guard selectedValue == firstValue || selectedValue == lastValue else { return }
      let (newObjects, selectedIndex) = parent.arrangedObjects(around: selectedValue)
      pageController.arrangedObjects = newObjects
      pageController.selectedIndex = selectedIndex
      flushViewCache(in: pageController)
    }

    func updateCachedViews(selectedValue: SelectionValue) {
      for (value, view) in viewCache {
        view.rootView = parent.content(value, value == selectedValue)
        view.coordinator = self
      }
    }

    func makeView(for value: SelectionValue) -> NSView {
      let isSelected = value == parent.selection
      if let cached = viewCache[value] {
        cached.rootView = parent.content(value, isSelected)
        cached.coordinator = self
        return cached
      }

      let view = HostingView(rootView: parent.content(value, isSelected))
      view.coordinator = self
      viewCache[value] = view
      return view
    }

    func flushViewCache(in pageController: NSPageController) {
      guard let currentValues = pageController.arrangedObjects as? [SelectionValue] else { return }
      for value in viewCache.keys where !currentValues.contains(value) {
        viewCache.removeValue(forKey: value)
      }
    }

    private func navigateByDirection(_ direction: Int) {
      guard let pageController, !isAnimating else { return }

      let targetIndex = pageController.selectedIndex + direction
      guard targetIndex >= 0, targetIndex < pageController.arrangedObjects.count else { return }

      isAnimating = true
      shouldCommitSwipeSelection = true

      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.18
        context.timingFunction = CAMediaTimingFunction(controlPoints: 0.16, 1, 0.3, 1)
        pageController.animator().selectedIndex = targetIndex
      }
    }
  }

  final class ContainerViewController: NSViewController {
    weak var coordinator: Coordinator?

    override func loadView() {
      view = NSView()
      view.autoresizingMask = [.width, .height]
    }

    var representedValue: SelectionValue? {
      representedObject as? SelectionValue
    }

    func prepare(_ value: SelectionValue) {
      representedObject = value

      for subview in view.subviews {
        subview.removeFromSuperview()
      }

      guard let contentView = coordinator?.makeView(for: value) else { return }

      contentView.autoresizingMask = [.width, .height]
      contentView.frame = view.bounds
      contentView.removeFromSuperview()
      view.addSubview(contentView)
    }
  }

  final class HostingView: NSHostingView<Content> {
    weak var coordinator: Coordinator?

    override func wantsForwardedScrollEvents(for axis: NSEvent.GestureAxis) -> Bool {
      false
    }

    override func scrollWheel(with event: NSEvent) {
      if let coordinator, coordinator.handleScrollWheel(event) {
        return
      }
      super.scrollWheel(with: event)
    }
  }
}

extension NSPageController.ObjectIdentifier {
  static let container = "container"
}
