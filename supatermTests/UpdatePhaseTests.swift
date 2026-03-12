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
  }

  @Test
  func nonErrorPhasesUseAccentTone() {
    #expect(UpdatePhase.checking.pillTone == .accent)
    #expect(UpdatePhase.notFound.pillTone == .accent)
  }

  @Test
  func errorPhaseUsesWarningTone() {
    #expect(UpdatePhase.error("Network error").pillTone == .warning)
    #expect(UpdatePhase.error("Network error").text == "Network error")
  }

  @Test
  func downloadingPhaseDisablesPopover() {
    #expect(UpdatePhase.downloading(.init(expectedLength: 1_000, receivedLength: 500)).allowsPopover == false)
    #expect(UpdatePhase.checking.allowsPopover)
  }
}
