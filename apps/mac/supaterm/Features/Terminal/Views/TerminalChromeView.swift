import AppKit
import SwiftUI

enum TerminalSplitMetrics {
  nonisolated static let resizeHandleWidth: CGFloat = 24
  nonisolated static let minimumPaneSize: CGFloat = 10
  nonisolated static let dividerVisibleSize: CGFloat = 1
  nonisolated static let dividerInvisibleSize: CGFloat = 6
  nonisolated static let dividerHitboxSize: CGFloat = dividerVisibleSize + dividerInvisibleSize

  static func rawFraction(for locationX: CGFloat, totalWidth: CGFloat) -> CGFloat {
    guard totalWidth > 0 else { return 0 }
    return Swift.max(0, Swift.min(locationX / totalWidth, 1))
  }

  static func clampedFraction(
    _ fraction: CGFloat,
    minFraction: CGFloat,
    maxFraction: CGFloat
  ) -> CGFloat {
    Swift.min(Swift.max(fraction, minFraction), maxFraction)
  }

  static func handleFraction(
    dragFraction: CGFloat?,
    committedFraction: CGFloat,
    maxFraction: CGFloat
  ) -> CGFloat {
    guard let dragFraction else { return committedFraction }
    return Swift.max(0, Swift.min(dragFraction, maxFraction))
  }

  static func isCollapsePreviewActive(dragFraction: CGFloat?, minFraction: CGFloat) -> Bool {
    guard let dragFraction else { return false }
    return dragFraction < minFraction
  }

  static func sidebarWidth(for totalWidth: CGFloat, fraction: CGFloat) -> CGFloat {
    let boundedWidth = Swift.max(totalWidth, 0)
    return Swift.max(0, Swift.min(boundedWidth * fraction, boundedWidth))
  }

  static func resizeHandleOffset(for sidebarWidth: CGFloat) -> CGFloat {
    Swift.max(0, sidebarWidth - (resizeHandleWidth / 2))
  }
}

enum TerminalChromeMetrics {
  static let paneInset: CGFloat = 6
  static let paneCornerRadius: CGFloat = 16

  static func nestedCornerRadius(
    inside outerCornerRadius: CGFloat,
    inset: CGFloat = paneInset
  ) -> CGFloat {
    Swift.max(0, outerCornerRadius - inset)
  }
}

enum TerminalCoordinateSpace {
  static let split = "TerminalSplit"
  static let floatingSidebar = "TerminalFloatingSidebar"
}

extension View {
  func terminalPaneChrome(palette: TerminalPalette) -> some View {
    self
      .clipShape(.rect(cornerRadius: TerminalChromeMetrics.paneCornerRadius))
      .overlay {
        RoundedRectangle(cornerRadius: TerminalChromeMetrics.paneCornerRadius, style: .continuous)
          .stroke(palette.detailStroke, lineWidth: 1)
      }
      .padding(TerminalChromeMetrics.paneInset)
  }
}

struct ToolbarIconButton: View {
  let symbol: String
  let palette: TerminalPalette
  let accessibilityLabel: String?
  let showsAttentionIndicator: Bool
  let action: () -> Void

  @State private var isHovering = false

  init(
    symbol: String,
    palette: TerminalPalette,
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
            .foregroundStyle(palette.amber)
            .background {
              Image(systemName: "circle.fill")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(palette.detailBackground.opacity(0.9))
            }
            .offset(x: 5, y: -4)
            .accessibilityHidden(true)
        }
      }
      .frame(width: 30, height: 30)
      .background(
        isHovering ? palette.secondaryText.opacity(0.2) : .clear, in: .rect(cornerRadius: 6)
      )
      .accessibilityHidden(true)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(accessibilityLabel ?? "Action")
    .onHover { isHovering = $0 }
  }
}

enum WindowTrafficLightMetrics {
  static var buttonSize: CGFloat {
    if #available(macOS 26.0, *) {
      14
    } else {
      12
    }
  }

  static let buttonSpacing: CGFloat = 9
  static let leadingPadding: CGFloat = 8
  static let topPadding: CGFloat = 2
  static let symbolSize: CGFloat = 8
}

struct WindowTrafficLights: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var isHovering = false

  var body: some View {
    HStack(spacing: WindowTrafficLightMetrics.buttonSpacing) {
      ForEach(TrafficLight.allCases, id: \.self) { light in
        Button(
          action: { light.perform() },
          label: {
            Circle()
              .fill(light.color)
              .frame(
                width: WindowTrafficLightMetrics.buttonSize,
                height: WindowTrafficLightMetrics.buttonSize
              )
              .overlay {
                if isHovering {
                  Image(systemName: light.symbol)
                    .font(.system(size: WindowTrafficLightMetrics.symbolSize, weight: .black))
                    .foregroundStyle(.black.opacity(0.55))
                    .accessibilityHidden(true)
                }
              }
          }
        )
        .buttonStyle(.plain)
        .accessibilityLabel(light.accessibilityLabel)
      }
    }
    .padding(.leading, WindowTrafficLightMetrics.leadingPadding)
    .padding(.top, WindowTrafficLightMetrics.topPadding)
    .onHover { hovering in
      TerminalMotion.animate(.easeInOut(duration: 0.1), reduceMotion: reduceMotion) {
        isHovering = hovering
      }
    }
  }
}

private enum TrafficLight: CaseIterable {
  case close
  case minimize
  case zoom

  var color: Color {
    switch self {
    case .close:
      Color(red: 1, green: 0.37, blue: 0.34)
    case .minimize:
      Color(red: 1, green: 0.74, blue: 0.18)
    case .zoom:
      Color(red: 0.16, green: 0.8, blue: 0.33)
    }
  }

  var symbol: String {
    switch self {
    case .close:
      "xmark"
    case .minimize:
      "minus"
    case .zoom:
      "plus"
    }
  }

  var accessibilityLabel: String {
    switch self {
    case .close:
      "Close window"
    case .minimize:
      "Minimize window"
    case .zoom:
      "Enter full screen"
    }
  }

  func perform() {
    guard let window = NSApp.keyWindow else { return }

    switch self {
    case .close:
      window.performClose(nil)
    case .minimize:
      window.performMiniaturize(nil)
    case .zoom:
      window.toggleFullScreen(nil)
    }
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
    window.standardWindowButton(.closeButton)?.isHidden = true
    window.standardWindowButton(.miniaturizeButton)?.isHidden = true
    window.standardWindowButton(.zoomButton)?.isHidden = true

    if let themeFrame = window.contentView?.superview,
      let titlebarContainer = firstDescendant(
        named: "NSTitlebarContainerView",
        in: themeFrame
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

struct TerminalPalette {
  let windowBackgroundTint: Color
  let detailBackground: Color
  let detailStroke: Color
  let dialogOuterBackground: Color
  let dialogInnerBackground: Color
  let dialogBorder: Color
  let dialogSecondaryFill: Color
  let dialogSecondaryHoverFill: Color
  let dialogDestructiveFill: Color
  let dialogDestructiveHoverFill: Color
  let dialogPrimaryText: Color
  let pillFill: Color
  let rowFill: Color
  let clearFill: Color
  let selectedFill: Color
  let selectionStroke: Color
  let primaryText: Color
  let secondaryText: Color
  let selectedText: Color
  let selectedIcon: Color
  let attention: Color
  let shadow: Color
  let amber: Color
  let mint: Color
  let sky: Color
  let coral: Color
  let violet: Color
  let slate: Color

  init(colorScheme: ColorScheme) {
    if colorScheme == .dark {
      windowBackgroundTint = Color(red: 0.078, green: 0.078, blue: 0.078, opacity: 0.3)
      detailBackground = Color(red: 0.15, green: 0.14, blue: 0.14)
      detailStroke = Color.white.opacity(0.08)
      dialogOuterBackground = Color(red: 0.1412, green: 0.1412, blue: 0.1412)
      dialogInnerBackground = Color(red: 0.1137, green: 0.1137, blue: 0.1137)
      dialogBorder = Color(nsColor: .separatorColor)
      dialogSecondaryFill = Color.white.opacity(0.136)
      dialogSecondaryHoverFill = Color.white.opacity(0.085)
      dialogDestructiveFill = Color(red: 1, green: 0.4118, blue: 0.4118)
      dialogDestructiveHoverFill = Color(red: 1, green: 0.4118, blue: 0.4118).opacity(0.85)
      dialogPrimaryText = .white
      pillFill = Color.white.opacity(0.08)
      rowFill = Color.white.opacity(0.06)
      clearFill = Color.white.opacity(0.03)
      selectedFill = Color(red: 0.93, green: 0.93, blue: 0.95)
      selectionStroke = Color.black.opacity(0.14)
      primaryText = Color.white.opacity(0.94)
      secondaryText = Color.white.opacity(0.58)
      selectedText = Color.black.opacity(0.82)
      selectedIcon = Color.black.opacity(0.82)
      shadow = .black.opacity(0.28)
    } else {
      windowBackgroundTint = Color(red: 0.953, green: 0.898, blue: 0.839, opacity: 0.3)
      detailBackground = Color(red: 0.985, green: 0.975, blue: 0.96)
      detailStroke = Color.black.opacity(0.06)
      dialogOuterBackground = .white
      dialogInnerBackground = Color.black.opacity(0.1)
      dialogBorder = Color(nsColor: .separatorColor)
      dialogSecondaryFill = Color.black.opacity(0.08)
      dialogSecondaryHoverFill = Color.black.opacity(0.05)
      dialogDestructiveFill = Color(red: 1, green: 0.4118, blue: 0.4118)
      dialogDestructiveHoverFill = Color(red: 1, green: 0.4118, blue: 0.4118).opacity(0.85)
      dialogPrimaryText = .black
      pillFill = Color.black.opacity(0.07)
      rowFill = Color.black.opacity(0.05)
      clearFill = Color.black.opacity(0.02)
      selectedFill = Color(red: 0.12, green: 0.12, blue: 0.12)
      selectionStroke = Color.white.opacity(0.08)
      primaryText = Color.black.opacity(0.86)
      secondaryText = Color.black.opacity(0.48)
      selectedText = .white
      selectedIcon = .white
      shadow = .black.opacity(0.08)
    }

    attention = Color(nsColor: .systemOrange)
    amber = Color(red: 0.89, green: 0.64, blue: 0.28)
    mint = Color(red: 0.3, green: 0.72, blue: 0.58)
    sky = Color(red: 0.31, green: 0.59, blue: 0.94)
    coral = Color(red: 0.9, green: 0.43, blue: 0.38)
    violet = Color(red: 0.57, green: 0.45, blue: 0.86)
    slate = Color(red: 0.38, green: 0.44, blue: 0.56)
  }

  func fill(for tone: TerminalTone) -> Color {
    color(for: tone).opacity(0.85)
  }

  private func color(for tone: TerminalTone) -> Color {
    switch tone {
    case .amber:
      amber
    case .coral:
      coral
    case .mint:
      mint
    case .sky:
      sky
    case .slate:
      slate
    case .violet:
      violet
    }
  }
}
