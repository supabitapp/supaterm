import AppKit
import Foundation
import GhosttyKit
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

struct TerminalSidebarChromeViewTests {
  @Test
  func licenseExpiryTakesTheUpdateSectionSlot() {
    #expect(
      TerminalSidebarChromeView.auxiliarySection(
        isLicenseExpired: false,
        showsUpdate: true
      ) == .update
    )
    #expect(
      TerminalSidebarChromeView.auxiliarySection(
        isLicenseExpired: false,
        showsUpdate: false
      ) == nil
    )
    #expect(
      TerminalSidebarChromeView.auxiliarySection(
        isLicenseExpired: true,
        showsUpdate: true
      ) == .licenseExpired
    )
  }

  @Test
  func sidebarRowAppearanceResolvesEveryState() {
    for colorScheme in [ColorScheme.light, ColorScheme.dark] {
      let palette = Palette(colorScheme: colorScheme)
      let row = SelectableRowStyle.Appearance.sidebar.resolve(palette: palette)
      let colors = palette.selectableRow

      expectSameColor(row.fill(selection: .none, isPressed: false, isHovering: false), .clear)
      expectSameColor(row.fill(selection: .none, isPressed: false, isHovering: true), colors.hoverFill)
      expectSameColor(row.fill(selection: .none, isPressed: true, isHovering: true), colors.pressedFill)
      expectSameColor(row.fill(selection: .primary, isPressed: true, isHovering: true), colors.primarySelectionFill)
      expectSameColor(row.fill(selection: .secondary, isPressed: true, isHovering: true), colors.secondarySelectionFill)
    }
  }

  @Test
  func selectionGlowExpandsItsDrawingFrameWithoutChangingTheItemFrame() {
    let itemFrame = CGRect(x: 12, y: 30, width: 220, height: 40)

    let visualFrame = TerminalSidebarSelectionGlowView.visualFrame(for: itemFrame)

    #expect(
      visualFrame.insetBy(
        dx: SelectableRowShadowMetrics.visualOutset,
        dy: SelectableRowShadowMetrics.visualOutset
      ) == itemFrame
    )
  }

  @MainActor
  @Test
  func selectionGlowUsesTheSelectedSurfaceAsItsShadowSource() throws {
    let itemFrame = CGRect(x: 20, y: 60, width: 200, height: 40)
    let raster = try #require(
      SelectionGlowRaster(
        surfaceFrame: itemFrame,
        style: TerminalSidebarSelectionGlowView.Style(
          surfaceColor: .black,
          shadowColor: .white,
          edgeStrongColor: .clear,
          edgeWeakColor: .clear,
          isDark: true
        ),
        scale: 2
      )
    )
    let surfaceColor = try #require(
      raster.color(at: CGPoint(x: itemFrame.midX, y: itemFrame.midY))
    )
    let surfaceRGB = try #require(surfaceColor.usingColorSpace(.deviceRGB))

    #expect(surfaceRGB.alphaComponent == 1)
    #expect(surfaceRGB.redComponent == 0)
    #expect(surfaceRGB.greenComponent == 0)
    #expect(surfaceRGB.blueComponent == 0)
  }

  @MainActor
  @Test
  func selectionEdgeHighlightsTheTopLeftAndBottomRight() throws {
    let itemFrame = CGRect(x: 20, y: 60, width: 200, height: 40)
    let raster = try #require(
      SelectionGlowRaster(
        surfaceFrame: itemFrame,
        style: TerminalSidebarSelectionGlowView.Style(
          surfaceColor: .black,
          shadowColor: .clear,
          edgeStrongColor: .white,
          edgeWeakColor: .clear,
          isDark: true
        ),
        scale: 2,
        fadesAtContentTop: false
      )
    )
    let cornerSize: CGFloat = 14
    let visualTopLeft = CGRect(
      x: itemFrame.minX,
      y: itemFrame.minY,
      width: cornerSize,
      height: cornerSize
    )
    let visualTopRight = CGRect(
      x: itemFrame.maxX - cornerSize,
      y: itemFrame.minY,
      width: cornerSize,
      height: cornerSize
    )
    let visualBottomLeft = CGRect(
      x: itemFrame.minX,
      y: itemFrame.maxY - cornerSize,
      width: cornerSize,
      height: cornerSize
    )
    let visualBottomRight = CGRect(
      x: itemFrame.maxX - cornerSize,
      y: itemFrame.maxY - cornerSize,
      width: cornerSize,
      height: cornerSize
    )

    #expect(raster.peakBrightness(in: visualTopLeft) > raster.peakBrightness(in: visualTopRight) * 2)
    #expect(raster.peakBrightness(in: visualBottomRight) > raster.peakBrightness(in: visualBottomLeft) * 2)
  }

  @MainActor
  @Test
  func selectionEdgeKeepsItsFullStrokeAtPaletteOpacity() throws {
    let itemFrame = CGRect(x: 20, y: 60, width: 200, height: 40)
    let palette = Palette(colorScheme: .dark)
    let raster = try #require(
      SelectionGlowRaster(
        surfaceFrame: itemFrame,
        style: .resolve(palette: palette),
        scale: 2,
        fadesAtContentTop: false
      )
    )
    let outsideTopEdge = CGRect(
      x: itemFrame.minX + 16,
      y: itemFrame.minY - 1,
      width: 24,
      height: 1
    )

    #expect(raster.peakBrightness(in: outsideTopEdge) > 0.1)
  }

  @MainActor
  @Test
  func selectionEdgeDoesNotAlterTheOpaqueLightSurface() throws {
    let itemFrame = CGRect(x: 20, y: 60, width: 200, height: 40)
    let edge = try #require(
      SelectionGlowRaster(
        surfaceFrame: itemFrame,
        style: TerminalSidebarSelectionGlowView.Style(
          surfaceColor: .white,
          shadowColor: .clear,
          edgeStrongColor: .white,
          edgeWeakColor: .white,
          isDark: false
        ),
        scale: 2,
        fadesAtContentTop: false
      )
    )
    let noEdge = try #require(
      SelectionGlowRaster(
        surfaceFrame: itemFrame,
        style: TerminalSidebarSelectionGlowView.Style(
          surfaceColor: .white,
          shadowColor: .clear,
          edgeStrongColor: .clear,
          edgeWeakColor: .clear,
          isDark: false
        ),
        scale: 2,
        fadesAtContentTop: false
      )
    )

    #expect(edge.maximumColorDifference(from: noEdge) < 0.01)
  }

  @MainActor
  @Test
  func selectionGlowHangsBelowTheSelectedRow() throws {
    let itemFrame = CGRect(x: 20, y: 60, width: 200, height: 40)
    let raster = try #require(
      SelectionGlowRaster(
        surfaceFrame: itemFrame,
        style: TerminalSidebarSelectionGlowView.Style(
          surfaceColor: .white,
          shadowColor: .black,
          edgeStrongColor: .clear,
          edgeWeakColor: .clear,
          isDark: false
        )
      )
    )
    let band = 8
    let above = raster.ink(rows: (Int(itemFrame.minY) - band)..<Int(itemFrame.minY))
    let below = raster.ink(rows: Int(itemFrame.maxY)..<(Int(itemFrame.maxY) + band))

    #expect(above > 0)
    #expect(below > above)
  }

  @MainActor
  @Test
  func selectionGlowFadesOutAtTheContentTop() throws {
    let itemFrame = CGRect(
      x: 20,
      y: TerminalSidebarLayoutPlan.initialY,
      width: 200,
      height: 40
    )
    let raster = try #require(
      SelectionGlowRaster(
        surfaceFrame: itemFrame,
        style: TerminalSidebarSelectionGlowView.Style(
          surfaceColor: .white,
          shadowColor: .black,
          edgeStrongColor: .clear,
          edgeWeakColor: .clear,
          isDark: false
        )
      )
    )
    let rowInk = (0..<Int(itemFrame.minY)).map { raster.ink(rows: $0..<($0 + 1)) }
    let topInk = rowInk.prefix(3).reduce(0, +)
    let rowEdgeInk = rowInk.suffix(3).reduce(0, +)

    #expect(rowEdgeInk > 50)
    #expect(topInk < rowEdgeInk / 10)
    #expect(zip(rowInk, rowInk.dropFirst()).allSatisfy { $0 < $1 })
  }

  @MainActor
  @Test
  func anchoredSidebarSurfaceLeavesThePaneGutterUnclipped() throws {
    let sidebarWidth = 100
    let gutterWidth = Int(TerminalChromeMetrics.paneInset)
    let container = NSHostingView(
      rootView: TerminalSidebarSurfaceShell(
        palette: Palette(colorScheme: .dark),
        isFloating: false
      ) {
        Color.white
          .padding(.trailing, -TerminalChromeMetrics.paneInset)
      }
      .frame(width: CGFloat(sidebarWidth), height: 40)
      .frame(width: CGFloat(sidebarWidth + gutterWidth + 4), alignment: .leading)
    )
    container.frame.size = container.fittingSize
    let window = NSWindow(
      contentRect: container.frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentView = container
    container.layoutSubtreeIfNeeded()

    let raster = try #require(SelectionGlowRaster(view: container))

    #expect(raster.ink(columns: sidebarWidth..<(sidebarWidth + gutterWidth)) > 0)
    #expect(raster.ink(columns: (sidebarWidth + gutterWidth)..<(sidebarWidth + gutterWidth + 4)) == 0)
  }

  @Test
  func terminalProgressTakesPrecedenceOverPaneStatus() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)
    let paneIndicators: [TerminalSidebarPanePresentation.Indicator] = [
      .agent(.working),
      .attention,
    ]

    for paneIndicator in paneIndicators {
      #expect(
        TerminalSidebarTabSummaryView.trailingAccessory(
          terminalProgress: progress,
          paneIndicator: paneIndicator
        ) == .terminalProgress(progress)
      )
    }
  }

  @Test
  func agentStateUsesTheTrailingAccessory() {
    let statuses: [TerminalHostState.TabAgentStatus] = [.working, .done, .needsInput]
    for status in statuses {
      #expect(
        TerminalSidebarTabSummaryView.trailingAccessory(
          paneIndicator: .agent(status)
        ) == .agent(status)
      )
    }
  }

  @Test
  func paneAttentionTakesPrecedenceOverPinnedStatus() {
    #expect(
      TerminalSidebarTabSummaryView.trailingAccessory(
        isPinned: true,
        paneIndicator: .attention
      ) == .attention
    )
  }

  @Test
  func selectedWarningBadgeForegroundMeetsContrast() {
    for palette in [Palette(colorScheme: .light), Palette(colorScheme: .dark)] {
      let foreground = TerminalSidebarWarningBadgeStyle.foregroundValue(isSelected: true, palette: palette)
      let background = TerminalSidebarWarningBadgeStyle.selectedBackgroundValue(palette: palette)
      #expect(ColorMath.contrastRatio(foreground, background) >= 4.5)
    }
  }

  @Test
  func terminalProgressAppearsWhenNoHigherPriorityStatusExists() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.trailingAccessory(
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func tabRowsReserveOneTrailingAccessorySlot() {
    #expect(TerminalSidebarLayout.tabTrailingAccessorySize == 24)
  }

  @Test
  func closeButtonUsesEqualOneRowOuterPadding() {
    #expect(TerminalSidebarLayout.tabCloseButtonOuterPadding == 5)
  }

  @Test
  func quietTabShowsNoStatusAccessory() {
    #expect(TerminalSidebarTabSummaryView.trailingAccessory() == nil)
  }

  @Test
  func pinnedTabsShowPinnedStatusWhenNoHigherPriorityStatusExists() {
    #expect(
      TerminalSidebarTabSummaryView.trailingAccessory(
        isPinned: true
      ) == .pinned
    )
  }

  @Test
  func terminalProgressHidesPinnedStatus() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.trailingAccessory(
        isPinned: true,
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func shortcutHintTakesTheTrailingSlot() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)
    func expectShortcut(
      isPinned: Bool = false,
      terminalProgress: TerminalSidebarTerminalProgress? = nil,
      paneIndicator: TerminalSidebarPanePresentation.Indicator? = nil
    ) {
      #expect(
        TerminalSidebarTabSummaryView.trailingAccessory(
          shortcutHint: "⌘1",
          showsShortcutHint: true,
          isPinned: isPinned,
          terminalProgress: terminalProgress,
          paneIndicator: paneIndicator
        )
          == .shortcut("⌘1")
      )
    }

    expectShortcut(paneIndicator: .agent(.working))
    expectShortcut(paneIndicator: .attention)
    expectShortcut(isPinned: true)
    expectShortcut(terminalProgress: progress)
  }

  @Test
  func rowShortcutHintWithoutVisibleHintReservesNoAccessorySlot() {
    #expect(
      TerminalSidebarTabSummaryView.trailingAccessory(
        shortcutHint: nil,
        showsShortcutHint: true,
        paneIndicator: .agent(.working)
      )
        == nil
    )
  }

  @Test
  func rowHoverTakesPriorityOverShortcutHint() {
    #expect(
      TerminalSidebarTabSummaryView.trailingAccessory(
        shortcutHint: "⌘1",
        showsShortcutHint: true,
        isRowHovering: true,
        paneIndicator: .attention
      )
        == .reserved
    )
  }

  @Test
  func rowHoverReservesTrailingAccessorySlotForCloseButton() {
    #expect(
      TerminalSidebarTabSummaryView.trailingAccessory(
        isRowHovering: true
      )
        == .reserved
    )
  }

  @Test
  func quietRowReservesNoTrailingAccessorySlot() {
    #expect(TerminalSidebarTabSummaryView.trailingAccessory() == nil)
  }

  @Test
  func trailingSlotShowsProgressWithoutShortcutHint() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)
    #expect(
      TerminalSidebarTabSummaryView.trailingAccessory(
        shortcutHint: "⌘1",
        terminalProgress: progress
      )
        == .terminalProgress(progress)
    )
  }

  @Test
  func pathLikeTabTitlesTruncateInTheMiddle() {
    #expect(TerminalSidebarTabSummaryView.titleTruncationMode("~/code/github.com/supabitapp/supaterm") == .middle)
    #expect(TerminalSidebarTabSummaryView.titleTruncationMode("/Users/Developer/code/github.com") == .middle)
    #expect(TerminalSidebarTabSummaryView.titleTruncationMode("ping 1.1.1.1") == .tail)
  }

  @Test
  func helpTextListsLockedTitleAndPaneTitles() {
    let tab = TerminalTabItem(title: "Release", isTitleLocked: true)
    let panes = [
      TerminalSidebarPanePresentation(
        id: UUID(),
        title: "Codex",
        indicator: .agent(.working)
      ),
      TerminalSidebarPanePresentation(
        id: UUID(),
        title: "Review agent",
        indicator: .agent(.done)
      ),
    ]

    #expect(
      TerminalSidebarTabSummaryView.helpText(tab: tab, panes: panes)
        == "Release\nCodex\nReview agent"
    )
  }

  @Test
  func pullRequestStatesUseDistinctSymbols() {
    let states: [(PaneAgentPullRequestStatus.Kind, TerminalMetadataIcon)] = [
      (.open, .asset("git-pull-request")),
      (.draft, .asset("git-pull-request-draft")),
      (.merged, .asset("git-merge")),
      (.closed, .asset("git-pull-request-closed")),
    ]

    for (kind, icon) in states {
      let pullRequest = TerminalTabAgentWorkspace.PullRequest(
        kind: kind,
        title: "#128",
      )
      #expect(pullRequest.icon == icon)
    }
  }

  @Test
  func shortcutHintsFollowVisibleTabOrderThroughSlotTen() {
    let tabs = (1...11).map { index in
      TerminalTabItem(title: "Tab \(index)")
    }

    let hints = TerminalSidebarTabShortcutHints.byTabID(for: tabs) { slot in
      SupatermCommand.goToTab(slot).defaultKeyboardShortcut
    }

    #expect(hints[tabs[0].id] == "⌘1")
    #expect(hints[tabs[8].id] == "⌘9")
    #expect(hints[tabs[9].id] == "⌘0")
    #expect(hints[tabs[10].id] == nil)
  }

  @Test
  func shortcutHintsUseProvidedVisibleOrder() {
    let first = TerminalTabItem(title: "First")
    let second = TerminalTabItem(title: "Second")
    let third = TerminalTabItem(title: "Third")

    let hints = TerminalSidebarTabShortcutHints.byTabID(for: [third, first, second]) { slot in
      SupatermCommand.goToTab(slot).defaultKeyboardShortcut
    }

    #expect(hints[third.id] == "⌘1")
    #expect(hints[first.id] == "⌘2")
    #expect(hints[second.id] == "⌘3")
  }

  @MainActor
  @Test
  func focusedPaneIndeterminateProgressUsesActiveSpinner() {
    let state = GhosttySurfaceState()
    state.progressState = GHOSTTY_PROGRESS_STATE_INDETERMINATE

    #expect(
      TerminalHostState.sidebarTerminalProgress(state: state)
        == TerminalSidebarTerminalProgress(fraction: nil, tone: .active)
    )
  }

  @MainActor
  @Test
  func focusedPaneDeterminateProgressUsesFraction() {
    let state = GhosttySurfaceState()
    state.progressState = GHOSTTY_PROGRESS_STATE_SET
    state.progressValue = 42

    #expect(
      TerminalHostState.sidebarTerminalProgress(state: state)
        == TerminalSidebarTerminalProgress(fraction: 0.42, tone: .active)
    )
  }

  @MainActor
  @Test
  func focusedPanePausedProgressWithoutValueUsesFullRing() {
    let state = GhosttySurfaceState()
    state.progressState = GHOSTTY_PROGRESS_STATE_PAUSE

    #expect(
      TerminalHostState.sidebarTerminalProgress(state: state)
        == TerminalSidebarTerminalProgress(fraction: 1, tone: .paused)
    )
  }

  @Test
  func pausedProgressUsesPauseIconIndicator() {
    let progress = TerminalSidebarTerminalProgress(fraction: 1, tone: .paused)

    #expect(progress.indicatorStyle == .pauseIcon)
  }

  @MainActor
  @Test
  func focusedPaneErrorProgressWithoutValueUsesErrorSpinner() {
    let state = GhosttySurfaceState()
    state.progressState = GHOSTTY_PROGRESS_STATE_ERROR

    #expect(
      TerminalHostState.sidebarTerminalProgress(state: state)
        == TerminalSidebarTerminalProgress(fraction: nil, tone: .error)
    )
  }

  @MainActor
  @Test
  func missingFocusedPaneStateProducesNoProgressRing() {
    #expect(TerminalHostState.sidebarTerminalProgress(state: nil) == nil)
  }
}

private func expectSameColor(
  _ actual: Color,
  _ expected: Color,
  sourceLocation: SourceLocation = #_sourceLocation
) {
  let actual = actual.resolve(in: EnvironmentValues())
  let expected = expected.resolve(in: EnvironmentValues())
  #expect(
    abs(actual.red - expected.red) < 0.0001
      && abs(actual.green - expected.green) < 0.0001
      && abs(actual.blue - expected.blue) < 0.0001
      && abs(actual.opacity - expected.opacity) < 0.0001,
    "\(actual) != \(expected)",
    sourceLocation: sourceLocation
  )
}

private struct SelectionGlowRaster {
  private let raster: NSBitmapImageRep
  private let scale: CGFloat

  @MainActor
  init?(
    surfaceFrame: CGRect,
    style: TerminalSidebarSelectionGlowView.Style,
    scale: CGFloat = 1,
    fadesAtContentTop: Bool = true
  ) {
    let container = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 160))
    let window = NSWindow(
      contentRect: container.frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentView = container
    let glow = TerminalSidebarSelectionGlowView()
    container.addSubview(glow)
    glow.update(
      surfaceFrame: surfaceFrame,
      style: style,
      alpha: 1,
      fadesAtContentTop: fadesAtContentTop
    )
    container.layoutSubtreeIfNeeded()
    self.init(view: container, scale: scale)
  }

  @MainActor
  init?(view: NSView, scale: CGFloat = 1) {
    self.scale = scale
    guard
      let context = CGContext(
        data: nil,
        width: Int(view.bounds.width * scale),
        height: Int(view.bounds.height * scale),
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      )
    else { return nil }
    context.scaleBy(x: scale, y: scale)
    context.translateBy(x: 0, y: view.bounds.height)
    context.scaleBy(x: 1, y: -1)
    view.displayIgnoringOpacity(
      view.bounds,
      in: NSGraphicsContext(cgContext: context, flipped: true)
    )
    guard let image = context.makeImage() else { return nil }
    raster = NSBitmapImageRep(cgImage: image)
  }

  func ink(rows: Range<Int>) -> CGFloat {
    rows.reduce(0) { total, y in
      (0..<raster.pixelsWide).reduce(total) { running, x in
        running + (raster.colorAt(x: x, y: y)?.alphaComponent ?? 0)
      }
    }
  }

  func ink(columns: Range<Int>) -> CGFloat {
    columns.reduce(0) { total, x in
      (0..<raster.pixelsHigh).reduce(total) { running, y in
        running + (raster.colorAt(x: x, y: y)?.alphaComponent ?? 0)
      }
    }
  }

  func color(at point: CGPoint) -> NSColor? {
    raster.colorAt(x: Int(point.x * scale), y: Int(point.y * scale))
  }

  func peakBrightness(in rect: CGRect) -> CGFloat {
    let xRange = Int(rect.minX * scale)..<Int(rect.maxX * scale)
    let yRange = Int(rect.minY * scale)..<Int(rect.maxY * scale)
    return yRange.reduce(0) { peak, y in
      xRange.reduce(peak) { runningPeak, x in
        guard let color = raster.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else {
          return runningPeak
        }
        return max(runningPeak, color.redComponent, color.greenComponent, color.blueComponent)
      }
    }
  }

  func maximumColorDifference(from other: Self) -> CGFloat {
    guard raster.pixelsWide == other.raster.pixelsWide, raster.pixelsHigh == other.raster.pixelsHigh else {
      return .infinity
    }
    return (0..<raster.pixelsHigh).reduce(0) { rowMaximum, y in
      (0..<raster.pixelsWide).reduce(rowMaximum) { maximum, x in
        guard
          let first = raster.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB),
          let second = other.raster.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB)
        else { return maximum }
        return max(
          maximum,
          abs(first.redComponent - second.redComponent),
          abs(first.greenComponent - second.greenComponent),
          abs(first.blueComponent - second.blueComponent),
          abs(first.alphaComponent - second.alphaComponent)
        )
      }
    }
  }
}
