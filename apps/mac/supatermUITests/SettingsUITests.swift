import Foundation
import XCTest

final class SettingsUITests: SupatermUITestCase {
  @MainActor
  func testCommandCommaOpensSettingsAndEveryTabShowsItsControls() async throws {
    let settingsWindow = try openSettings()

    for identifier in SettingsIdentifier.sidebarTabs {
      XCTAssertTrue(element(identifier, in: settingsWindow).waitForExistence(timeout: 10))
    }

    for tab in SettingsTab.allCases {
      let sidebarTab = element(tab.sidebarIdentifier, in: settingsWindow)
      sidebarTab.click()

      let keyControl = element(tab.keyControlIdentifier, in: settingsWindow)
      let didShowKeyControl = await wait(for: keyControl) { $0.exists }
      XCTAssertTrue(didShowKeyControl, "\(tab.rawValue) did not show its key control")
    }
  }

  @MainActor
  func testRestoreTerminalLayoutPersistsAcrossRelaunch() async throws {
    let settingsWindow = try openSettings()
    try await select(.general, in: settingsWindow)

    let toggle = element(SettingsIdentifier.restoreTerminalLayout, in: settingsWindow)
    let didLoadEnabledToggle = await wait(for: toggle) { self.toggleState($0) == true }
    XCTAssertTrue(didLoadEnabledToggle)
    toggle.click()
    let didDisableToggle = await wait(for: toggle) { self.toggleState($0) == false }
    XCTAssertTrue(didDisableToggle)
    let didPersistSetting = await waitForSettingsFile(containing: "restore_layout = false")
    XCTAssertTrue(didPersistSetting)

    try relaunchPreservingState()

    let relaunchedSettingsWindow = try openSettings()
    try await select(.general, in: relaunchedSettingsWindow)
    let persistedToggle = element(
      SettingsIdentifier.restoreTerminalLayout,
      in: relaunchedSettingsWindow
    )
    let didRestoreDisabledToggle = await wait(for: persistedToggle) {
      self.toggleState($0) == false
    }
    XCTAssertTrue(didRestoreDisabledToggle)
  }

  @MainActor
  func testAppearanceModeSwitchesBetweenEveryOptionAndPersists() async throws {
    let settingsWindow = try openSettings()
    try await select(.general, in: settingsWindow)

    let light = element(SettingsIdentifier.appearanceLight, in: settingsWindow)
    let dark = element(SettingsIdentifier.appearanceDark, in: settingsWindow)
    let auto = element(SettingsIdentifier.appearanceAuto, in: settingsWindow)
    for option in [light, dark, auto] {
      XCTAssertTrue(option.waitForExistence(timeout: 10))
    }

    light.click()
    let didSelectLight = await waitForSelection(light)
    XCTAssertTrue(didSelectLight)
    dark.click()
    let didSelectDark = await waitForSelection(dark)
    XCTAssertTrue(didSelectDark)
    auto.click()
    let didSelectAuto = await waitForSelection(auto)
    XCTAssertTrue(didSelectAuto)
    let didPersistSetting = await waitForSettingsFile(containing: "mode = \"system\"")
    XCTAssertTrue(didPersistSetting)

    try relaunchPreservingState()

    let relaunchedSettingsWindow = try openSettings()
    try await select(.general, in: relaunchedSettingsWindow)
    let persistedAuto = element(SettingsIdentifier.appearanceAuto, in: relaunchedSettingsWindow)
    let didRestoreAuto = await waitForSelection(persistedAuto)
    XCTAssertTrue(didRestoreAuto)
  }

  @MainActor
  func testAboutShowsVersionAndUpdateControls() async throws {
    let settingsWindow = try openSettings()
    try await select(.about, in: settingsWindow)

    let version = element(SettingsIdentifier.aboutVersion, in: settingsWindow)
    XCTAssertTrue(version.waitForExistence(timeout: 10))
    let versionValue = version.value as? String
    XCTAssertFalse(versionValue?.isEmpty ?? true)
    XCTAssertNotEqual(versionValue, "Unknown Version")
    XCTAssertTrue(
      element(SettingsIdentifier.checkForUpdates, in: settingsWindow)
        .waitForExistence(timeout: 10)
    )
    XCTAssertTrue(
      element(SettingsIdentifier.updateChannel, in: settingsWindow)
        .waitForExistence(timeout: 10)
    )
    XCTAssertTrue(
      element(SettingsIdentifier.automaticallyCheckForUpdates, in: settingsWindow)
        .waitForExistence(timeout: 10)
    )
  }

  @MainActor
  private func openSettings() throws -> XCUIElement {
    _ = mainWindow
    app.typeKey(",", modifierFlags: .command)

    let settingsWindow = app.windows.matching(
      identifier: SettingsIdentifier.window
    ).firstMatch
    return try XCTUnwrap(
      settingsWindow.waitForExistence(timeout: 10) ? settingsWindow : nil
    )
  }

  @MainActor
  private func select(
    _ tab: SettingsTab,
    in settingsWindow: XCUIElement
  ) async throws {
    let sidebarTab = element(tab.sidebarIdentifier, in: settingsWindow)
    try XCTUnwrap(sidebarTab.waitForExistence(timeout: 10) ? sidebarTab : nil)
    sidebarTab.click()

    let keyControl = element(tab.keyControlIdentifier, in: settingsWindow)
    let didShowKeyControl = await wait(for: keyControl) { $0.exists }
    try XCTUnwrap(didShowKeyControl ? keyControl : nil)
  }

  @MainActor
  private func element(
    _ identifier: String,
    in settingsWindow: XCUIElement
  ) -> XCUIElement {
    settingsWindow.descendants(matching: .any)
      .matching(identifier: identifier)
      .firstMatch
  }

  @MainActor
  private func waitForSelection(_ element: XCUIElement) async -> Bool {
    await wait(for: element) { $0.value as? String == "selected" }
  }

  @MainActor
  private func toggleState(_ element: XCUIElement) -> Bool? {
    if let value = element.value as? NSNumber {
      return value.boolValue
    }
    guard let value = element.value as? String else {
      return nil
    }
    switch value.lowercased() {
    case "0", "false", "off":
      return false
    case "1", "true", "on":
      return true
    default:
      return nil
    }
  }

  @MainActor
  private func waitForSettingsFile(
    containing expectedText: String,
    timeout: Duration = .seconds(10)
  ) async -> Bool {
    guard let settingsURL else { return false }

    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
      if settingsFile(at: settingsURL, contains: expectedText) {
        return true
      }
      try? await Task.sleep(for: .milliseconds(100))
    }
    return settingsFile(at: settingsURL, contains: expectedText)
  }

  @MainActor
  private var settingsURL: URL? {
    if let stateHome = app.launchEnvironment["SUPATERM_STATE_HOME"] {
      return URL(fileURLWithPath: stateHome, isDirectory: true)
        .appendingPathComponent("settings.toml", isDirectory: false)
    }
    guard let home = app.launchEnvironment["HOME"] else { return nil }
    return URL(fileURLWithPath: home, isDirectory: true)
      .appendingPathComponent(".config/supaterm/settings.toml", isDirectory: false)
  }

  private func settingsFile(at url: URL, contains expectedText: String) -> Bool {
    guard let data = try? Data(contentsOf: url),
      let contents = String(data: data, encoding: .utf8)
    else {
      return false
    }
    return contents.contains(expectedText)
  }

  @MainActor
  private func relaunchPreservingState() throws {
    app.terminate()
    try XCTUnwrap(app.wait(for: .notRunning, timeout: 10) ? app : nil)
    app.launch()
    app.activate()
    try XCTUnwrap(app.wait(for: .runningForeground, timeout: 30) ? app : nil)
  }
}

private enum SettingsIdentifier {
  static let window = "app.supabit.supaterm.window.settings"
  static let restoreTerminalLayout = "settings.general.restore-terminal-layout"
  static let appearanceAuto = "settings.general.appearance.system"
  static let appearanceLight = "settings.general.appearance.light"
  static let appearanceDark = "settings.general.appearance.dark"
  static let aboutVersion = "settings.about.version"
  static let checkForUpdates = "settings.about.check-for-updates"
  static let updateChannel = "settings.about.update-channel"
  static let automaticallyCheckForUpdates = "settings.about.automatically-check-for-updates"
  static let sidebarTabs = SettingsTab.allCases.map(\.sidebarIdentifier)
}

private enum SettingsTab: String, CaseIterable {
  case general
  case terminal
  case notifications
  case codingAgents
  case advanced
  case about

  var sidebarIdentifier: String {
    "settings.sidebar.\(rawValue)"
  }

  var keyControlIdentifier: String {
    switch self {
    case .general:
      SettingsIdentifier.restoreTerminalLayout
    case .terminal:
      "settings.terminal.font"
    case .notifications:
      "settings.notifications.system"
    case .codingAgents:
      "settings.coding-agents.show-panel"
    case .advanced:
      "settings.advanced.verbose-logging"
    case .about:
      SettingsIdentifier.aboutVersion
    }
  }
}
