import AppKit
import SupaTheme
import SwiftUI

enum TerminalSplitMetrics {
  nonisolated static let minimumPaneSize: CGFloat = 10
  nonisolated static let dividerVisibleSize: CGFloat = 1
  nonisolated static let dividerInvisibleSize: CGFloat = 6
  nonisolated static let dividerHitboxSize: CGFloat = dividerVisibleSize + dividerInvisibleSize
}

enum TerminalChromeMetrics {
  static let paneInset: CGFloat = 6
  static let paneCornerRadius: CGFloat = 16
  static var detailToolbarControlShape: ConcentricRectangle {
    ConcentricRectangle(corners: .concentric(minimum: 6))
  }
  static var paneShape: RoundedRectangle {
    RoundedRectangle(cornerRadius: paneCornerRadius, style: .continuous)
  }

  static func nestedCornerRadius(
    inside outerCornerRadius: CGFloat,
    inset: CGFloat = paneInset
  ) -> CGFloat {
    Swift.max(0, outerCornerRadius - inset)
  }
}

enum TerminalFloatingSidebarShellMetrics {
  static let borderWidth: CGFloat = 1
  static let contentInset = TerminalChromeMetrics.paneInset
  static let cornerRadius = TerminalChromeMetrics.paneCornerRadius
  static let shadowRadius: CGFloat = 16
  static let shadowYOffset: CGFloat = 6
}

enum TerminalCoordinateSpace {
  static let split = "TerminalSplit"
  static let floatingSidebar = "TerminalFloatingSidebar"
}

private struct TerminalPaneSurfaceModifier: ViewModifier {
  let stroke: Color

  func body(content: Content) -> some View {
    content
      .clipShape(TerminalChromeMetrics.paneShape)
      .overlay {
        TerminalChromeMetrics.paneShape
          .stroke(stroke, lineWidth: 1)
      }
  }
}

struct TerminalSidebarSurfaceShell<Content: View>: View {
  let palette: Palette
  let isFloating: Bool
  let content: Content

  init(
    palette: Palette,
    isFloating: Bool,
    @ViewBuilder content: () -> Content
  ) {
    self.palette = palette
    self.isFloating = isFloating
    self.content = content()
  }

  var body: some View {
    content
      .padding(isFloating ? TerminalFloatingSidebarShellMetrics.contentInset : 0)
      .background {
        ChromeBackgroundView(
          palette: palette,
          material: isFloating ? .popover : .underWindowBackground,
          blendingMode: isFloating ? .withinWindow : .behindWindow
        )
      }
      .clipShape(surfaceShape)
      .overlay {
        surfaceShape.stroke(
          palette.floatingSidebarBorder.opacity(isFloating ? 1 : 0),
          lineWidth: TerminalFloatingSidebarShellMetrics.borderWidth
        )
      }
      .shadow(
        color: palette.shadow.opacity(isFloating ? 1 : 0),
        radius: TerminalFloatingSidebarShellMetrics.shadowRadius,
        x: 0,
        y: TerminalFloatingSidebarShellMetrics.shadowYOffset
      )
  }

  private var surfaceShape: RoundedRectangle {
    RoundedRectangle(
      cornerRadius: isFloating ? TerminalFloatingSidebarShellMetrics.cornerRadius : 0,
      style: .continuous
    )
  }
}

extension View {
  func terminalDetailPaneChrome(palette: Palette) -> some View {
    self
      .modifier(
        TerminalPaneSurfaceModifier(
          stroke: palette.colorScheme == .dark ? palette.detailStroke : .clear
        )
      )
      .shadow(color: palette.detailShadow, radius: 2, x: 0, y: 1)
      .padding(TerminalChromeMetrics.paneInset)
  }
}

struct ToolbarIconButton: View {
  let symbol: String
  let palette: Palette
  let accessibilityLabel: String?
  let showsAttentionIndicator: Bool
  let action: () -> Void

  @State private var isHovering = false

  init(
    symbol: String,
    palette: Palette,
    accessibilityLabel: String? = nil,
    showsAttentionIndicator: Bool = false,
    action: @escaping () -> Void = {}
  ) {
    self.symbol = symbol
    self.palette = palette
    self.accessibilityLabel = accessibilityLabel
    self.showsAttentionIndicator = showsAttentionIndicator
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      ZStack(alignment: .topTrailing) {
        Image(systemName: symbol)
          .font(.system(size: 14, weight: .medium))
          .foregroundStyle(isHovering ? palette.secondaryText.opacity(0.8) : palette.secondaryText)

        if showsAttentionIndicator {
          Image(systemName: "circle.fill")
            .font(.system(size: 7, weight: .bold))
            .foregroundStyle(palette.warning)
            .background {
              Image(systemName: "circle.fill")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(palette.detailBackground.opacity(0.9))
            }
            .offset(x: 3, y: -2)
            .accessibilityHidden(true)
        }
      }
      .frame(width: 30, height: 30)
      .background(
        isHovering ? palette.secondaryText.opacity(0.2) : .clear,
        in: TerminalChromeMetrics.detailToolbarControlShape
      )
      .accessibilityHidden(true)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(accessibilityLabel ?? "Action")
    .onHover { isHovering = $0 }
  }
}

enum WindowTrafficLightMetrics {
  static let buttonSize: CGFloat = 14
  static let buttonSpacing: CGFloat = 9
  static let edgePadding: CGFloat = 19
  static let glyphSize: CGFloat = 8

  static var clusterWidth: CGFloat {
    edgePadding + buttonSize * 3 + buttonSpacing * 2
  }
}

struct WindowTrafficLights: NSViewRepresentable {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func makeNSView(context: Context) -> WindowTrafficLightsView {
    WindowTrafficLightsView(reduceMotion: reduceMotion)
  }

  func updateNSView(_ nsView: WindowTrafficLightsView, context: Context) {
    nsView.reduceMotion = reduceMotion
  }
}

final class WindowTrafficLightsView: WindowDragSurfaceView {
  var reduceMotion: Bool

  private static let controls: [(type: NSWindow.ButtonType, symbol: String)] = [
    (.closeButton, "xmark"),
    (.miniaturizeButton, "minus"),
    (.zoomButton, "arrow.up.left.and.arrow.down.right"),
  ]

  private var lights: [(button: NSButton, glyph: NSImageView)] = []
  private var isHovered = false

  init(reduceMotion: Bool) {
    self.reduceMotion = reduceMotion
    super.init(frame: .zero)
    addTrackingArea(
      NSTrackingArea(
        rect: .zero,
        options: [.activeInKeyWindow, .inVisibleRect, .mouseEnteredAndExited],
        owner: self
      )
    )
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    configureButtons()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    setHovered(isHovered, animated: false)
  }

  override func layout() {
    super.layout()
    for (index, light) in lights.enumerated() {
      let frame = CGRect(
        x: WindowTrafficLightMetrics.edgePadding
          + CGFloat(index)
          * (WindowTrafficLightMetrics.buttonSize + WindowTrafficLightMetrics.buttonSpacing),
        y: bounds.height
          - WindowTrafficLightMetrics.edgePadding
          - WindowTrafficLightMetrics.buttonSize,
        width: WindowTrafficLightMetrics.buttonSize,
        height: WindowTrafficLightMetrics.buttonSize
      )
      light.button.frame = frame
      light.glyph.frame = frame.insetBy(
        dx: (frame.width - WindowTrafficLightMetrics.glyphSize) / 2,
        dy: (frame.height - WindowTrafficLightMetrics.glyphSize) / 2
      )
    }
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard bounds.contains(point) else { return nil }
    for light in lights where light.button.frame.contains(point) {
      return light.button
    }
    return self
  }

  override func mouseEntered(with event: NSEvent) {
    setHovered(true, animated: true)
  }

  override func mouseExited(with event: NSEvent) {
    setHovered(false, animated: true)
  }

  private func configureButtons() {
    lights.forEach {
      $0.button.removeFromSuperview()
      $0.glyph.removeFromSuperview()
    }
    guard let window else {
      lights = []
      return
    }

    lights = Self.controls.compactMap { control in
      guard let button = NSWindow.standardWindowButton(control.type, for: window.styleMask) else {
        return nil
      }
      let glyph = NSImageView(
        image: NSImage(systemSymbolName: control.symbol, accessibilityDescription: nil) ?? NSImage()
      )
      glyph.contentTintColor = .black.withAlphaComponent(0.55)
      glyph.imageScaling = .scaleProportionallyDown
      glyph.setAccessibilityElement(false)
      return (button, glyph)
    }
    lights.forEach {
      addSubview($0.button)
      addSubview($0.glyph)
    }
    setHovered(false, animated: false)
    needsLayout = true
  }

  private func setHovered(_ hovered: Bool, animated: Bool) {
    isHovered = hovered
    NSAnimationContext.runAnimationGroup { context in
      context.duration = reduceMotion || !animated ? 0 : 0.1
      for light in lights {
        light.button.animator().alphaValue = hovered ? 1 : idleAlpha
        light.glyph.animator().alphaValue = hovered ? 1 : 0
      }
    }
  }

  private var idleAlpha: CGFloat {
    effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? 0.33 : 0.1
  }
}

struct WindowChromeConfigurator: NSViewRepresentable {
  func makeNSView(context: Context) -> WindowChromeConfiguratorView {
    WindowChromeConfiguratorView()
  }

  func updateNSView(_ nsView: WindowChromeConfiguratorView, context: Context) {
    nsView.applyWindowChrome()
  }
}

enum WindowChromeConfiguration {
  static func apply(to window: NSWindow) {
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.titlebarSeparatorStyle = .none
    window.toolbar = nil
    window.isMovableByWindowBackground = false

    if let frameView = window.contentView?.superview,
      let titlebarContainer = firstDescendant(
        named: "NSTitlebarContainerView",
        in: frameView
      )
    {
      titlebarContainer.isHidden = true
    }
  }

  private static func firstDescendant(named className: String, in view: NSView) -> NSView? {
    for subview in view.subviews {
      if String(describing: type(of: subview)) == className {
        return subview
      }
      if let descendant = firstDescendant(named: className, in: subview) {
        return descendant
      }
    }
    return nil
  }
}

final class WindowChromeConfiguratorView: NSView {
  private let maxDeferredApplyCount = 2
  private var configuredWindowID: ObjectIdentifier?
  private var remainingDeferredApplies = 0

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    guard let window else {
      configuredWindowID = nil
      remainingDeferredApplies = 0
      return
    }
    let windowID = ObjectIdentifier(window)
    if configuredWindowID != windowID {
      configuredWindowID = windowID
      remainingDeferredApplies = maxDeferredApplyCount
    }
    applyWindowChrome()
  }

  func applyWindowChrome() {
    guard let window else { return }
    WindowChromeConfiguration.apply(to: window)
    scheduleDeferredApply(for: window)
  }

  private func scheduleDeferredApply(for window: NSWindow) {
    guard remainingDeferredApplies > 0 else { return }
    let windowID = ObjectIdentifier(window)
    remainingDeferredApplies -= 1
    DispatchQueue.main.async { [weak self] in
      guard let self, let window = self.window, ObjectIdentifier(window) == windowID else { return }
      WindowChromeConfiguration.apply(to: window)
      self.scheduleDeferredApply(for: window)
    }
  }
}
