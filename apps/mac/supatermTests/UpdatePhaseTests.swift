import Foundation
import Testing

@testable import supaterm

struct UpdatePhaseTests {
  @Test
  func updateAvailableUsesVersionBadgeAndDetail() {
    let phase = UpdatePhase.updateAvailable(
      .init(
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
      .init(
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
    let phase = UpdatePhase.installing(.init(isAutoUpdate: true))

    #expect(phase.summaryText == "Restart to Complete Update")
    #expect(phase.detailMessage == "The update is ready. Restart Supaterm to complete installation.")
    #expect(phase.bypassesQuitConfirmation)
    #expect(phase.debugIdentifier == "installing")
  }

  @Test
  func deferredRestartKeepsRestartMenuActionWhileHidingSidebarSection() {
    let phase = UpdatePhase.installing(.init(isAutoUpdate: true, showsPrompt: false))

    #expect(!phase.showsSidebarSection)
    #expect(phase.menuItemAction == .restartNow)
    #expect(phase.menuItemTitle == "Restart to Update...")
    #expect(phase.bypassesQuitConfirmation)
  }

  @Test
  func errorUsesFailureMessageAsDetail() {
    let phase = UpdatePhase.error(.init(message: "Network error"))

    #expect(phase.summaryText == "Update Failed")
    #expect(phase.detailMessage == "Network error")
    #expect(phase.badgeText == nil)
    #expect(phase.debugIdentifier == "error")
  }
}
