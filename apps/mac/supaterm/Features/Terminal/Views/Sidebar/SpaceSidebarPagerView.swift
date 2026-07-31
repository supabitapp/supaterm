import AppKit
import ComposableArchitecture
import SupaTheme
import SwiftUI

struct SpaceSidebarPagerView: View {
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let palette: Palette
  let isActive: Bool
  let fixedHoveredGroupID: TerminalTabGroupID?

  private struct Paging: Equatable {
    var indices: [Int]
    var fractionalIndex: Double
  }

  private struct Page: Identifiable {
    let index: Int
    let space: TerminalSpaceItem

    var id: TerminalSpaceID { space.id }
  }

  @State private var swipe = SpaceSwipeController()
  @State private var paging: Paging?

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
    .onChange(of: terminal.spaces.count, initial: true) { _, count in swipe.pageCount = count }
    .onChange(of: displayedIndex, initial: true) { _, index in swipe.displayedIndex = index }
  }

  private var displayedIndex: Int {
    terminal.spaces.firstIndex { $0.id == terminal.displayedSpaceID } ?? 0
  }

  private var pages: [Page] {
    (paging?.indices ?? [displayedIndex]).compactMap { index in
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
        fixedHoveredGroupID: fixedHoveredGroupID
      )
    } else {
      SpaceSidebarPlaceholderView(space: page.space, palette: pagePalette)
    }
  }

  private func offset(for index: Int) -> CGFloat {
    guard let paging else { return 0 }
    return CGFloat(Double(index) - paging.fractionalIndex) * swipe.pageWidth
  }

  private func connect() {
    guard isActive else {
      disconnect()
      return
    }
    swipe.positionChanged = { position in
      track(position)
    }
    swipe.settled = { index in
      animate(to: index) {
        guard terminal.spaces.indices.contains(index) else { return }
        _ = store.send(.selectSpaceButtonTapped(terminal.spaces[index].id))
      }
    }
    swipe.cancelled = {
      animate(to: displayedIndex) {}
    }
    terminal.spacePager = swipe
  }

  private func disconnect() {
    swipe.positionChanged = nil
    swipe.settled = nil
    swipe.cancelled = nil
    guard terminal.spacePager === swipe else { return }
    terminal.spacePager = nil
  }

  private func track(_ position: SpaceSwipeController.PagingPosition) {
    let indices = mountedIndices(from: position.fractionalIndex, to: position.fractionalIndex)
    if paging?.indices != indices {
      warm(indices)
    }
    paging = Paging(indices: indices, fractionalIndex: position.fractionalIndex)
  }

  private func animate(to index: Int, completion: @escaping () -> Void) {
    let start = paging?.fractionalIndex ?? Double(displayedIndex)
    let indices = mountedIndices(from: start, to: Double(index))
    warm(indices)
    paging = Paging(indices: indices, fractionalIndex: start)
    Task { @MainActor in
      await Task.yield()
      withAnimation(.easeOut(duration: SpaceSwipeController.settleDuration)) {
        paging = Paging(indices: indices, fractionalIndex: Double(index))
      } completion: {
        completion()
        guard !swipe.isTracking else { return }
        paging = nil
      }
    }
  }

  private func mountedIndices(from first: Double, to second: Double) -> [Int] {
    let lower = Int(min(first, second).rounded(.down))
    let upper = Int(max(first, second).rounded(.up))
    return (lower...upper).filter { terminal.spaces.indices.contains($0) }
  }

  private func warm(_ indices: [Int]) {
    for index in indices {
      terminal.warmInstance(for: terminal.spaces[index].id)
    }
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
