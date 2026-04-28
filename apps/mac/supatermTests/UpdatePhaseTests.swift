import Foundation
import SupatermUpdateFeature
import Testing

@testable import supaterm

struct UpdatePhaseTests {
  @Test
  func backgroundUpdateFoundIsDismissedSilently() {
    #expect(
      UpdatePresentation.foundDecision(userInitiated: false)
        == .dismissSilently
    )
  }

  @Test
  func userInitiatedUpdateFoundIsPresented() {
    #expect(
      UpdatePresentation.foundDecision(userInitiated: true)
        == .present
    )
  }

  @Test
  func userInitiatedUpdateUsesSidebarWhenWindowIsAvailable() {
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
        buildVersion: "1000",
        contentLength: 1024,
        releaseDate: Date(timeIntervalSince1970: 0),
        version: "1.2.3"
      )
    )

    #expect(phase.summaryText == "Update Available")
    #expect(phase.badgeText == "1.2.3 (1000)")
    #expect(phase.detailMessage == "Supaterm 1.2.3 (1000) is ready to download and install.")
    #expect(phase.debugIdentifier == "update_available")
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
        buildVersion: "1000",
        isAutoUpdate: true,
        version: "1.2.3"
      )
    )

    #expect(phase.summaryText == "Restart to Complete Update")
    #expect(phase.detailMessage == "Updated to 1.2.3 (1000). Restart Supaterm to complete installation.")
    #expect(phase.bypassesQuitConfirmation)
    #expect(phase.debugIdentifier == "installing")
  }

  @Test
  func autoUpdateInstallingKeepsRestartMenuActionWhileHidingSidebarSection() {
    let phase = UpdatePhase.installing(UpdatePhase.Installing(isAutoUpdate: true))

    #expect(!phase.showsSidebarSection)
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
}
