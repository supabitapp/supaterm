import AppKit
import XCTest

final class PanesSplitsUITests: SupatermUITestCase {
  private static let paneIdentifierPrefix = "terminal.pane."
  private static let opacityBackground = RGB(red: 255, green: 0, blue: 255)

  @MainActor
  private var terminalPanes: XCUIElementQuery {
    app.textViews.matching(
      NSPredicate(format: "identifier BEGINSWITH %@", Self.paneIdentifierPrefix)
    )
  }

  @MainActor
  private var focusedTerminalPanes: XCUIElementQuery {
    terminalPanes.matching(NSPredicate(format: "hasKeyboardFocus == true"))
  }

  @MainActor
  func testSplitRightCreatesTwoVisiblePanes() async throws {
    _ = try await requireVisiblePanes(count: 1)

    try clickMenuItem(.splitRight)

    let panes = try await requireVisiblePanes(count: 2)
    XCTAssertGreaterThan(
      abs(panes[0].frame.midX - panes[1].frame.midX),
      abs(panes[0].frame.midY - panes[1].frame.midY)
    )
  }

  @MainActor
  func testSplitDownCreatesTwoVisiblePanes() async throws {
    _ = try await requireVisiblePanes(count: 1)

    try clickMenuItem(.splitDown)

    let panes = try await requireVisiblePanes(count: 2)
    XCTAssertGreaterThan(
      abs(panes[0].frame.midY - panes[1].frame.midY),
      abs(panes[0].frame.midX - panes[1].frame.midX)
    )
  }

  @MainActor
  func testDirectionalFocusNavigationMovesFocusBetweenPanes() async throws {
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let leftPane = try XCTUnwrap(panes.min { $0.frame.midX < $1.frame.midX })
    let rightPane = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })

    try clickMenuItem(.selectSplitLeft)
    try await requireFocus(on: leftPane)

    try clickMenuItem(.selectSplitRight)
    try await requireFocus(on: rightPane)
  }

  @MainActor
  func testSplitWhileSearchOpenFocusesNewPane() async throws {
    let originalPane = try await requireVisiblePanes(count: 1)[0]
    originalPane.click()
    let originalIdentifier = originalPane.identifier

    app.typeKey("f", modifierFlags: .command)
    let searchField = app.textFields[SupatermUITestIdentifier.Accessibility.searchField]
    XCTAssertTrue(searchField.waitForExistence(timeout: 10))
    searchField.typeText("SPLITFOCUSNEEDLE")
    XCTAssertEqual(searchField.value as? String, "SPLITFOCUSNEEDLE")

    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let newPane = try XCTUnwrap(panes.first { $0.identifier != originalIdentifier })

    let remountedSearchField = app.textFields[
      SupatermUITestIdentifier.Accessibility.searchField
    ]
    XCTAssertTrue(remountedSearchField.waitForExistence(timeout: 10))
    try await requireFocus(on: newPane)

    app.typeText(
      "printf '\\x53\\x50\\x4C\\x49\\x54\\x46\\x4F\\x43\\x55\\x53\\x4D\\x41\\x52\\x4B\\x45\\x52\\n'"
    )
    app.typeKey(.return, modifierFlags: [])
    let markerPrinted = await wait(for: newPane, timeout: .seconds(30)) {
      ($0.value as? String)?.contains("SPLITFOCUSMARKER") == true
    }
    XCTAssertTrue(markerPrinted)
    XCTAssertEqual(remountedSearchField.value as? String, "SPLITFOCUSNEEDLE")
  }

  @MainActor
  func testTopBarTitleFollowsFocusedPane() async throws {
    let leftPane = try await requireVisiblePanes(count: 1)[0]
    leftPane.click()
    try await requireFocus(on: leftPane)

    let leftTitle = "pane-title-L-\(UUID().uuidString.prefix(8))"
    leftPane.typeText("printf '\\033]0;\(leftTitle)\\007'; sleep 600\n")
    let didSetLeftTitle = await wait(for: leftPane, timeout: .seconds(30)) {
      $0.label == leftTitle
    }
    XCTAssertTrue(didSetLeftTitle)

    let sidebarTabRow = sidebarTabRows.firstMatch
    try clickMenuItem(.toggleSidebar)
    let didHideSidebar = await wait(for: sidebarTabRow) { !$0.isHittable }
    XCTAssertTrue(didHideSidebar)

    let leftTopBarTitle = app.staticTexts[leftTitle]
    let didShowLeftTitle = await wait(for: leftTopBarTitle) {
      $0.exists && $0.isHittable
    }
    XCTAssertTrue(didShowLeftTitle)

    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let rightPane = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })
    try await requireFocus(on: rightPane)

    let rightTitle = "pane-title-R-\(UUID().uuidString.prefix(8))"
    rightPane.typeText("printf '\\033]0;\(rightTitle)\\007'; sleep 600\n")
    let didSetRightTitle = await wait(for: rightPane, timeout: .seconds(30)) {
      $0.label == rightTitle
    }
    XCTAssertTrue(didSetRightTitle)

    let rightTopBarTitle = app.staticTexts[rightTitle]
    let didShowRightTitle = await wait(for: rightTopBarTitle) {
      $0.exists && $0.isHittable
    }
    XCTAssertTrue(didShowRightTitle)
    let didHideLeftTitle = await wait(for: leftTopBarTitle) { !$0.exists }
    XCTAssertTrue(didHideLeftTitle)

    try clickMenuItem(.selectSplitLeft)
    try await requireFocus(on: leftPane)
    let didRestoreLeftTitle = await wait(for: leftTopBarTitle) {
      $0.exists && $0.isHittable
    }
    XCTAssertTrue(didRestoreLeftTitle)
    let didHideRightTitle = await wait(for: rightTopBarTitle) { !$0.exists }
    XCTAssertTrue(didHideRightTitle)

    try clickMenuItem(.selectSplitRight)
    try await requireFocus(on: rightPane)
    let didRestoreRightTitle = await wait(for: rightTopBarTitle) {
      $0.exists && $0.isHittable
    }
    XCTAssertTrue(didRestoreRightTitle)
    let didRemoveLeftTitle = await wait(for: leftTopBarTitle) { !$0.exists }
    XCTAssertTrue(didRemoveLeftTitle)

    leftPane.click()
    app.typeKey("c", modifierFlags: .control)
    rightPane.click()
    app.typeKey("c", modifierFlags: .control)
  }

  @MainActor
  func testTopBarRendersSplitButtonOverTerminalBackground() async throws {
    let pane = try await requireVisiblePanes(count: 1)[0]

    let splitRightButton = app.buttons["Split right"]
    let didShowSplitRightButton = await wait(for: splitRightButton) {
      $0.exists && $0.isHittable
    }
    XCTAssertTrue(didShowSplitRightButton)

    let buttonMetrics = try imageMetrics(in: splitRightButton.screenshot().image)
    let paneMetrics = try imageMetrics(in: pane.screenshot().image)
    XCTAssertGreaterThan(buttonMetrics.luminanceRange, 0.08)
    XCTAssertLessThanOrEqual(buttonMetrics.dominantRGB.distance(to: paneMetrics.dominantRGB), 2)
  }

  @MainActor
  func testBackgroundOpacityToggleUpdatesTwoWindowsInLightAndDark() async throws {
    try configureBackgroundOpacityProof()

    for appearance in ["light", "dark"] {
      try Data(
        """
        [appearance]
        mode = "\(appearance)"

        """.utf8
      ).write(to: stateHome.appendingPathComponent("settings.toml"))
      try relaunch(removing: ["session.json"])
      _ = mainTerminal
      let initialWindowIdentifier = mainWindow.identifier
      let initialWindow = try opacityWindowIdentity(identifier: initialWindowIdentifier)
      try await requireOpacity(
        in: initialWindow,
        appearance: appearance,
        window: 0,
        isOpaque: false
      )

      try clickMenuItem(.newWindow, timeout: 30)

      let didOpenTwoWindows = await wait(timeout: .seconds(30)) {
        self.app.windows.count == 2 && self.terminalPanes.count == 2
      }
      XCTAssertTrue(didOpenTwoWindows)
      let newWindowIdentifier = try XCTUnwrap(
        app.windows.allElementsBoundByIndex
          .map(\.identifier)
          .first { $0 != initialWindowIdentifier }
      )
      let newWindow = try opacityWindowIdentity(identifier: newWindowIdentifier)
      try await requireOpacity(
        in: newWindow,
        appearance: appearance,
        window: 1,
        isOpaque: false
      )

      try await toggleBackgroundOpacity()

      try await requireOpacity(
        in: newWindow,
        appearance: appearance,
        window: 1,
        isOpaque: true
      )
      try await selectOpacityWindow(initialWindow)
      try await requireOpacity(
        in: initialWindow,
        appearance: appearance,
        window: 0,
        isOpaque: true
      )
    }
  }

  @MainActor
  func testCollapsingSidebarHidesItsHeaderFromDetailPane() async throws {
    _ = mainWindow
    let spaceSwitcher = element(SupatermUITestIdentifier.Accessibility.titlebarSpaceSwitcher)
    let windowControls = [
      app.buttons["Close window"],
      app.buttons["Minimize window"],
      app.buttons["Enter full screen"],
    ]

    let didShowSidebarHeader = await wait(timeout: .seconds(30)) {
      spaceSwitcher.exists
        && spaceSwitcher.isHittable
        && windowControls.allSatisfy { $0.exists && $0.isHittable }
    }
    XCTAssertTrue(didShowSidebarHeader)

    try clickMenuItem(.toggleSidebar)

    let showSidebar = app.buttons["Show sidebar"]
    let didHideSidebarHeader = await wait {
      showSidebar.exists
        && showSidebar.isHittable
        && !spaceSwitcher.isHittable
        && windowControls.allSatisfy { !$0.isHittable }
    }
    XCTAssertTrue(didHideSidebarHeader)
  }

  @MainActor
  func testExitingShellClosesPaneWithoutConfirmation() async throws {
    _ = try await requireVisiblePanes(count: 1)
    let originalIdentifier = terminalPanes.element(boundBy: 0).identifier

    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let newPane = try XCTUnwrap(panes.first { $0.identifier != originalIdentifier })
    newPane.click()
    try await requireFocus(on: newPane)

    newPane.typeText("exit\n")
    let didClosePane = await wait(for: mainWindow, timeout: .seconds(30)) { _ in
      self.terminalPanes.count == 1
        && self.terminalPanes.element(boundBy: 0).identifier == originalIdentifier
    }
    guard didClosePane else {
      XCTFail("Exited pane did not close while preserving its sibling")
      return
    }

    XCTAssertEqual(mainWindow.sheets.count, 0)
    XCTAssertFalse(
      app.buttons[SupatermUITestIdentifier.Accessibility.dialogConfirm].exists
    )

    let survivor = terminalPanes.element(boundBy: 0)
    try await requireFocus(on: survivor)

    let token = UUID().uuidString.prefix(8)
    app.typeText("echo exit-\"close\"-\(token)\n")
    let survivorReceivedInput = await wait(for: survivor, timeout: .seconds(30)) {
      ($0.value as? String)?.contains("exit-close-\(token)") == true
    }
    XCTAssertTrue(survivorReceivedInput)
  }

  @MainActor
  func testToggleSplitZoomFocusesTargetPane() async throws {
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let leftPane = try XCTUnwrap(panes.min { $0.frame.midX < $1.frame.midX })
    let paneIdentifiers = Set(panes.map(\.identifier))

    try clickMenuItem(.selectSplitLeft)
    try await requireFocus(on: leftPane)

    try clickMenuItem(.zoomSplit)
    let zoomedPanes = try await requireVisiblePanes(count: 1)
    XCTAssertEqual(zoomedPanes[0].identifier, leftPane.identifier)
    try await requireFocus(on: leftPane)

    try clickMenuItem(.zoomSplit)
    let restoredPanes = try await requireVisiblePanes(count: 2)
    XCTAssertEqual(Set(restoredPanes.map(\.identifier)), paneIdentifiers)
    try await requireFocus(on: leftPane)
  }

  @MainActor
  func testCommandWClosesFocusedPaneNotWindow() async throws {
    try relaunchWithoutCloseConfirmation()

    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let leftPane = try XCTUnwrap(panes.min { $0.frame.midX < $1.frame.midX })
    let rightPane = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })
    let leftPaneIdentifier = leftPane.identifier

    rightPane.click()
    try await requireFocus(on: rightPane)
    app.typeKey("w", modifierFlags: .command)

    let survivors = try await requireVisiblePanes(count: 1)
    XCTAssertEqual(survivors[0].identifier, leftPaneIdentifier)
    XCTAssertEqual(mainWindow.sheets.count, 0)
    XCTAssertEqual(app.windows.count, 1)
    XCTAssertTrue(mainWindow.exists)
  }

  @MainActor
  func testContextMenuClosesClickedPaneWhenSessionPersistenceIsDisabled() async throws {
    try await assertContextMenuClosesClickedPane(zmxSessionsEnabled: false)
  }

  @MainActor
  func testContextMenuClosesClickedPaneWhenSessionPersistenceIsEnabled() async throws {
    try await assertContextMenuClosesClickedPane(zmxSessionsEnabled: true)
  }

  @MainActor
  private func assertContextMenuClosesClickedPane(zmxSessionsEnabled: Bool) async throws {
    try relaunchWithoutCloseConfirmation(zmxSessionsEnabled: zmxSessionsEnabled)
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let leftPane = try XCTUnwrap(panes.min { $0.frame.midX < $1.frame.midX })
    let rightPane = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })

    rightPane.click()
    try await requireFocus(on: rightPane)
    let marker = "close-pane-ready-\(UUID().uuidString.prefix(8))"
    rightPane.typeText("echo \(marker)\n")
    let shellIsReady = await wait(for: rightPane, timeout: .seconds(30)) {
      ($0.value as? String)?.contains(marker) == true
    }
    XCTAssertTrue(shellIsReady)

    leftPane.click()
    try await requireFocus(on: leftPane)
    rightPane.rightClick()
    let closePane = app.menuItems["Close Pane"].firstMatch
    try require(closePane)
    closePane.click()

    let survivors = try await requireVisiblePanes(count: 1)
    XCTAssertEqual(survivors[0].identifier, leftPane.identifier)
  }

  @MainActor
  func testZoomSplitHidesAndRestoresOtherPane() async throws {
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let paneIdentifiers = Set(panes.map(\.identifier))

    try clickMenuItem(.zoomSplit)

    let zoomedPanes = try await requireVisiblePanes(count: 1)
    XCTAssertTrue(paneIdentifiers.contains(zoomedPanes[0].identifier))

    try clickMenuItem(.zoomSplit)

    let restoredPanes = try await requireVisiblePanes(count: 2)
    XCTAssertEqual(Set(restoredPanes.map(\.identifier)), paneIdentifiers)
  }

  @MainActor
  func testResizeAndEqualizeChangeLayoutWithoutLosingPanes() async throws {
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let leftPane = try XCTUnwrap(panes.min { $0.frame.midX < $1.frame.midX })
    let initialFrame = leftPane.frame
    let paneIdentifiers = Set(panes.map(\.identifier))

    for _ in 0..<3 {
      try clickMenuItem(.moveSplitDividerLeft)
    }

    let didResize = await wait(for: leftPane) {
      $0.exists && $0.frame.width < initialFrame.width - 5
    }
    guard didResize else {
      XCTFail("Split divider did not move left")
      return
    }
    let resizedPanes = try await requireVisiblePanes(count: 2)
    XCTAssertEqual(Set(resizedPanes.map(\.identifier)), paneIdentifiers)

    try clickMenuItem(.equalizeSplits)

    let didEqualize = await wait(for: leftPane) {
      $0.exists && abs($0.frame.width - initialFrame.width) < 2
    }
    XCTAssertTrue(didEqualize)
    let equalizedPanes = try await requireVisiblePanes(count: 2)
    XCTAssertEqual(Set(equalizedPanes.map(\.identifier)), paneIdentifiers)
  }

  @MainActor
  func testClosingBusyPaneRequiresConfirmation() async throws {
    _ = try await requireVisiblePanes(count: 1)
    try clickMenuItem(.splitRight)
    let panes = try await requireVisiblePanes(count: 2)
    let rightPane = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })
    rightPane.click()
    try await requireFocus(on: rightPane)

    let processSentinel = "pane-busy"
    rightPane.typeText("printf '\\033]0;\(processSentinel)\\007'; sleep 600\n")
    let didStartProcess = await wait(for: rightPane, timeout: .seconds(30)) {
      $0.label == processSentinel
    }
    guard didStartProcess else {
      XCTFail("Busy pane process did not start")
      return
    }

    try clickMenuItem(.closeSurface)

    let cancelButton = mainWindow.sheets.firstMatch.buttons["Cancel"]
    guard cancelButton.waitForExistence(timeout: 10) else {
      XCTFail("Close confirmation did not appear")
      return
    }
    cancelButton.click()
    _ = try await requireVisiblePanes(count: 2)

    rightPane.click()
    try await requireFocus(on: rightPane)
    try clickMenuItem(.closeSurface)

    let confirmButton = mainWindow.sheets.firstMatch.buttons["Close"]
    guard confirmButton.waitForExistence(timeout: 10) else {
      XCTFail("Close confirmation did not reappear")
      return
    }
    confirmButton.click()

    _ = try await requireVisiblePanes(count: 1)
  }

  @MainActor
  private func requireVisiblePanes(count expectedCount: Int) async throws -> [XCUIElement] {
    let didReachCount = await wait(for: mainWindow, timeout: .seconds(30)) { _ in
      guard self.terminalPanes.count == expectedCount else { return false }
      return (0..<expectedCount).allSatisfy {
        let pane = self.terminalPanes.element(boundBy: $0)
        return pane.exists && !pane.frame.isEmpty
      }
    }
    return try XCTUnwrap(
      didReachCount
        ? (0..<expectedCount).map { terminalPanes.element(boundBy: $0) }
        : nil,
      "Expected \(expectedCount) visible terminal panes"
    )
  }

  @MainActor
  private func requireFocus(on pane: XCUIElement) async throws {
    let focusedPane = focusedTerminalPanes.matching(identifier: pane.identifier).firstMatch
    let didFocus = await wait(for: focusedPane) { $0.exists }
    XCTAssertTrue(didFocus, "Expected pane \(pane.identifier) to have keyboard focus")
  }

  @MainActor
  private func relaunchWithoutCloseConfirmation(zmxSessionsEnabled: Bool? = nil) throws {
    let ghosttyConfigDirectory = stateHome.appendingPathComponent("ghostty", isDirectory: true)
    try FileManager.default.createDirectory(
      at: ghosttyConfigDirectory,
      withIntermediateDirectories: true
    )
    try Data("confirm-close-surface = false\n".utf8).write(
      to: ghosttyConfigDirectory.appendingPathComponent("config")
    )
    if let zmxSessionsEnabled {
      try Data(
        """
        [terminal]
        zmx_sessions_enabled = \(zmxSessionsEnabled)

        """.utf8
      ).write(to: stateHome.appendingPathComponent("settings.toml"))
    }
    app.launchEnvironment["XDG_CONFIG_HOME"] = stateHome.path
    try relaunch()
  }

  @MainActor
  private func configureBackgroundOpacityProof() throws {
    let ghosttyConfigDirectory = stateHome.appendingPathComponent("ghostty", isDirectory: true)
    try FileManager.default.createDirectory(
      at: ghosttyConfigDirectory,
      withIntermediateDirectories: true
    )
    try Data(
      """
      background = #ff00ff
      background-opacity = 0.6
      keybind = super+shift+b=toggle_background_opacity

      """.utf8
    ).write(to: ghosttyConfigDirectory.appendingPathComponent("config"))
    app.launchEnvironment["XDG_CONFIG_HOME"] = stateHome.path
  }

  @MainActor
  private func opacityPane(in window: OpacityWindowIdentity) -> XCUIElement {
    app.windows.matching(identifier: window.windowIdentifier).firstMatch
      .textViews.matching(identifier: window.paneIdentifier).firstMatch
  }

  @MainActor
  private func opacityWindowIdentity(identifier: String) throws -> OpacityWindowIdentity {
    let window = app.windows.matching(identifier: identifier).firstMatch
    let pane = try require(
      window.textViews.matching(
        NSPredicate(format: "identifier BEGINSWITH %@", Self.paneIdentifierPrefix)
      ).firstMatch,
      timeout: 30
    )
    return OpacityWindowIdentity(
      windowIdentifier: identifier,
      paneIdentifier: pane.identifier
    )
  }

  @MainActor
  private func selectOpacityWindow(_ window: OpacityWindowIdentity) async throws {
    let windowMenu = try require(app.menuBars.menuBarItems["Window"])
    windowMenu.click()
    let windowMenuItems = windowMenu.menus.menuItems.matching(
      identifier: "makeKeyAndOrderFront:"
    )
    let didShowWindowMenuItems = await wait { windowMenuItems.count == 2 }
    XCTAssertTrue(didShowWindowMenuItems)
    let inactiveWindowItem = try XCTUnwrap(
      windowMenuItems.allElementsBoundByIndex.first { !$0.isSelected }
    )
    inactiveWindowItem.click()
    let pane = opacityPane(in: window)
    let didSelectWindow = await wait(for: pane) { $0.exists && $0.isHittable }
    XCTAssertTrue(
      didSelectWindow,
      "Expected pane \(window.paneIdentifier) to become visible"
    )
  }

  @MainActor
  private func toggleBackgroundOpacity() async throws {
    app.typeKey("p", modifierFlags: [.command, .shift])
    let input = try require(
      app.textFields[SupatermUITestIdentifier.Accessibility.paletteInput],
      timeout: 30
    )
    let title = "Toggle Background Opacity"
    input.typeText(title)
    let rows = app.buttons.matching(
      identifier: SupatermUITestIdentifier.Accessibility.paletteResultRow
    )
    let didFindCommand = await wait(for: rows.firstMatch) {
      $0.exists && rows.count == 1 && $0.label.contains(title)
    }
    XCTAssertTrue(didFindCommand)
    app.typeKey(.return, modifierFlags: [])
    let didDismiss = await wait(for: input) { !$0.exists }
    XCTAssertTrue(didDismiss)
  }

  @MainActor
  private func requireOpacity(
    in window: OpacityWindowIdentity,
    appearance: String,
    window windowIndex: Int,
    isOpaque: Bool
  ) async throws {
    let pane = opacityPane(in: window)
    let sample = try await waitForOpacity(in: pane, isOpaque: isOpaque)
    let state = isOpaque ? "opaque" : "transparent"
    let lastRGB = sample.color.map { "\($0.red),\($0.green),\($0.blue)" } ?? "unavailable"
    addOpacityScreenshot(
      sample.screenshot,
      appearance: appearance,
      state: state,
      window: windowIndex
    )
    XCTAssertTrue(
      sample.didReach,
      "Expected window \(windowIndex + 1) to become \(state); last RGB: \(lastRGB)"
    )
  }

  @MainActor
  private func waitForOpacity(
    in pane: XCUIElement,
    isOpaque: Bool
  ) async throws -> OpacitySample {
    var sample: OpacitySample?
    _ = await wait(timeout: .seconds(30), pollInterval: 1) {
      let screenshot = pane.screenshot()
      let color = try? self.imageMetrics(in: screenshot.image).dominantRGB
      let didReach = color.map {
        ($0.distance(to: Self.opacityBackground) <= 8) == isOpaque
      } ?? false
      sample = OpacitySample(didReach: didReach, screenshot: screenshot, color: color)
      return didReach
    }
    return try XCTUnwrap(sample)
  }

  private func addOpacityScreenshot(
    _ screenshot: XCUIScreenshot,
    appearance: String,
    state: String,
    window: Int
  ) {
    let attachment = XCTAttachment(screenshot: screenshot)
    attachment.name = "background-opacity-\(appearance)-\(state)-window-\(window + 1)"
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func imageMetrics(in image: NSImage) throws -> ImageMetrics {
    let representation = try XCTUnwrap(image.tiffRepresentation)
    let bitmap = try XCTUnwrap(NSBitmapImageRep(data: representation))
    var minimum = CGFloat(1)
    var maximum = CGFloat(0)
    var counts: [RGB: Int] = [:]

    for y in 0..<bitmap.pixelsHigh {
      for x in 0..<bitmap.pixelsWide {
        guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else {
          continue
        }
        let rgb = RGB(
          red: Int((color.redComponent * 255).rounded()),
          green: Int((color.greenComponent * 255).rounded()),
          blue: Int((color.blueComponent * 255).rounded())
        )
        let luminance =
          0.2126 * color.redComponent
          + 0.7152 * color.greenComponent
          + 0.0722 * color.blueComponent
        minimum = min(minimum, luminance)
        maximum = max(maximum, luminance)
        counts[rgb, default: 0] += 1
      }
    }

    return try ImageMetrics(
      luminanceRange: maximum - minimum,
      dominantRGB: XCTUnwrap(counts.max { $0.value < $1.value }?.key)
    )
  }
}

private struct OpacityWindowIdentity {
  let windowIdentifier: String
  let paneIdentifier: String
}

private struct OpacitySample {
  let didReach: Bool
  let screenshot: XCUIScreenshot
  let color: RGB?
}

private struct ImageMetrics {
  let luminanceRange: CGFloat
  let dominantRGB: RGB
}

private struct RGB: Hashable {
  let red: Int
  let green: Int
  let blue: Int

  func distance(to other: Self) -> Int {
    max(abs(red - other.red), abs(green - other.green), abs(blue - other.blue))
  }
}
