import Testing

@testable import supaterm

struct UpdatePhaseTests {
  @Test
  func downloadingPhaseFormatsProgress() {
    let phase = UpdatePhase.downloading(
      .init(expectedLength: 1_000, receivedLength: 500)
    )

    #expect(phase.badge == .progress(0.5))
    #expect(phase.maxText == "Downloading: 100%")
    #expect(phase.text == "Downloading: 50%")
  }

  @Test
  func extractingPhaseFormatsProgress() {
    let phase = UpdatePhase.extracting(0.75)

    #expect(phase.badge == .progress(0.75))
    #expect(phase.maxText == "Preparing: 100%")
    #expect(phase.text == "Preparing: 75%")
    #expect(phase.menuItemText == "Preparing: 75%")
  }

  @Test
  func nonErrorPhasesUseAccentTone() {
    #expect(UpdatePhase.checking.pillTone == .accent)
    #expect(UpdatePhase.notFound.pillTone == .accent)
  }

  @Test
  func menuItemTextFallsBackWhenNoActiveUpdateStatusShouldBeShown() {
    #expect(UpdatePhase.idle.menuItemText == "Check for Updates...")
    #expect(UpdatePhase.permissionRequest.menuItemText == "Check for Updates...")
    #expect(UpdatePhase.error("Network error").menuItemText == "Check for Updates...")
  }

  @Test
  func menuItemTextShowsActiveUpdateState() {
    #expect(UpdatePhase.checking.menuItemText == "Checking for Updates…")
    #expect(
      UpdatePhase.downloading(.init(expectedLength: 1_000, receivedLength: 500)).menuItemText
        == "Downloading: 50%")
    #expect(
      UpdatePhase.updateAvailable(
        .init(contentLength: nil, publishedAt: nil, releaseNotesURL: nil, version: "1.2.3")
      ).menuItemText == "Update Available: 1.2.3")
    #expect(
      UpdatePhase.installing(.init(canInstallNow: true)).menuItemText
        == "Restart to Complete Update")
  }

  @Test
  func errorPhaseUsesWarningTone() {
    #expect(UpdatePhase.error("Network error").pillTone == .warning)
    #expect(UpdatePhase.error("Network error").text == "Network error")
  }

  @Test
  func transientPhasesDisablePopover() {
    #expect(UpdatePhase.checking.allowsPopover == false)
    #expect(UpdatePhase.downloading(.init(expectedLength: 1_000, receivedLength: 500)).allowsPopover == false)
    #expect(UpdatePhase.extracting(0.5).allowsPopover == false)
    #expect(
      UpdatePhase.updateAvailable(.init(contentLength: nil, publishedAt: nil, releaseNotesURL: nil, version: "1.0"))
        .allowsPopover)
  }

  @Test
  func onlyInstallingPhaseBypassesQuitConfirmation() {
    #expect(UpdatePhase.idle.bypassesQuitConfirmation == false)
    #expect(UpdatePhase.checking.bypassesQuitConfirmation == false)
    #expect(UpdatePhase.installing(.init(canInstallNow: true)).bypassesQuitConfirmation)
  }
}
