import Foundation
import XCTest

final class PaneClosingUITests: SupatermUITestCase {
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
    XCTAssertFalse(element(SupatermUITestIdentifier.Accessibility.dialogSurface).exists)
    XCTAssertEqual(app.windows.count, 1)
    XCTAssertTrue(mainWindow.exists)
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

    let cancelButton = app.buttons[SupatermUITestIdentifier.Accessibility.dialogCancel]
    guard cancelButton.waitForExistence(timeout: 10) else {
      XCTFail("Close confirmation did not appear")
      return
    }
    attachAppScreenshot(named: "dialog-close-busy-pane")
    cancelButton.click()
    _ = try await requireVisiblePanes(count: 2)

    rightPane.click()
    try await requireFocus(on: rightPane)
    try clickMenuItem(.closeSurface)

    let confirmButton = app.buttons[SupatermUITestIdentifier.Accessibility.dialogConfirm]
    guard confirmButton.waitForExistence(timeout: 10) else {
      XCTFail("Close confirmation did not reappear")
      return
    }
    confirmButton.click()

    _ = try await requireVisiblePanes(count: 1)
  }
}
