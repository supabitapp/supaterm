import Foundation
import SupatermSupport
import Testing

@testable import SupatermUpdateFeature
@testable import supaterm

struct UpdatePhaseTests {
  @Test
  func updateUsesSidebarWhenWindowIsAvailable() {
    #expect(
      UpdatePresentation.mode(
        hasUnobtrusiveTarget: true
      ) == .sidebar
    )
  }

  @Test
  func updateFallsBackToStandardWhenNoWindowIsAvailable() {
    #expect(
      UpdatePresentation.mode(
        hasUnobtrusiveTarget: false
      ) == .standard
    )
  }

  @Test
  func updateAvailableUsesVersionBadgeAndDetail() {
    let phase = UpdatePhase.updateAvailable(
      UpdatePhase.Available(
        buildVersion: "35000",
        contentLength: 1024,
        releaseDate: Date(timeIntervalSince1970: 0),
        version: "26.0.0"
      )
    )

    #expect(phase.summaryText == "Update Available")
    #expect(phase.badgeText == "26.0.0 (35000)")
    #expect(phase.detailMessage == "Supaterm 26.0.0 (35000) is ready to download and install.")
    #expect(phase.debugIdentifier == "update_available")
  }

  @Test
  func updateAvailableOffersNextRestartInstall() {
    let phase = UpdatePhase.updateAvailable(
      UpdatePhase.Available(contentLength: nil, releaseDate: nil, version: "1.2.3")
    )

    #expect(
      phase.actionPresentations.map(\.title)
        == ["Skip", "Install after next restart", "Install and Relaunch"]
    )
    #expect(
      phase.actionPresentations.map(\.action)
        == [.skipVersion, .installAfterNextRestart, .install]
    )
  }

  @Test
  func downloadingExposesProgressTextAndValue() {
    let phase = UpdatePhase.downloading(
      UpdatePhase.Downloading(
        expectedLength: 400,
        progress: 100
      )
    )

    #expect(phase.summaryText == "Downloading Update")
    #expect(phase.badgeText == "25%")
    #expect(phase.progressValue == 0.25)
    #expect(phase.debugIdentifier == "downloading")
  }

  @Test
  func installingBypassesQuitConfirmation() {
    let phase = UpdatePhase.installing(
      UpdatePhase.Installing(
        buildVersion: "35000",
        isAutoUpdate: true,
        version: "26.0.0"
      )
    )

    #expect(phase.summaryText == "Restart to Complete Update")
    #expect(phase.detailMessage == "Updated to 26.0.0 (35000). Restart Supaterm to complete installation.")
    #expect(phase.bypassesQuitConfirmation)
    #expect(phase.debugIdentifier == "installing")
  }

  @Test
  func autoUpdateInstallingShowsRestartPrompt() {
    let phase = UpdatePhase.installing(UpdatePhase.Installing(isAutoUpdate: true))

    #expect(phase.showsSidebarSection)
    #expect(phase.actionPresentations.map(\.title) == ["Restart Later", "Restart Now"])
    #expect(phase.menuItemAction == .restartNow)
    #expect(phase.menuItemTitle == "Restart to Update...")
    #expect(phase.bypassesQuitConfirmation)
  }

  @Test
  func deferredAutoUpdateInstallingKeepsRestartMenuActionWhileHidingSidebarSection() {
    let phase = UpdatePhase.installing(UpdatePhase.Installing(isAutoUpdate: true, showsPrompt: false))

    #expect(!phase.showsSidebarSection)
    #expect(phase.actionPresentations.isEmpty)
    #expect(phase.menuItemAction == .restartNow)
    #expect(phase.menuItemTitle == "Restart to Update...")
    #expect(phase.bypassesQuitConfirmation)
  }

  @Test
  func manualInstallingKeepsSidebarSectionVisible() {
    let phase = UpdatePhase.installing(UpdatePhase.Installing(isAutoUpdate: false))

    #expect(phase.showsSidebarSection)
    #expect(phase.menuItemAction == .restartNow)
  }

  @Test
  func installingFallsBackWhenUpdatedVersionIsUnavailable() {
    let phase = UpdatePhase.installing(UpdatePhase.Installing(isAutoUpdate: true))

    #expect(phase.detailMessage == "The update is ready. Restart Supaterm to complete installation.")
  }

  @Test
  func errorUsesFailureMessageAsDetail() {
    let phase = UpdatePhase.error(UpdatePhase.Failure(message: "Network error"))

    #expect(phase.summaryText == "Update Failed")
    #expect(phase.detailMessage == "Network error")
    #expect(phase.badgeText == nil)
    #expect(phase.debugIdentifier == "error")
  }

  @Test
  func ownershipEndedOffersRenewalWithoutInstallation() throws {
    let phase = UpdatePhase.ownershipEnded(
      UpdatePhase.OwnershipEnded(
        licenseID: "00112233445566778899aabbccddeeff",
        updatesThrough: try #require(LicenseDay("2026-08-21")),
        version: "26.4.0"
      )
    )

    #expect(phase.summaryText(salesEnabled: true) == "Renew to Update")
    #expect(
      phase.detailMessage(salesEnabled: true)
        == "Supaterm 26.4.0 is out. Your updates ended 2026-08-21 — renew to update."
    )
    #expect(phase.summaryText(salesEnabled: false) == "Update Not Included")
    #expect(
      phase.detailMessage(salesEnabled: false)
        == "Supaterm 26.4.0 is out. Your updates ended 2026-08-21. You can keep using your current version."
    )
    #expect(phase.presentations(salesEnabled: false).map(\.action) == [.dismiss])
    #expect(
      phase.presentations(salesEnabled: true).map(\.action) == [.dismiss, .renewUpdates]
    )
    #expect(phase.debugIdentifier == "ownership_ended")
  }
}
