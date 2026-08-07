import AppKit

struct TerminalTabDragPreviewLayout {
  static func frame(
    for sourceSize: CGSize,
    at screenPoint: CGPoint,
    maximumSize: CGSize = CGSize(width: 420, height: 300)
  ) -> CGRect {
    let widthScale = sourceSize.width > 0 ? maximumSize.width / sourceSize.width : 1
    let heightScale = sourceSize.height > 0 ? maximumSize.height / sourceSize.height : 1
    let scale = min(1, widthScale, heightScale)
    let size = CGSize(width: sourceSize.width * scale, height: sourceSize.height * scale)
    return CGRect(
      x: screenPoint.x - size.width * 0.18,
      y: screenPoint.y - size.height * 0.82,
      width: size.width,
      height: size.height
    )
  }
}

@MainActor
final class TerminalTabDragPreviewController {
  private let imageView = NSImageView()
  private var panel: TerminalTabDragPreviewPanel?

  init() {
    imageView.imageAlignment = .alignCenter
    imageView.imageScaling = .scaleAxesIndependently
  }

  func update(
    image: NSImage?,
    sourceSize: CGSize,
    sourceWindowFrame: CGRect?,
    screenPoint: CGPoint
  ) {
    guard let image, sourceWindowFrame?.contains(screenPoint) != true else {
      hide()
      return
    }
    imageView.image = image
    let panel = panel ?? TerminalTabDragPreviewPanel(contentView: imageView)
    self.panel = panel
    panel.setFrame(
      TerminalTabDragPreviewLayout.frame(for: sourceSize, at: screenPoint),
      display: false
    )
    panel.orderFrontRegardless()
  }

  func hide() {
    panel?.orderOut(nil)
    imageView.image = nil
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
