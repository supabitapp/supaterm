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
  nonisolated static let paneInset: CGFloat = 6
  static let paneCornerRadius: CGFloat = 12
  nonisolated static let detailToolbarHeight: CGFloat = 36
  static var detailToolbarControlShape: ConcentricRectangle {
    ConcentricRectangle(corners: .concentric(minimum: 6))
  }
  static var paneShape: RoundedRectangle {
    RoundedRectangle(cornerRadius: paneCornerRadius, style: .continuous)
  }
}

enum TerminalFloatingSidebarShellMetrics {
  static let borderWidth: CGFloat = 1
  static let contentInset = TerminalChromeMetrics.paneInset
  static let cornerRadius: CGFloat = 16
  static let shadowRadius: CGFloat = 16
  static let shadowYOffset: CGFloat = 6
}

enum TerminalCoordinateSpace {
  static let split = "TerminalSplit"
  static let floatingSidebar = "TerminalFloatingSidebar"
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
        if isFloating {
          ChromeBackgroundView(
            palette: palette,
            material: .popover,
            blendingMode: .withinWindow
          )
        }
      }
      .mask(alignment: .leading) {
        surfaceShape
          .padding(.trailing, isFloating ? 0 : -TerminalChromeMetrics.paneInset)
      }
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
      .clipShape(TerminalChromeMetrics.paneShape)
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

  static var clusterWidth: CGFloat {
    edgePadding + buttonSize * 3 + buttonSpacing * 2
  }
}

struct WindowTrafficLights: NSViewRepresentable {
  func makeNSView(context: Context) -> WindowTrafficLightsView {
    WindowTrafficLightsView()
  }

  func updateNSView(_ nsView: WindowTrafficLightsView, context: Context) {}
}

final class WindowTrafficLightsView: WindowDragSurfaceView {
  private static let buttonTypes: [NSWindow.ButtonType] = [
    .closeButton,
    .miniaturizeButton,
    .zoomButton,
  ]

  private var buttons: [NSButton] = []
  private let inactiveAppearanceView = NSImageView()
  private var isHovered = false

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    inactiveAppearanceView.imageScaling = .scaleAxesIndependently
    inactiveAppearanceView.isHidden = true
    inactiveAppearanceView.setAccessibilityElement(false)
    addSubview(inactiveAppearanceView)
    addTrackingArea(
      NSTrackingArea(
        rect: .zero,
        options: [.activeInKeyWindow, .inVisibleRect, .mouseEnteredAndExited],
        owner: self
      )
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(applicationWillResignActive(_:)),
      name: NSApplication.willResignActiveNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(applicationDidBecomeActive(_:)),
      name: NSApplication.didBecomeActiveNotification,
      object: nil
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
    updateAppearance()
  }

  override func layout() {
    super.layout()
    inactiveAppearanceView.frame = bounds
    for (index, button) in buttons.enumerated() {
      button.frame = CGRect(
        x: WindowTrafficLightMetrics.edgePadding
          + CGFloat(index)
          * (WindowTrafficLightMetrics.buttonSize + WindowTrafficLightMetrics.buttonSpacing),
        y: bounds.height
          - WindowTrafficLightMetrics.edgePadding
          - WindowTrafficLightMetrics.buttonSize,
        width: WindowTrafficLightMetrics.buttonSize,
        height: WindowTrafficLightMetrics.buttonSize
      )
    }
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard bounds.contains(point) else { return nil }
    for button in buttons where button.frame.contains(point) {
      return button
    }
    return self
  }

  override func mouseEntered(with event: NSEvent) {
    setHovered(true)
  }

  override func mouseExited(with event: NSEvent) {
    setHovered(false)
  }

  @objc(_mouseInGroup:)
  func mouseInGroup(_: Any?) -> Bool {
    isHovered
  }

  func setApplicationActive(_ isActive: Bool) {
    if isActive {
      inactiveAppearanceView.isHidden = true
      buttons.forEach { $0.alphaValue = 1 }
      return
    }

    setHovered(false)
    captureForegroundAppearance()
    guard inactiveAppearanceView.image != nil else { return }
    inactiveAppearanceView.isHidden = false
    buttons.forEach { $0.alphaValue = 0 }
  }

  private func configureButtons() {
    buttons.forEach { $0.removeFromSuperview() }
    guard let window else {
      buttons = []
      inactiveAppearanceView.image = nil
      inactiveAppearanceView.isHidden = true
      return
    }

    buttons = Self.buttonTypes.compactMap {
      NSWindow.standardWindowButton($0, for: window.styleMask)
    }
    buttons.forEach(addSubview)
    addSubview(inactiveAppearanceView, positioned: .above, relativeTo: nil)
    updateAppearance()
    needsLayout = true
  }

  private func setHovered(_ hovered: Bool) {
    isHovered = hovered
    updateAppearance()
    for button in buttons {
      button.needsDisplay = true
      button.needsLayout = true
    }
  }

  private func updateAppearance() {
    alphaValue = isHovered ? 1 : idleAlpha
  }

  private func captureForegroundAppearance() {
    inactiveAppearanceView.isHidden = true
    buttons.forEach { $0.alphaValue = 1 }
    layoutSubtreeIfNeeded()
    let currentAlpha = alphaValue
    alphaValue = 1
    inactiveAppearanceView.image = NSImage(data: dataWithPDF(inside: bounds))
    alphaValue = currentAlpha
  }

  @objc private func applicationWillResignActive(_: Notification) {
    setApplicationActive(false)
  }

  @objc private func applicationDidBecomeActive(_: Notification) {
    setApplicationActive(true)
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
