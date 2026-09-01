import XCTest

extension SupatermUITestCase {
  @MainActor
  func activateUITestLicense() async throws -> XCUIElement {
    _ = mainWindow
    app.typeKey(",", modifierFlags: .command)

    let settingsWindow = app.windows.matching(
      identifier: SupatermUITestIdentifier.Settings.window
    ).firstMatch
    try require(settingsWindow)

    let licenseTab = element(
      SupatermUITestIdentifier.Settings.sidebar("license"),
      in: settingsWindow
    )
    try require(licenseTab)
    licenseTab.click()

    let key = element(SupatermUITestIdentifier.Settings.licenseKey, in: settingsWindow)
    try require(key)
    key.click()
    key.typeText(SupatermUITestLicense.key)

    let activate = element(
      SupatermUITestIdentifier.Settings.licenseActivate,
      in: settingsWindow
    )
    let didEnableActivation = await wait(for: activate) { $0.exists && $0.isEnabled }
    _ = try XCTUnwrap(didEnableActivation ? activate : nil)
    activate.click()
    app.activate()

    let deactivate = element(
      SupatermUITestIdentifier.Settings.licenseDeactivate,
      in: settingsWindow
    )
    let didActivate = await wait(for: deactivate) { $0.exists && $0.isEnabled }
    _ = try XCTUnwrap(didActivate ? deactivate : nil)
    return settingsWindow
  }
}

private enum SupatermUITestLicense {
  static let key = "SUPATERM-AAAAAAAAAAAAAAAAAAAAAAAAAA-AAAAAAAAAAAAAAAAAAAAAAAAAA"
}
