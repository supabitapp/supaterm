import AppKit
import Foundation
import XCTest

final class PaneChromeUITests: SupatermUITestCase {
  @MainActor
  func testEachPaneKeepsDedicatedTopBarTitle() async throws {
    let leftPane = try await requireVisiblePanes(count: 1)[0]
    let leftToolbar = try paneToolbar(for: leftPane)
    leftPane.click()
    try await requireFocus(on: leftPane)

    let leftTitle = "pane-title-L-\(UUID().uuidString.prefix(8))"
    leftPane.typeText("printf '\\033]0;\(leftTitle)\\007'; sleep 600\n")
    let didSetLeftTitle = await wait(for: leftPane, timeout: .seconds(30)) {
      $0.label == leftTitle
    }
    XCTAssertTrue(didSetLeftTitle)

    let hideSidebarButton = app.buttons["Hide sidebar"]
    try require(hideSidebarButton)
    hideSidebarButton.click()
    let didCollapseSidebar = await waitForSidebarCollapsed()
    XCTAssertTrue(didCollapseSidebar)

    let didShowLeftTitle = await wait { leftToolbar.staticTexts[leftTitle].exists }
    XCTAssertTrue(didShowLeftTitle)

    let splitRightButton = element("\(leftToolbar.identifier).split-right")
    try require(splitRightButton)
    splitRightButton.click()
    let panes = try await requireVisiblePanes(count: 2)
    let updatedLeftPane = try XCTUnwrap(panes.min { $0.frame.midX < $1.frame.midX })
    let rightPane = try XCTUnwrap(panes.max { $0.frame.midX < $1.frame.midX })
    let updatedLeftToolbar = try paneToolbar(for: updatedLeftPane)
    let rightToolbar = try paneToolbar(for: rightPane)
    try await requireFocus(on: rightPane)

    XCTAssertEqual(
      rightPane.frame.minX - updatedLeftPane.frame.maxX,
      6,
      accuracy: 1
    )

    let rightTitle = "pane-title-R-\(UUID().uuidString.prefix(8))"
    rightPane.typeText("printf '\\033]0;\(rightTitle)\\007'; sleep 600\n")
    let didSetRightTitle = await wait(for: rightPane, timeout: .seconds(30)) {
      $0.label == rightTitle
    }
    XCTAssertTrue(didSetRightTitle)

    let didShowRightTitle = await wait { rightToolbar.staticTexts[rightTitle].exists }
    XCTAssertTrue(didShowRightTitle)
    XCTAssertTrue(updatedLeftToolbar.staticTexts[leftTitle].exists)

    updatedLeftPane.click()
    try await requireFocus(on: updatedLeftPane)
    XCTAssertTrue(updatedLeftToolbar.staticTexts[leftTitle].exists)
    XCTAssertTrue(rightToolbar.staticTexts[rightTitle].exists)

    rightPane.click()
    try await requireFocus(on: rightPane)
    XCTAssertTrue(updatedLeftToolbar.staticTexts[leftTitle].exists)
    XCTAssertTrue(rightToolbar.staticTexts[rightTitle].exists)

    updatedLeftPane.click()
    app.typeKey("c", modifierFlags: .control)
    rightPane.click()
    app.typeKey("c", modifierFlags: .control)
  }

  @MainActor
  func testTopBarRendersSplitButtonOverTerminalBackground() async throws {
    let pane = try await requireVisiblePanes(count: 1)[0]
    let toolbar = try paneToolbar(for: pane)

    let splitRightButton = element("\(toolbar.identifier).split-right")
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
  func testCollapsingSidebarHidesItsHeaderFromDetailPane() async throws {
    _ = mainWindow
    let spaceSwitcher = element(SupatermUITestIdentifier.Accessibility.titlebarSpaceSwitcher)

    let didShowSidebarHeader = await wait(timeout: .seconds(30)) {
      spaceSwitcher.exists
        && spaceSwitcher.isHittable
    }
    XCTAssertTrue(didShowSidebarHeader)

    app.typeKey("s", modifierFlags: .command)

    let didHideSidebarHeader = await wait {
      !self.sidebarTabRows.firstMatch.isHittable
        && !spaceSwitcher.isHittable
    }
    XCTAssertTrue(didHideSidebarHeader)
  }

  @MainActor
  private func paneToolbar(for pane: XCUIElement) throws -> XCUIElement {
    let panePrefix = SupatermUITestIdentifier.Accessibility.terminalPanePrefix
    let paneID = try XCTUnwrap(
      pane.identifier.hasPrefix(panePrefix)
        ? String(pane.identifier.dropFirst(panePrefix.count))
        : nil
    )
    return element("\(SupatermUITestIdentifier.Accessibility.terminalPaneToolbarPrefix)\(paneID)")
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
