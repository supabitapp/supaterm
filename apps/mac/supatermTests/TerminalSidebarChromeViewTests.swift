import AppKit
import Foundation
import GhosttyKit
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

struct TerminalSidebarChromeViewTests {
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
  func selectionEdgeHighlightsTheBottomLeftAndTopRight() throws {
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
    let bottomLeft = CGRect(
      x: itemFrame.minX,
      y: itemFrame.minY,
      width: cornerSize,
      height: cornerSize
    )
    let bottomRight = CGRect(
      x: itemFrame.maxX - cornerSize,
      y: itemFrame.minY,
      width: cornerSize,
      height: cornerSize
    )
    let topLeft = CGRect(
      x: itemFrame.minX,
      y: itemFrame.maxY - cornerSize,
      width: cornerSize,
      height: cornerSize
    )
    let topRight = CGRect(
      x: itemFrame.maxX - cornerSize,
      y: itemFrame.maxY - cornerSize,
      width: cornerSize,
      height: cornerSize
    )

    #expect(raster.peakBrightness(in: bottomLeft) > raster.peakBrightness(in: bottomRight) * 2)
    #expect(raster.peakBrightness(in: topRight) > raster.peakBrightness(in: topLeft) * 2)
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
  func unreadCountTakesPrecedenceOverAgentActivity() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 3,
        agentActivity: .claude(.needsInput),
        terminalProgress: nil
      ) == .unreadCount(3)
    )
  }

  @Test
  func terminalProgressTakesPrecedenceOverUnreadCount() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 3,
        agentActivity: nil,
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func terminalProgressTakesPrecedenceOverTerminalBell() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: progress,
        hasTerminalBell: true
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func unreadCountTakesPrecedenceOverTerminalBell() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 3,
        agentActivity: nil,
        terminalProgress: nil,
        hasTerminalBell: true
      ) == .unreadCount(3)
    )
  }

  @Test
  func agentInputTakesPrecedenceOverTerminalBell() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .codex(.needsInput),
        terminalProgress: nil,
        hasTerminalBell: true
      ) == .agentActivity(.codex(.needsInput))
    )
  }

  @Test
  func terminalBellTakesPrecedenceOverRunningAgentAndPinnedStatus() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: true,
        unreadCount: 0,
        agentActivity: .codex(.running),
        terminalProgress: nil,
        hasTerminalBell: true
      ) == .terminalBell
    )
  }

  @Test
  func agentActivityAppearsWhenNoHigherPriorityStatusExists() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: nil
      ) == .agentActivity(.claude(.running))
    )
  }

  @Test
  func runningAgentActivityIsHiddenWhenAgentSpinnerIsHidden() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: nil,
        showsAgentSpinner: false
      ) == nil
    )
  }

  @Test
  func hiddenAgentSpinnerFallsBackToPinnedStatus() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: true,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: nil,
        showsAgentSpinner: false
      ) == .pinned
    )
  }

  @Test
  func agentInputStatusIgnoresAgentSpinnerSetting() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .claude(.needsInput),
        terminalProgress: nil,
        showsAgentSpinner: false
      ) == .agentActivity(.claude(.needsInput))
    )
  }

  @Test
  func focusedAgentInputStatusIsHidden() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .codex(.needsInput),
        agentActivityIsFocused: true,
        terminalProgress: nil
      ) == nil
    )
  }

  @Test
  func focusedAgentInputStatusFallsBackToTerminalBell() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .codex(.needsInput),
        agentActivityIsFocused: true,
        terminalProgress: nil,
        hasTerminalBell: true
      ) == .terminalBell
    )
  }

  @Test
  func selectedWarningBadgeForegroundMeetsContrast() {
    for palette in [Palette(colorScheme: .light), Palette(colorScheme: .dark)] {
      let foreground = TerminalSidebarWarningBadgeStyle.foregroundValue(isSelected: true, palette: palette)
      for background in TerminalSidebarWarningBadgeStyle.selectedBackgroundValues(palette: palette) {
        #expect(ColorMath.contrastRatio(foreground, background) >= 4.5)
      }
    }
  }

  @Test
  func terminalProgressTakesPrecedenceOverAgentActivity() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .claude(.running),
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func terminalProgressAppearsWhenNoHigherPriorityStatusExists() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func idleAgentShowsNoStatusAccessory() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: .claude(.idle),
        terminalProgress: nil
      ) == nil
    )
  }

  @Test
  func agentActivityPresentationUsesExpectedTonesAndVisibility() {
    #expect(TerminalHostState.AgentActivity.claude(.running).tone == .active)
    #expect(TerminalHostState.AgentActivity.claude(.running).showsLeadingIndicator)

    #expect(TerminalHostState.AgentActivity.codex(.needsInput).tone == .attention)
    #expect(TerminalHostState.AgentActivity.codex(.needsInput).showsLeadingIndicator)

    #expect(TerminalHostState.AgentActivity.claude(.idle).tone == .muted)
    #expect(!TerminalHostState.AgentActivity.claude(.idle).showsLeadingIndicator)
  }

  @Test
  func tabRowsReserveOneTrailingAccessorySlot() {
    #expect(TerminalSidebarLayout.tabTrailingAccessorySize == 24)
  }

  @Test
  func unreadCountFitsTheTrailingAccessorySlot() {
    #expect(TerminalSidebarTabSummaryView.unreadCountText(12) == "12")
    #expect(TerminalSidebarTabSummaryView.unreadCountText(100) == "99+")
  }

  @Test
  func quietTabShowsNoStatusAccessory() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: false,
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: nil
      ) == nil
    )
  }

  @Test
  func pinnedTabsShowPinnedStatusWhenNoHigherPriorityStatusExists() {
    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: true,
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: nil
      ) == .pinned
    )
  }

  @Test
  func terminalProgressHidesPinnedStatus() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)

    #expect(
      TerminalSidebarTabSummaryView.statusAccessory(
        isPinned: true,
        unreadCount: 0,
        agentActivity: nil,
        terminalProgress: progress
      ) == .terminalProgress(progress)
    )
  }

  @Test
  func rowShortcutHintHidesStatusAccessories() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)
    let statuses: [TerminalSidebarTabSummaryView.StatusAccessory] = [
      .pinned,
      .terminalProgress(progress),
      .agentActivity(.codex(.running)),
      .unreadCount(2),
      .terminalBell,
    ]

    for status in statuses {
      #expect(
        TerminalSidebarTabSummaryView.rowAccessories(
          shortcutHint: "⌘1",
          showsShortcutHint: true,
          isRowHovering: false,
          statusAccessory: status
        )
          == TerminalSidebarTabSummaryView.RowAccessories(
            shortcutHint: "⌘1",
            statusAccessory: nil
          )
      )
    }
  }

  @Test
  func rowShortcutHintHidesStatusAccessoryWithoutVisibleHint() {
    #expect(
      TerminalSidebarTabSummaryView.rowAccessories(
        shortcutHint: nil,
        showsShortcutHint: true,
        isRowHovering: false,
        statusAccessory: .pinned
      )
        == TerminalSidebarTabSummaryView.RowAccessories(
          shortcutHint: nil,
          statusAccessory: nil
        )
    )
  }

  @Test
  func rowHoverHidesStatusAccessoryButKeepsShortcutHint() {
    #expect(
      TerminalSidebarTabSummaryView.rowAccessories(
        shortcutHint: "⌘1",
        showsShortcutHint: true,
        isRowHovering: true,
        statusAccessory: .unreadCount(2)
      )
        == TerminalSidebarTabSummaryView.RowAccessories(
          shortcutHint: "⌘1",
          statusAccessory: nil
        )
    )
  }

  @Test
  func rowAccessoriesShowProgressWithoutShortcutHint() {
    let progress = TerminalSidebarTerminalProgress(fraction: 0.5, tone: .active)
    #expect(
      TerminalSidebarTabSummaryView.rowAccessories(
        shortcutHint: "⌘1",
        showsShortcutHint: false,
        isRowHovering: false,
        statusAccessory: .terminalProgress(progress)
      )
        == TerminalSidebarTabSummaryView.RowAccessories(
          shortcutHint: nil,
          statusAccessory: .terminalProgress(progress)
        )
    )
  }

  @Test
  func pathLikeTabTitlesTruncateInTheMiddle() {
    #expect(TerminalSidebarTabSummaryView.titleTruncationMode("~/code/github.com/supabitapp/supaterm") == .middle)
    #expect(TerminalSidebarTabSummaryView.titleTruncationMode("/Users/Developer/code/github.com") == .middle)
    #expect(TerminalSidebarTabSummaryView.titleTruncationMode("ping 1.1.1.1") == .tail)
  }

  @Test
  func helpTextIncludesPaneDirectoriesOnly() {
    #expect(
      TerminalSidebarTabSummaryView.helpText(
        paneWorkingDirectories: ["~/Downloads", "~/Downloads/abc"]
      ) == "~/Downloads\n~/Downloads/abc"
    )
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

  @Test
  func tabContextMenuIncludesChangeTabTitle() {
    let titles = TerminalSidebarTabRow.contextMenuItems(
      isPinned: false,
      hasTabsBelow: true,
      hasOtherTabs: true
    ).compactMap(\.title)

    #expect(
      titles == [
        "New Tab",
        "Pin Tab",
        "Move to New Group",
        "Move to Group...",
        "Change Tab Title...",
        "Close All Below",
        "Close Others",
        "Close",
      ]
    )
  }

  @Test
  func pinnedTabContextMenuOmitsManualSaveLayout() {
    let titles = TerminalSidebarTabRow.contextMenuItems(
      isPinned: true,
      hasTabsBelow: true,
      hasOtherTabs: true
    ).compactMap(\.title)

    #expect(
      titles == [
        "New Tab",
        "Unpin Tab",
        "Move to New Group",
        "Move to Group...",
        "Change Tab Title...",
        "Close All Below",
        "Close Others",
        "Close",
      ]
    )
  }

  @Test
  func groupedTabContextMenuSupportsExtractionAndRegrouping() {
    let titles = TerminalSidebarTabRow.contextMenuItems(
      isPinned: false,
      hasTabsBelow: true,
      hasOtherTabs: true,
      isGrouped: true
    ).compactMap(\.title)

    #expect(
      titles == [
        "New Tab",
        "Pin Tab",
        "Move to New Group",
        "Move to Group...",
        "Remove from Group",
        "Change Tab Title...",
        "Close All Below",
        "Close Others",
        "Close",
      ]
    )
  }

  @Test
  func regularHoveredTabShowsEnabledCloseButton() {
    #expect(
      TerminalSidebarTabRow.closeButtonPresentation(
        isHovering: true,
        showsShortcutHint: false
      ) == .enabled
    )
  }

  @Test
  func pinnedHoveredTabShowsEnabledCloseButton() {
    #expect(
      TerminalSidebarTabRow.closeButtonPresentation(
        isHovering: true,
        showsShortcutHint: false
      ) == .enabled
    )
  }

  @Test
  func shortcutHintHidesCloseButton() {
    #expect(
      TerminalSidebarTabRow.closeButtonPresentation(
        isHovering: true,
        showsShortcutHint: true
      ) == .hidden
    )
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
}
