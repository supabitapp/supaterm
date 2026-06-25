import AppKit

final class GhosttySurfaceScrollView: NSView {
  private struct ScrollbarState {
    let total: UInt64
    let offset: UInt64
    let length: UInt64
  }

  private let scrollView: NSScrollView
  private let documentView: NSView
  private let surfaceView: GhosttySurfaceView
  private var observers: [NSObjectProtocol] = []
  private var isLiveScrolling = false
  private var lastSentRow: Int?
  private var scrollbar: ScrollbarState?

  init(surfaceView: GhosttySurfaceView) {
    self.surfaceView = surfaceView
    scrollView = NSScrollView()
    scrollView.hasHorizontalScroller = false
    scrollView.autohidesScrollers = false
    scrollView.usesPredominantAxisScrolling = true
    scrollView.scrollerStyle = .overlay
    scrollView.drawsBackground = false
    scrollView.contentView.clipsToBounds = false
    documentView = NSView(frame: .zero)
    scrollView.documentView = documentView
    documentView.addSubview(surfaceView)
    super.init(frame: .zero)
    addSubview(scrollView)
    surfaceView.scrollWrapper = self
    refreshAppearance()

    scrollView.contentView.postsBoundsChangedNotifications = true
    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSView.boundsDidChangeNotification,
        object: scrollView.contentView,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.handleScrollChange()
        }
      })

    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSScrollView.willStartLiveScrollNotification,
        object: scrollView,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.isLiveScrolling = true
        }
      })

    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSScrollView.didEndLiveScrollNotification,
        object: scrollView,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.isLiveScrolling = false
        }
      })

    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSScrollView.didLiveScrollNotification,
        object: scrollView,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.handleLiveScroll()
        }
      })

    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSScroller.preferredScrollerStyleDidChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.handleScrollerStyleChange()
        }
      })

    observers.append(
      NotificationCenter.default.addObserver(
        forName: .ghosttyRuntimeConfigDidChange,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.surfaceView.syncRuntimeConfigState()
          self?.refreshAppearance()
        }
      })
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  isolated deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
  }

  override var safeAreaInsets: NSEdgeInsets { NSEdgeInsetsZero }

  override func layout() {
    super.layout()
    scrollView.frame = bounds
    surfaceView.frame.size = scrollView.bounds.size
    documentView.frame.size.width = scrollView.bounds.width
    synchronizeScrollView()
    synchronizeSurfaceView()
    synchronizeCoreSurface()
  }

  func updateSurfaceSize() {
    synchronizeCoreSurface()
    needsLayout = true
  }

  func updateScrollbar(total: UInt64, offset: UInt64, length: UInt64) {
    scrollbar = ScrollbarState(total: total, offset: offset, length: length)
    synchronizeScrollView()
  }

  func refreshAppearance() {
    scrollView.hasVerticalScroller = surfaceView.shouldShowScrollbar()
    scrollView.appearance = NSAppearance(named: surfaceView.scrollbarAppearanceName())
    scrollView.scrollerStyle = .overlay
    updateTrackingAreas()
  }

  private func handleScrollChange() {
    synchronizeSurfaceView()
  }

  private func handleScrollerStyleChange() {
    refreshAppearance()
    synchronizeCoreSurface()
  }

  private func synchronizeSurfaceView() {
    let visibleRect = scrollView.contentView.documentVisibleRect
    surfaceView.frame.origin = visibleRect.origin
  }

  private func synchronizeCoreSurface() {
    guard
      let contentSize = Self.reportedSurfaceSize(
        scrollContentSize: scrollView.contentSize,
        surfaceFrameSize: surfaceView.frame.size
      )
    else { return }
    surfaceView.updateSurfaceSize(contentSize: contentSize)
  }

  private func synchronizeScrollView() {
    documentView.frame.size.height = documentHeight()
    if !isLiveScrolling {
      let cellHeight = surfaceView.currentCellSize().height
      if cellHeight > 0, let scrollbar {
        let offsetY =
          CGFloat(scrollbar.total - scrollbar.offset - scrollbar.length) * cellHeight
        scrollView.contentView.scroll(to: CGPoint(x: 0, y: offsetY))
        lastSentRow = Int(scrollbar.offset)
      }
    }
    scrollView.reflectScrolledClipView(scrollView.contentView)
  }

  private func handleLiveScroll() {
    let cellHeight = surfaceView.currentCellSize().height
    guard cellHeight > 0 else { return }
    let visibleRect = scrollView.contentView.documentVisibleRect
    let documentHeight = documentView.frame.height
    let scrollOffset = documentHeight - visibleRect.origin.y - visibleRect.height
    let row = Int(scrollOffset / cellHeight)
    guard row != lastSentRow else { return }
    lastSentRow = row
    surfaceView.performBindingAction("scroll_to_row:\(row)")
  }

  private func documentHeight() -> CGFloat {
    let contentHeight = scrollView.contentSize.height
    let cellHeight = surfaceView.currentCellSize().height
    if cellHeight > 0, let scrollbar {
      let documentGridHeight = CGFloat(scrollbar.total) * cellHeight
      let padding = contentHeight - (CGFloat(scrollbar.length) * cellHeight)
      return documentGridHeight + padding
    }
    return contentHeight
  }

  override func mouseMoved(with event: NSEvent) {
    guard
      Self.shouldFlashLegacyScrollers(
        scrollerStyle: NSScroller.preferredScrollerStyle,
        reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
      )
    else { return }
    scrollView.flashScrollers()
  }

  override func updateTrackingAreas() {
    trackingAreas.forEach { removeTrackingArea($0) }
    super.updateTrackingAreas()
    guard let scroller = scrollView.verticalScroller else { return }
    addTrackingArea(
      NSTrackingArea(
        rect: convert(scroller.bounds, from: scroller),
        options: [
          .mouseMoved,
          .activeInKeyWindow,
        ],
        owner: self,
        userInfo: nil
      ))
  }

  static func shouldFlashLegacyScrollers(
    scrollerStyle: NSScroller.Style,
    reduceMotion: Bool
  ) -> Bool {
    scrollerStyle == .legacy && !reduceMotion
  }

  static func reportedSurfaceSize(
    scrollContentSize: CGSize,
    surfaceFrameSize: CGSize
  ) -> CGSize? {
    let width = scrollContentSize.width
    let height = surfaceFrameSize.height
    guard width > 0, height > 0 else { return nil }
    return CGSize(width: width, height: height)
  }
}
