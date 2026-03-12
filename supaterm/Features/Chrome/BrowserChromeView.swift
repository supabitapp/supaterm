import AppKit
import SwiftUI

struct BrowserChromeView: View {
  @Environment(\.colorScheme) private var colorScheme
  @State private var isSidebarCollapsed = false
  @State private var isFloatingSidebarVisible = false
  @State private var sidebarFraction: CGFloat = 0.2
  @State private var isShowingQuitConfirmation = false
  @State private var window: NSWindow?

  private let minSidebarFraction: CGFloat = 0.16
  private let maxSidebarFraction: CGFloat = 0.30

  private var palette: BrowserChromePalette {
    BrowserChromePalette(colorScheme: colorScheme)
  }

  var body: some View {
    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        BrowserChromeSplitView(
          palette: palette,
          totalWidth: geometry.size.width,
          isSidebarCollapsed: isSidebarCollapsed,
          sidebarFraction: $sidebarFraction,
          minFraction: minSidebarFraction,
          maxFraction: maxSidebarFraction,
          onToggleSidebar: toggleSidebar,
          onHide: collapseSidebar,
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)

        if isSidebarCollapsed {
          FloatingSidebarOverlay(
            palette: palette,
            totalWidth: geometry.size.width,
            sidebarFraction: $sidebarFraction,
            isVisible: $isFloatingSidebarVisible,
            minFraction: minSidebarFraction,
            maxFraction: maxSidebarFraction,
          )
        }
      }
    }
    .frame(minWidth: 1_080, minHeight: 720)
    .background(palette.windowBackgroundTint)
    .background {
      BlurEffectView(material: .underWindowBackground, blendingMode: .behindWindow)
        .ignoresSafeArea()
    }
    .overlay {
      WindowChromeConfigurator()
        .frame(width: 0, height: 0)
    }
    .background(WindowReader(window: $window))
    .ignoresSafeArea()
    .onReceive(NotificationCenter.default.publisher(for: .toggleSidebar)) { _ in
      toggleSidebar()
    }
    .onReceive(NotificationCenter.default.publisher(for: .quitRequested)) { notification in
      guard let targetWindow = notification.object as? NSWindow else { return }
      guard targetWindow === (window ?? NSApp.keyWindow) else { return }
      guard window != nil else {
        NSApp.reply(toApplicationShouldTerminate: true)
        return
      }
      isShowingQuitConfirmation = true
    }
    .overlay {
      if isShowingQuitConfirmation {
        QuitConfirmationOverlay(
          palette: palette,
          onConfirm: confirmQuit,
          onCancel: cancelQuit,
        )
      }
    }
    .animation(.spring(response: 0.2, dampingFraction: 1.0), value: isSidebarCollapsed)
    .animation(.easeOut(duration: 0.1), value: isFloatingSidebarVisible)
    .animation(.spring(response: 0.3, dampingFraction: 0.82), value: isShowingQuitConfirmation)
  }

  private func toggleSidebar() {
    isFloatingSidebarVisible = false
    withAnimation(.spring(response: 0.2, dampingFraction: 1.0)) {
      isSidebarCollapsed.toggle()
    }
  }

  private func collapseSidebar() {
    isFloatingSidebarVisible = false
    withAnimation(.spring(response: 0.2, dampingFraction: 1.0)) {
      isSidebarCollapsed = true
    }
  }

  private func confirmQuit() {
    isShowingQuitConfirmation = false
    NSApp.reply(toApplicationShouldTerminate: true)
  }

  private func cancelQuit() {
    isShowingQuitConfirmation = false
    NSApp.reply(toApplicationShouldTerminate: false)
  }
}

enum BrowserChromeSplitMetrics {
  static let resizeHandleWidth: CGFloat = 14

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

  static func sidebarWidth(for totalWidth: CGFloat, fraction: CGFloat) -> CGFloat {
    let boundedWidth = Swift.max(totalWidth, 0)
    return Swift.max(0, Swift.min(boundedWidth * fraction, boundedWidth))
  }

  static func resizeHandleOffset(for sidebarWidth: CGFloat) -> CGFloat {
    Swift.max(0, sidebarWidth - (resizeHandleWidth / 2))
  }
}

private enum BrowserChromeCoordinateSpace {
  static let split = "BrowserChromeSplit"
  static let floatingSidebar = "BrowserChromeFloatingSidebar"
}

private struct BrowserChromeSplitView: View {
  let palette: BrowserChromePalette
  let totalWidth: CGFloat
  let isSidebarCollapsed: Bool
  @Binding var sidebarFraction: CGFloat
  let minFraction: CGFloat
  let maxFraction: CGFloat
  let onToggleSidebar: () -> Void
  let onHide: () -> Void
  @State private var dragFraction: CGFloat?

  var body: some View {
    let effectiveFraction = BrowserChromeSplitMetrics.clampedFraction(
      dragFraction ?? sidebarFraction,
      minFraction: minFraction,
      maxFraction: maxFraction,
    )
    let currentSidebarWidth = BrowserChromeSplitMetrics.sidebarWidth(
      for: totalWidth,
      fraction: effectiveFraction,
    )
    let visibleSidebarWidth = isSidebarCollapsed ? 0 : currentSidebarWidth

    ZStack(alignment: .leading) {
      HStack(spacing: 0) {
        BrowserSidebarView(palette: palette)
          .frame(width: currentSidebarWidth)
          .frame(maxHeight: .infinity)
          .offset(x: isSidebarCollapsed ? -(currentSidebarWidth + 12) : 0)
          .frame(width: visibleSidebarWidth, alignment: .leading)
          .clipped()
          .allowsHitTesting(!isSidebarCollapsed)

        BrowserDetailView(
          palette: palette,
          isSidebarCollapsed: isSidebarCollapsed,
          onToggleSidebar: onToggleSidebar,
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }

      if !isSidebarCollapsed {
        SidebarResizeHandle(
          coordinateSpaceName: BrowserChromeCoordinateSpace.split,
          totalWidth: totalWidth,
          sidebarFraction: $sidebarFraction,
          dragFraction: $dragFraction,
          minFraction: minFraction,
          maxFraction: maxFraction,
          onHide: onHide,
        )
        .offset(x: BrowserChromeSplitMetrics.resizeHandleOffset(for: currentSidebarWidth))
      }
    }
    .coordinateSpace(name: BrowserChromeCoordinateSpace.split)
  }
}

private struct QuitConfirmationOverlay: View {
  let palette: BrowserChromePalette
  let onConfirm: () -> Void
  let onCancel: () -> Void

  private static let transition: AnyTransition = .asymmetric(
    insertion: .offset(y: -16).combined(with: .scale(scale: 0.96)).combined(with: .opacity),
    removal: .offset(y: -16).combined(with: .scale(scale: 0.96)).combined(with: .opacity),
  )

  var body: some View {
    ZStack {
      Button(action: onCancel) {
        Color.black.opacity(0.4)
          .ignoresSafeArea()
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Cancel quit confirmation")

      VStack(alignment: .leading, spacing: 0) {
        VStack(alignment: .leading, spacing: 0) {
          QuitConfirmationIcon()
            .padding(.bottom, 16)

          Text("Quit Supaterm?")
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(palette.primaryText)

          Text("Are you sure you want to quit?")
            .font(.system(size: 13))
            .foregroundStyle(palette.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 4)

          Spacer()

          HStack {
            DialogActionButton(
              palette: palette,
              title: "Cancel",
              style: .secondary,
              shortcut: .text("esc"),
              action: onCancel,
            )
            .keyboardShortcut(.cancelAction)

            Spacer()

            DialogActionButton(
              palette: palette,
              title: "Quit",
              style: .destructive,
              shortcut: .symbol("return"),
              action: onConfirm,
            )
            .keyboardShortcut(.defaultAction)
          }
        }
        .frame(width: 400, height: 220)
        .padding(12)
        .background(palette.dialogInnerBackground, in: .rect(cornerRadius: 11))
        .overlay {
          RoundedRectangle(cornerRadius: 11, style: .continuous)
            .stroke(palette.dialogBorder, lineWidth: 0.5)
        }
      }
      .padding(3)
      .background(palette.dialogOuterBackground, in: .rect(cornerRadius: 14))
      .shadow(color: .black.opacity(0.25), radius: 20, y: 8)
      .transition(Self.transition)
    }
  }
}

private struct QuitConfirmationIcon: View {
  var body: some View {
    Image(nsImage: NSApp.applicationIconImage)
      .resizable()
      .interpolation(.high)
      .antialiased(true)
      .scaledToFit()
      .frame(width: 46, height: 46)
      .clipShape(.rect(cornerRadius: 12))
      .accessibilityHidden(true)
  }
}

private struct DialogActionButton: View {
  enum Style {
    case secondary
    case destructive
  }

  enum Shortcut {
    case symbol(String)
    case text(String)
  }

  let palette: BrowserChromePalette
  let title: String
  let style: Style
  let shortcut: Shortcut
  let action: () -> Void
  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Text(title)
          .font(.system(size: 13, weight: .medium))

        Spacer()
          .frame(width: 3)

        Group {
          switch shortcut {
          case .symbol(let name):
            Image(systemName: name)
              .accessibilityHidden(true)
          case .text(let value):
            Text(value.lowercased()).opacity(0.5)
          }
        }
        .font(.system(size: 10, weight: .semibold))
        .frame(minWidth: 18, minHeight: 18)
        .padding(.horizontal, shortcutPadding)
        .background(foreground.opacity(shortcutOpacity), in: .rect(cornerRadius: 4))
      }
      .foregroundStyle(foreground)
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      .background(background, in: .rect(cornerRadius: 10))
    }
    .buttonStyle(.plain)
    .onHover { isHovering = $0 }
  }

  private var background: Color {
    switch style {
    case .secondary:
      isHovering ? palette.dialogSecondaryHoverFill : palette.dialogSecondaryFill
    case .destructive:
      isHovering ? palette.dialogDestructiveHoverFill : palette.dialogDestructiveFill
    }
  }

  private var foreground: Color {
    switch style {
    case .secondary:
      palette.dialogPrimaryText
    case .destructive:
      .white
    }
  }

  private var shortcutOpacity: Double {
    switch style {
    case .secondary:
      0.07
    case .destructive:
      0.15
    }
  }

  private var shortcutPadding: CGFloat {
    switch shortcut {
    case .symbol:
      0
    case .text(let value):
      value.count == 1 ? 0 : 4
    }
  }
}

private struct BrowserSidebarView: View {
  let palette: BrowserChromePalette

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      SidebarHeaderView(palette: palette)
      SidebarContainerView(palette: palette)
      SidebarFooterView(palette: palette)
    }
    .padding(.horizontal, 10)
    .padding(.top, 8)
    .padding(.bottom, 10)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct SidebarContainerView: View {
  let palette: BrowserChromePalette

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      SidebarAddressView(palette: palette)
      FavoriteGridView(palette: palette)

      ScrollView(.vertical, showsIndicators: false) {
        VStack(alignment: .leading, spacing: 16) {
          SidebarSectionView(title: "Pinned", palette: palette) {
            ForEach(BrowserChromeSample.pinnedTabs) { tab in
              SidebarTabRow(tab: tab, palette: palette)
            }
          }

          SidebarSectionView(title: "Tabs", palette: palette) {
            NewTabButton(palette: palette)

            ForEach(BrowserChromeSample.tabs) { tab in
              SidebarTabRow(tab: tab, palette: palette)
            }
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .gesture(WindowDragGesture())
  }
}

private struct FloatingSidebarOverlay: View {
  let palette: BrowserChromePalette
  let totalWidth: CGFloat
  @Binding var sidebarFraction: CGFloat
  @Binding var isVisible: Bool
  let minFraction: CGFloat
  let maxFraction: CGFloat
  @State private var dragFraction: CGFloat?

  var body: some View {
    let effectiveFraction = BrowserChromeSplitMetrics.clampedFraction(
      dragFraction ?? sidebarFraction,
      minFraction: minFraction,
      maxFraction: maxFraction,
    )
    let floatingWidth = BrowserChromeSplitMetrics.sidebarWidth(
      for: totalWidth,
      fraction: effectiveFraction,
    )

    ZStack(alignment: .leading) {
      if isVisible {
        FloatingSidebarView(palette: palette, width: floatingWidth)
          .frame(width: floatingWidth)
          .transition(.move(edge: .leading))
          .zIndex(1)
      }

      HStack(spacing: 0) {
        hoverStrip(width: isVisible ? floatingWidth : 10)
        Spacer(minLength: 0)
      }

      if isVisible {
        SidebarResizeHandle(
          coordinateSpaceName: BrowserChromeCoordinateSpace.floatingSidebar,
          totalWidth: totalWidth,
          sidebarFraction: $sidebarFraction,
          dragFraction: $dragFraction,
          minFraction: minFraction,
          maxFraction: maxFraction,
        )
        .offset(x: BrowserChromeSplitMetrics.resizeHandleOffset(for: floatingWidth))
        .zIndex(2)
      }
    }
    .coordinateSpace(name: BrowserChromeCoordinateSpace.floatingSidebar)
  }

  private func hoverStrip(width: CGFloat) -> some View {
    Color.clear
      .frame(width: width)
      .overlay {
        GlobalMouseTrackingArea(
          mouseEntered: $isVisible,
          edge: .left,
          padding: 40,
          slack: 8,
        )
      }
  }
}

private struct SidebarResizeHandle: View {
  let coordinateSpaceName: String
  let totalWidth: CGFloat
  @Binding var sidebarFraction: CGFloat
  @Binding var dragFraction: CGFloat?
  let minFraction: CGFloat
  let maxFraction: CGFloat
  var onHide: (() -> Void)?

  var body: some View {
    Rectangle()
      .fill(Color.clear)
      .frame(width: BrowserChromeSplitMetrics.resizeHandleWidth)
      .contentShape(Rectangle())
      .onHover { hovering in
        if hovering {
          NSCursor.resizeLeftRight.push()
        } else {
          NSCursor.pop()
        }
      }
      .gesture(
        DragGesture(minimumDistance: 0, coordinateSpace: .named(coordinateSpaceName))
          .onChanged { value in
            let rawFraction = BrowserChromeSplitMetrics.rawFraction(
              for: value.location.x,
              totalWidth: totalWidth,
            )
            dragFraction = BrowserChromeSplitMetrics.clampedFraction(
              rawFraction,
              minFraction: minFraction,
              maxFraction: maxFraction,
            )
          }
          .onEnded { value in
            let rawFraction = BrowserChromeSplitMetrics.rawFraction(
              for: value.location.x,
              totalWidth: totalWidth,
            )
            if let onHide, rawFraction < minFraction {
              onHide()
            } else {
              sidebarFraction = BrowserChromeSplitMetrics.clampedFraction(
                rawFraction,
                minFraction: minFraction,
                maxFraction: maxFraction,
              )
            }
            dragFraction = nil
          }
      )
  }
}

private struct FloatingSidebarView: View {
  let palette: BrowserChromePalette
  let width: CGFloat

  var body: some View {
    BrowserSidebarView(palette: palette)
      .frame(width: width)
      .background(palette.windowBackgroundTint)
      .background {
        BlurEffectView(material: .popover, blendingMode: .withinWindow)
      }
      .clipShape(.rect(cornerRadius: 16))
      .overlay {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
          .stroke(palette.detailStroke, lineWidth: 1)
      }
      .shadow(color: palette.shadow, radius: 16, x: 0, y: 6)
      .padding(6)
  }
}

private struct SidebarHeaderView: View {
  let palette: BrowserChromePalette

  var body: some View {
    HStack(spacing: 12) {
      WindowTrafficLights()

      Spacer(minLength: 0)

      HStack(spacing: 4) {
        ChromeIconButton(symbol: "chevron.left", palette: palette)
        ChromeIconButton(symbol: "chevron.right", palette: palette)
        ChromeIconButton(symbol: "arrow.clockwise", palette: palette)
      }
    }
    .frame(height: 30)
  }
}

private struct SidebarAddressView: View {
  let palette: BrowserChromePalette

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: "lock.fill")
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(palette.secondaryText)
        .frame(width: 16, height: 16)
        .accessibilityHidden(true)

      Text("supaterm.app/workspaces/browser-shell")
        .font(.system(size: 13))
        .foregroundStyle(palette.primaryText)
        .lineLimit(1)

      Spacer(minLength: 0)
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .background(palette.pillFill, in: .rect(cornerRadius: 10))
  }
}

private struct FavoriteGridView: View {
  let palette: BrowserChromePalette

  private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

  var body: some View {
    LazyVGrid(columns: columns, spacing: 10) {
      ForEach(BrowserChromeSample.favorites) { favorite in
        FavoriteTileView(favorite: favorite, palette: palette)
      }
    }
  }
}

private struct FavoriteTileView: View {
  let favorite: FavoriteTile
  let palette: BrowserChromePalette

  var body: some View {
    RoundedRectangle(cornerRadius: 10, style: .continuous)
      .fill(palette.fill(for: favorite.tone))
      .frame(height: 48)
      .overlay {
        Image(systemName: favorite.symbol)
          .font(.system(size: 16, weight: .semibold))
          .foregroundStyle(favorite.isSelected ? palette.selectedIcon : palette.primaryText)
          .accessibilityHidden(true)
      }
      .overlay {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
          .stroke(
            favorite.isSelected ? palette.selectionStroke : palette.tileStroke,
            lineWidth: 1,
          )
      }
      .accessibilityLabel(favorite.label)
  }
}

private struct SidebarSectionView<Content: View>: View {
  let title: String
  let palette: BrowserChromePalette
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.secondaryText)

      content
    }
  }
}

private struct NewTabButton: View {
  let palette: BrowserChromePalette

  var body: some View {
    Button(
      action: {},
      label: {
        HStack(spacing: 10) {
          Image(systemName: "plus")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(palette.secondaryText)
            .frame(width: 16, height: 16)
            .accessibilityHidden(true)

          Text("New Tab")
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(palette.primaryText)

          Spacer(minLength: 0)
        }
        .padding(10)
        .background(palette.rowFill, in: .rect(cornerRadius: 10))
      }
    )
    .buttonStyle(.plain)
  }
}

private struct SidebarTabRow: View {
  let tab: SidebarTab
  let palette: BrowserChromePalette

  var body: some View {
    Button(
      action: {},
      label: {
        HStack(spacing: 10) {
          RoundedRectangle(cornerRadius: 5, style: .continuous)
            .fill(palette.fill(for: tab.tone))
            .frame(width: 16, height: 16)
            .overlay {
              Image(systemName: tab.symbol)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(tab.isSelected ? palette.selectedIcon : palette.primaryText.opacity(0.9))
                .accessibilityHidden(true)
            }

          Text(tab.title)
            .font(.system(size: 13, weight: tab.isSelected ? .semibold : .regular))
            .foregroundStyle(tab.isSelected ? palette.selectedText : palette.primaryText)
            .lineLimit(1)

          Spacer(minLength: 0)

          if tab.showsClose {
            Image(systemName: "xmark")
              .font(.system(size: 10, weight: .bold))
              .foregroundStyle(tab.isSelected ? palette.selectedText.opacity(0.9) : palette.secondaryText)
              .accessibilityHidden(true)
          }
        }
        .padding(10)
        .background(background, in: .rect(cornerRadius: 10))
        .overlay {
          RoundedRectangle(cornerRadius: 10, style: .continuous)
            .stroke(stroke, lineWidth: 1)
        }
      }
    )
    .buttonStyle(.plain)
  }

  private var background: Color {
    tab.isSelected ? palette.selectedFill : palette.clearFill
  }

  private var stroke: Color {
    tab.isSelected ? palette.selectionStroke : .clear
  }
}

private struct SidebarFooterView: View {
  let palette: BrowserChromePalette

  var body: some View {
    HStack {
      FooterCircleButton(symbol: "arrow.down", palette: palette)

      Spacer(minLength: 16)

      HStack(spacing: 4) {
        ForEach(BrowserChromeSample.spaces) { space in
          SpaceButton(space: space, palette: palette)
        }
      }

      Spacer(minLength: 16)

      FooterCircleButton(symbol: "plus", palette: palette)
    }
    .frame(height: 30)
  }
}

private struct SpaceButton: View {
  let space: WorkspaceChip
  let palette: BrowserChromePalette

  var body: some View {
    Button(
      action: {},
      label: {
        Text(space.label)
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .foregroundStyle(space.isSelected ? palette.selectedText : palette.secondaryText)
          .frame(width: 28, height: 28)
          .background(space.isSelected ? palette.selectedFill : palette.clearFill, in: .rect(cornerRadius: 8))
      }
    )
    .buttonStyle(.plain)
    .accessibilityLabel("Workspace \(space.label)")
  }
}

private struct FooterCircleButton: View {
  let symbol: String
  let palette: BrowserChromePalette

  var body: some View {
    Button(
      action: {},
      label: {
        Image(systemName: symbol)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(palette.secondaryText)
          .frame(width: 28, height: 28)
          .background(palette.rowFill, in: Circle())
          .accessibilityHidden(true)
      }
    )
    .buttonStyle(.plain)
    .accessibilityLabel(symbol == "plus" ? "Add workspace" : "Downloads")
  }
}

private struct BrowserDetailView: View {
  let palette: BrowserChromePalette
  let isSidebarCollapsed: Bool
  let onToggleSidebar: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      DetailToolbarView(
        palette: palette,
        isSidebarCollapsed: isSidebarCollapsed,
        onToggleSidebar: onToggleSidebar,
      )

      ScrollView(.vertical, showsIndicators: false) {
        VStack(spacing: 18) {
          DetailHeroCard(panel: BrowserChromeSample.detailPanels[0], palette: palette)

          HStack(spacing: 18) {
            ForEach(BrowserChromeSample.detailPanels.dropFirst().prefix(2)) { panel in
              DetailPanelCard(panel: panel, palette: palette)
            }
          }

          DetailShelfView(palette: palette)
        }
        .padding(24)
      }
    }
    .background(palette.detailBackground, in: .rect(cornerRadius: 20))
    .overlay {
      RoundedRectangle(cornerRadius: 20, style: .continuous)
        .stroke(palette.detailStroke, lineWidth: 1)
    }
    .shadow(color: palette.shadow, radius: 16, x: 0, y: 6)
    .padding(.top, 6)
    .padding(.leading, isSidebarCollapsed ? 6 : 0)
    .padding(.trailing, 6)
    .padding(.bottom, 6)
  }
}

private struct DetailToolbarView: View {
  let palette: BrowserChromePalette
  let isSidebarCollapsed: Bool
  let onToggleSidebar: () -> Void

  var body: some View {
    HStack(spacing: 4) {
      HStack(spacing: 4) {
        ChromeIconButton(
          symbol: "sidebar.left",
          palette: palette,
          accessibilityLabel: isSidebarCollapsed ? "Show sidebar" : "Hide sidebar",
          action: onToggleSidebar,
        )
        ChromeIconButton(symbol: "arrow.trianglehead.2.clockwise.rotate.90", palette: palette)
      }

      HStack(spacing: 8) {
        Image(systemName: "globe")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(palette.secondaryText)
          .accessibilityHidden(true)

        Text("Workspace shell preview")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(palette.primaryText)

        Spacer(minLength: 0)

        Image(systemName: "wave.3.right")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(palette.secondaryText)
          .accessibilityHidden(true)
      }
      .frame(height: 30)
      .padding(.horizontal, 8)
      .background(
        RoundedRectangle(cornerRadius: 6, style: .continuous)
          .fill(palette.pillFill)
      )

      HStack(spacing: 4) {
        ChromeIconButton(symbol: "person.crop.circle", palette: palette)
        ChromeIconButton(symbol: "ellipsis", palette: palette)
      }
    }
    .padding(4)
  }
}

private struct DetailHeroCard: View {
  let panel: DetailPanel
  let palette: BrowserChromePalette

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      HStack {
        Text(panel.eyebrow)
          .font(.system(size: 11, weight: .bold, design: .rounded))
          .kerning(0.8)
          .foregroundStyle(Color.white.opacity(0.85))

        Spacer(minLength: 0)

        Circle()
          .fill(Color.white.opacity(0.28))
          .frame(width: 10, height: 10)
      }

      Spacer(minLength: 0)

      Text(panel.title)
        .font(.system(size: 28, weight: .semibold, design: .rounded))
        .foregroundStyle(Color.white)

      Text(panel.subtitle)
        .font(.system(size: 14, weight: .medium))
        .foregroundStyle(Color.white.opacity(0.82))

      HStack(spacing: 8) {
        ForEach(0..<3, id: \.self) { index in
          RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(Color.white.opacity(0.14 + Double(index) * 0.08))
            .frame(height: 56)
        }
      }
    }
    .padding(24)
    .frame(maxWidth: .infinity, minHeight: 260, alignment: .topLeading)
    .background(panel.gradient, in: .rect(cornerRadius: 24))
  }
}

private struct DetailPanelCard: View {
  let panel: DetailPanel
  let palette: BrowserChromePalette

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text(panel.eyebrow)
          .font(.system(size: 10, weight: .bold, design: .rounded))
          .foregroundStyle(Color.white.opacity(0.8))

        Spacer(minLength: 0)

        RoundedRectangle(cornerRadius: 999, style: .continuous)
          .fill(Color.white.opacity(0.18))
          .frame(width: 44, height: 8)
      }

      Spacer(minLength: 0)

      Text(panel.title)
        .font(.system(size: 18, weight: .semibold, design: .rounded))
        .foregroundStyle(Color.white)

      Text(panel.subtitle)
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(Color.white.opacity(0.82))
        .lineLimit(2)
    }
    .padding(20)
    .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
    .background(panel.gradient, in: .rect(cornerRadius: 20))
  }
}

private struct DetailShelfView: View {
  let palette: BrowserChromePalette

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("More Views")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.secondaryText)

      HStack(spacing: 12) {
        ForEach(BrowserChromeSample.shelfPanels) { panel in
          VStack(alignment: .leading, spacing: 10) {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
              .fill(panel.gradient)
              .frame(height: 88)

            Text(panel.title)
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(palette.primaryText)

            Text(panel.subtitle)
              .font(.system(size: 12))
              .foregroundStyle(palette.secondaryText)
              .lineLimit(2)
          }
          .padding(14)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(palette.panelFill, in: .rect(cornerRadius: 18))
        }
      }
    }
  }
}

private struct ChromeIconButton: View {
  let symbol: String
  let palette: BrowserChromePalette
  let accessibilityLabel: String?
  let action: () -> Void
  @State private var isHovering = false

  init(
    symbol: String,
    palette: BrowserChromePalette,
    accessibilityLabel: String? = nil,
    action: @escaping () -> Void = {},
  ) {
    self.symbol = symbol
    self.palette = palette
    self.accessibilityLabel = accessibilityLabel
    self.action = action
  }

  var body: some View {
    Button(
      action: action,
      label: {
        Image(systemName: symbol)
          .font(.system(size: 14, weight: .medium))
          .foregroundStyle(isHovering ? palette.secondaryText.opacity(0.8) : palette.secondaryText)
          .frame(width: 30, height: 30)
          .background(isHovering ? palette.secondaryText.opacity(0.2) : .clear, in: .rect(cornerRadius: 6))
          .accessibilityHidden(true)
      }
    )
    .buttonStyle(.plain)
    .accessibilityLabel(accessibilityLabel ?? defaultAccessibilityLabel)
    .onHover { isHovering = $0 }
  }

  private var defaultAccessibilityLabel: String {
    switch symbol {
    case "chevron.left":
      "Back"
    case "chevron.right":
      "Forward"
    case "arrow.clockwise":
      "Reload"
    case "sidebar.left":
      "Toggle sidebar"
    case "sidebar.right":
      "Toggle sidebar"
    case "arrow.trianglehead.2.clockwise.rotate.90":
      "Rotate layout"
    case "person.crop.circle":
      "Profile"
    case "ellipsis":
      "More actions"
    default:
      "Action"
    }
  }
}

private struct WindowTrafficLights: View {
  @State private var isHovering = false

  private var buttonSize: CGFloat {
    if #available(macOS 26.0, *) {
      14
    } else {
      12
    }
  }

  private var symbolSize: CGFloat {
    if #available(macOS 26.0, *) {
      8
    } else {
      7
    }
  }

  var body: some View {
    HStack(spacing: 9) {
      ForEach(TrafficLight.allCases, id: \.self) { light in
        Button(
          action: { light.perform() },
          label: {
            Circle()
              .fill(light.color)
              .frame(width: buttonSize, height: buttonSize)
              .overlay {
                if isHovering {
                  Image(systemName: light.symbol)
                    .font(.system(size: symbolSize, weight: .black))
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
    .padding(.horizontal, 8)
    .onHover { hovering in
      withAnimation(.easeInOut(duration: 0.1)) {
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

private struct WindowChromeConfigurator: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView {
    NSView()
  }

  func updateNSView(_ nsView: NSView, context: Context) {
    DispatchQueue.main.async {
      guard let window = nsView.window else { return }

      window.titleVisibility = .hidden
      window.titlebarAppearsTransparent = true
      window.standardWindowButton(.closeButton)?.isHidden = true
      window.standardWindowButton(.miniaturizeButton)?.isHidden = true
      window.standardWindowButton(.zoomButton)?.isHidden = true
    }
  }
}

private struct BrowserChromePalette {
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
  let panelFill: Color
  let pillFill: Color
  let rowFill: Color
  let clearFill: Color
  let selectedFill: Color
  let selectionStroke: Color
  let tileStroke: Color
  let primaryText: Color
  let secondaryText: Color
  let selectedText: Color
  let selectedIcon: Color
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
      panelFill = Color.white.opacity(0.05)
      pillFill = Color.white.opacity(0.08)
      rowFill = Color.white.opacity(0.06)
      clearFill = Color.white.opacity(0.03)
      selectedFill = Color.white.opacity(0.16)
      selectionStroke = Color.white.opacity(0.08)
      tileStroke = Color.white.opacity(0.04)
      primaryText = Color.white.opacity(0.94)
      secondaryText = Color.white.opacity(0.58)
      selectedText = .white
      selectedIcon = Color.white
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
      panelFill = Color.black.opacity(0.03)
      pillFill = Color.black.opacity(0.07)
      rowFill = Color.black.opacity(0.05)
      clearFill = Color.black.opacity(0.02)
      selectedFill = Color(red: 0.12, green: 0.12, blue: 0.12)
      selectionStroke = Color.black.opacity(0.08)
      tileStroke = Color.black.opacity(0.05)
      primaryText = Color.black.opacity(0.86)
      secondaryText = Color.black.opacity(0.48)
      selectedText = .white
      selectedIcon = Color.white
      shadow = .black.opacity(0.08)
    }

    amber = Color(red: 0.89, green: 0.64, blue: 0.28)
    mint = Color(red: 0.3, green: 0.72, blue: 0.58)
    sky = Color(red: 0.31, green: 0.59, blue: 0.94)
    coral = Color(red: 0.9, green: 0.43, blue: 0.38)
    violet = Color(red: 0.57, green: 0.45, blue: 0.86)
    slate = Color(red: 0.38, green: 0.44, blue: 0.56)
  }

  func fill(for tone: ChromeTone) -> Color {
    switch tone {
    case .amber:
      amber.opacity(0.85)
    case .mint:
      mint.opacity(0.85)
    case .sky:
      sky.opacity(0.85)
    case .coral:
      coral.opacity(0.85)
    case .violet:
      violet.opacity(0.85)
    case .slate:
      slate.opacity(0.85)
    }
  }
}

private enum BrowserChromeSample {
  static let favorites = [
    FavoriteTile(label: "Launchpad", symbol: "sparkles", tone: .coral, isSelected: true),
    FavoriteTile(label: "Notes", symbol: "doc.text", tone: .amber, isSelected: false),
    FavoriteTile(label: "Files", symbol: "folder", tone: .slate, isSelected: false),
    FavoriteTile(label: "Mail", symbol: "mail", tone: .mint, isSelected: false),
    FavoriteTile(label: "Media", symbol: "play.rectangle", tone: .violet, isSelected: false),
    FavoriteTile(label: "Calendar", symbol: "calendar", tone: .sky, isSelected: false),
  ]

  static let pinnedTabs = [
    SidebarTab(title: "Command Deck", symbol: "command", tone: .coral, isSelected: true, showsClose: true),
    SidebarTab(title: "Sessions", symbol: "terminal", tone: .slate, isSelected: false, showsClose: true),
    SidebarTab(title: "Bookmarks", symbol: "book", tone: .amber, isSelected: false, showsClose: true),
  ]

  static let tabs = [
    SidebarTab(title: "Workspace Notes", symbol: "note.text", tone: .sky, isSelected: false, showsClose: true),
    SidebarTab(title: "Build Output", symbol: "bolt", tone: .mint, isSelected: false, showsClose: true),
    SidebarTab(title: "Window Styling", symbol: "macwindow", tone: .violet, isSelected: false, showsClose: true),
    SidebarTab(title: "Search Results", symbol: "magnifyingglass", tone: .amber, isSelected: false, showsClose: false),
  ]

  static let spaces = [
    WorkspaceChip(label: "A", isSelected: false),
    WorkspaceChip(label: "B", isSelected: true),
    WorkspaceChip(label: "C", isSelected: false),
  ]

  static let detailPanels = [
    DetailPanel(
      eyebrow: "PRIMARY VIEW",
      title: "Warm window chrome with a static shell.",
      subtitle: "The content side stays inert. Only the visual structure is mirrored.",
      gradient: LinearGradient(
        colors: [
          Color(red: 0.98, green: 0.56, blue: 0.4),
          Color(red: 0.77, green: 0.34, blue: 0.35),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing,
      ),
    ),
    DetailPanel(
      eyebrow: "DETAIL A",
      title: "Sidebar First",
      subtitle: "Favorites, pinned rows, tabs, and footer switcher.",
      gradient: LinearGradient(
        colors: [
          Color(red: 0.29, green: 0.66, blue: 0.98),
          Color(red: 0.24, green: 0.42, blue: 0.83),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing,
      ),
    ),
    DetailPanel(
      eyebrow: "DETAIL B",
      title: "Rounded Content Card",
      subtitle: "Inset main surface floating over the warm shell.",
      gradient: LinearGradient(
        colors: [
          Color(red: 0.38, green: 0.79, blue: 0.65),
          Color(red: 0.23, green: 0.58, blue: 0.48),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing,
      ),
    ),
  ]

  static let shelfPanels = [
    DetailPanel(
      eyebrow: "SHELF",
      title: "Overview",
      subtitle: "Warm accents and inset surfaces.",
      gradient: LinearGradient(
        colors: [
          Color(red: 0.99, green: 0.72, blue: 0.42),
          Color(red: 0.89, green: 0.55, blue: 0.28),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing,
      ),
    ),
    DetailPanel(
      eyebrow: "SHELF",
      title: "Records",
      subtitle: "Static color blocks for placeholder panes.",
      gradient: LinearGradient(
        colors: [
          Color(red: 0.58, green: 0.5, blue: 0.96),
          Color(red: 0.44, green: 0.33, blue: 0.82),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing,
      ),
    ),
    DetailPanel(
      eyebrow: "SHELF",
      title: "Activity",
      subtitle: "No navigation logic or state wiring yet.",
      gradient: LinearGradient(
        colors: [
          Color(red: 0.99, green: 0.52, blue: 0.48),
          Color(red: 0.83, green: 0.34, blue: 0.4),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing,
      ),
    ),
  ]
}

private struct FavoriteTile: Identifiable {
  let label: String
  let symbol: String
  let tone: ChromeTone
  let isSelected: Bool

  var id: String {
    symbol
  }
}

private struct SidebarTab: Identifiable {
  let title: String
  let symbol: String
  let tone: ChromeTone
  let isSelected: Bool
  let showsClose: Bool

  var id: String {
    title
  }
}

private struct WorkspaceChip: Identifiable {
  let label: String
  let isSelected: Bool

  var id: String {
    label
  }
}

private struct DetailPanel: Identifiable {
  let eyebrow: String
  let title: String
  let subtitle: String
  let gradient: LinearGradient

  var id: String {
    title
  }
}

private enum ChromeTone {
  case amber
  case mint
  case sky
  case coral
  case violet
  case slate
}
