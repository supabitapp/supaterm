import AppKit

struct TerminalTabDragPreviewLayout {
  private static let previewWidth: CGFloat = 210
  private static let fallbackHeight: CGFloat = 138.6

  static func frame(
    for sourceSize: CGSize?,
    at screenPoint: CGPoint
  ) -> CGRect {
    let size = previewSize(for: sourceSize)
    return CGRect(
      x: screenPoint.x - size.width / 2,
      y: screenPoint.y - size.height / 2,
      width: size.width,
      height: size.height
    )
  }

  static func snapshotFrame(for imageSize: CGSize?, in bounds: CGRect) -> CGRect {
    guard
      let imageSize,
      imageSize.width.isFinite,
      imageSize.height.isFinite,
      imageSize.width > 0,
      imageSize.height > 0,
      bounds.width.isFinite,
      bounds.width > 0
    else { return bounds }
    let scale = bounds.width / imageSize.width
    return CGRect(
      origin: bounds.origin,
      size: CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
    )
  }

  private static func previewSize(for sourceSize: CGSize?) -> CGSize {
    guard
      let sourceSize,
      sourceSize.width.isFinite,
      sourceSize.height.isFinite,
      sourceSize.width > 0
    else { return fallbackSize }
    let height = sourceSize.height * previewWidth / sourceSize.width
    guard height.isFinite, height > 0 else { return fallbackSize }
    return CGSize(width: previewWidth, height: height)
  }

  private static var fallbackSize: CGSize {
    CGSize(width: previewWidth, height: fallbackHeight)
  }
}

@MainActor
protocol TerminalTabDragPreviewPresenting: AnyObject {
  func show(image: NSImage?, frame: CGRect) -> CGRect
  func hide()
}

@MainActor
final class TerminalTabDragPreviewController: TerminalTabDragPreviewPresenting {
  private let snapshotView = TerminalTabDragSnapshotView()
  private var panel: TerminalTabDragPreviewPanel?

  func show(image: NSImage?, frame: CGRect) -> CGRect {
    snapshotView.image = image?.isValid == true ? image : nil
    let panel = panel ?? TerminalTabDragPreviewPanel(contentView: snapshotView)
    self.panel = panel
    panel.setFrame(frame, display: false)
    panel.orderFrontRegardless()
    return panel.frame
  }

  func hide() {
    panel?.orderOut(nil)
    snapshotView.image = nil
  }
}

@MainActor
private final class TerminalTabDragSnapshotView: NSView {
  private let imageView = NSImageView()

  var image: NSImage? {
    didSet {
      imageView.image = image
      needsLayout = true
    }
  }

  override var isFlipped: Bool { true }
  override var wantsUpdateLayer: Bool { true }

  init() {
    super.init(frame: .zero)
    wantsLayer = true
    imageView.imageScaling = .scaleAxesIndependently
    addSubview(imageView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func layout() {
    super.layout()
    imageView.frame = TerminalTabDragPreviewLayout.snapshotFrame(
      for: image?.size,
      in: bounds
    )
  }

  override func updateLayer() {
    layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
  }
}

@MainActor
private final class TerminalTabDragPreviewPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }

  init(contentView: NSView) {
    super.init(
      contentRect: .zero,
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    self.contentView = contentView
    animationBehavior = .none
    backgroundColor = .clear
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    hasShadow = true
    hidesOnDeactivate = false
    ignoresMouseEvents = true
    isFloatingPanel = true
    isOpaque = false
    level = .popUpMenu
    contentView.wantsLayer = true
    contentView.layer?.cornerRadius = 12
    contentView.layer?.masksToBounds = true
  }
}

extension NSWindow {
  func terminalTabDragSnapshot() -> NSImage? {
    guard
      let contentView,
      !contentView.bounds.isEmpty,
      let representation = contentView.bitmapImageRepForCachingDisplay(in: contentView.bounds)
    else { return nil }
    contentView.cacheDisplay(in: contentView.bounds, to: representation)
    let image = NSImage(size: contentView.bounds.size)
    image.addRepresentation(representation)
    return image
  }
}
