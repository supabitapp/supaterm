import AppKit
import ComposableArchitecture
import SupaTheme
import SwiftUI

struct SpaceSidebarPagerView: View {
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let palette: Palette
  let isActive: Bool
  let sidebarControllerCache: TerminalSidebarControllerCache
  let fixedHoveredGroupID: TerminalTabGroupID?
  @Binding var position: Double?

  private struct Page: Identifiable {
    let index: Int
    let space: TerminalSpaceItem

    var id: TerminalSpaceID { space.id }
  }

  @State private var swipe = SpaceSwipeController()
  @State private var mountedIndices: [Int]?
  @State private var pendingSwipeSelectionID: UUID?
  @State private var animationID = UUID()

  var body: some View {
    ZStack(alignment: .topLeading) {
      ForEach(pages) { page in
        pageContent(page)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          .offset(x: offset(for: page.index))
      }
    }
    .clipped()
    .background {
      SpaceSwipeGestureView(swipe: swipe, isActive: isActive)
    }
    .onAppear(perform: connect)
    .onDisappear(perform: disconnect)
    .onChange(of: isActive) { _, _ in connect() }
    .onChange(of: terminal.spaces.map(\.id), initial: true) { _, spaceIDs in
      sidebarControllerCache.retain(spaceIDs)
    }
  }

  private var pages: [Page] {
    (mountedIndices ?? [terminal.displayedSpaceIndex]).compactMap { index in
      guard terminal.spaces.indices.contains(index) else { return nil }
      return Page(index: index, space: terminal.spaces[index])
    }
  }

  @ViewBuilder
  private func pageContent(_ page: Page) -> some View {
    let pagePalette = palette.tinted(page.space.color)
    if let instance = terminal.spaceManager.instance(for: page.space.id) {
      TerminalSidebarSpaceList(
        store: store,
        terminal: terminal,
        instance: instance,
        palette: pagePalette,
        swipe: swipe,
        controllerCache: sidebarControllerCache,
        fixedHoveredGroupID: fixedHoveredGroupID
      )
    } else {
      SpaceSidebarPlaceholderView(space: page.space, palette: pagePalette)
    }
  }

  private func offset(for index: Int) -> CGFloat {
    guard let position else { return 0 }
    return CGFloat(Double(index) - position) * swipe.pageWidth
  }

  private func connect() {
    guard isActive else {
      disconnect()
      return
    }
    swipe.pageCount = { [terminal] in terminal.spaces.count }
    swipe.displayedIndex = { [terminal] in terminal.displayedSpaceIndex }
    swipe.positionChanged = track
    swipe.selected = { [terminal] index in
      guard terminal.spaces.indices.contains(index) else { return }
      terminal.selectSpace(terminal.spaces[index].id)
    }
    swipe.swipeSelected = { [terminal] index in
      guard terminal.spaces.indices.contains(index) else { return }
      let selectionID = UUID()
      let spaceID = terminal.spaces[index].id
      pendingSwipeSelectionID = selectionID
      animate(from: terminal.displayedSpaceIndex, to: index) {
        guard pendingSwipeSelectionID == selectionID else { return }
        pendingSwipeSelectionID = nil
        terminal.selectSpaceAfterAnimation(spaceID)
      }
    }
    swipe.slide = animate(from:to:)
    terminal.spacePager = swipe
  }

  private func disconnect() {
    swipe.positionChanged = nil
    swipe.selected = nil
    swipe.swipeSelected = nil
    swipe.slide = nil
    pendingSwipeSelectionID = nil
    guard terminal.spacePager === swipe else { return }
    terminal.spacePager = nil
  }

  private func track(_ position: SpaceSwipeController.PagingPosition) {
    sidebarControllerCache.dismissHoverCards()
    let fraction = position.fractionalIndex
    let indices = spannedIndices(from: fraction, to: fraction)
    if mountedIndices != indices {
      mount(indices)
    }
    self.position = fraction
  }

  private func animate(from origin: Int, to destination: Int) {
    pendingSwipeSelectionID = nil
    animate(from: origin, to: destination, completion: nil)
  }

  private func animate(
    from origin: Int,
    to destination: Int,
    completion: (() -> Void)?
  ) {
    sidebarControllerCache.dismissHoverCards()
    let start = position ?? Double(origin)
    let target = Double(destination)
    let currentAnimationID = UUID()
    animationID = currentAnimationID
    mount(spannedIndices(from: start, to: target))
    position = start
    Task { @MainActor in
      await Task.yield()
      withAnimation(.easeOut(duration: SpaceSwipeController.settleDuration)) {
        position = target
      } completion: {
        guard
          animationID == currentAnimationID,
          !swipe.isTracking,
          position == target
        else { return }
        mountedIndices = nil
        position = nil
        completion?()
      }
    }
  }

  private func spannedIndices(from first: Double, to second: Double) -> [Int] {
    let lower = Int(min(first, second).rounded(.down))
    let upper = Int(max(first, second).rounded(.up))
    return (lower...upper).filter { terminal.spaces.indices.contains($0) }
  }

  private func mount(_ indices: [Int]) {
    for index in indices {
      terminal.warmInstance(for: terminal.spaces[index].id)
    }
    mountedIndices = indices
  }
}

private struct SpaceSidebarPlaceholderView: View {
  let space: TerminalSpaceItem
  let palette: Palette

  var body: some View {
    Text(space.name)
      .font(.system(size: 12, weight: .medium))
      .foregroundStyle(palette.secondaryText)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(palette.windowBackgroundTint)
  }
}

private struct SpaceSwipeGestureView: NSViewRepresentable {
  let swipe: SpaceSwipeController
  let isActive: Bool

  func makeNSView(context: Context) -> SpaceSwipeGestureNSView {
    SpaceSwipeGestureNSView()
  }

  func updateNSView(_ nsView: SpaceSwipeGestureNSView, context: Context) {
    nsView.swipe = isActive ? swipe : nil
  }
}

private final class SpaceSwipeGestureNSView: NSView {
  var swipe: SpaceSwipeController? {
    didSet { swipe?.pageWidth = bounds.width }
  }

  private var scrollMonitor: Any?

  override func layout() {
    super.layout()
    swipe?.pageWidth = bounds.width
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil {
      removeScrollMonitor()
    } else {
      installScrollMonitor()
    }
  }

  private func installScrollMonitor() {
    guard scrollMonitor == nil else { return }
    scrollMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
      self?.handle(event) == true ? nil : event
    }
  }

  private func removeScrollMonitor() {
    guard let scrollMonitor else { return }
    NSEvent.removeMonitor(scrollMonitor)
    self.scrollMonitor = nil
  }

  private func handle(_ event: NSEvent) -> Bool {
    guard let swipe, let window, event.window === window else { return false }
    guard swipe.isTracking || bounds.contains(convert(event.locationInWindow, from: nil)) else {
      return false
    }
    return swipe.handle(event)
  }
}
