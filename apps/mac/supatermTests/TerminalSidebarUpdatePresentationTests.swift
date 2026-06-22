import SupatermUpdateFeature
import Testing

@testable import SupatermTerminalUIFeature
@testable import supaterm

struct TerminalSidebarUpdatePresentationTests {
  @Test
  func updateDetailMentionsPreservedSessionsWhenEnabled() {
    let detail = TerminalSidebarUpdatePresentation.detailText(
      for: .installing(UpdatePhase.Installing(isAutoUpdate: true)),
      preservesSessionsOnRestart: true
    )
    let expected = [
      "The update is ready. Restart Supaterm to complete installation.",
      "Your terminal sessions will keep running after restart.",
    ].joined(separator: " ")

    #expect(detail == expected)
  }

  @Test
  func updateDetailOmitsPreservedSessionsWhenDisabled() {
    let detail = TerminalSidebarUpdatePresentation.detailText(
      for: .installing(UpdatePhase.Installing(isAutoUpdate: true)),
      preservesSessionsOnRestart: false
    )

    #expect(detail == "The update is ready. Restart Supaterm to complete installation.")
  }

  @Test
  func inactiveUpdateDetailDoesNotMentionPreservedSessions() {
    let detail = TerminalSidebarUpdatePresentation.detailText(
      for: .notFound,
      preservesSessionsOnRestart: true
    )

    #expect(detail == "You're already running the latest version.")
  }

  @Test
  func allPhasesUseRegularRowStyle() {
    let phases: [UpdatePhase] = [
      .permissionRequest,
      .checking,
      UpdatePhase.updateAvailable(UpdatePhase.Available(contentLength: nil, releaseDate: nil, version: "1.2.3")),
      UpdatePhase.downloading(UpdatePhase.Downloading(expectedLength: 400, progress: 100)),
      UpdatePhase.extracting(UpdatePhase.Extracting(progress: 0.72)),
      UpdatePhase.installing(UpdatePhase.Installing(isAutoUpdate: false)),
      .notFound,
      UpdatePhase.error(UpdatePhase.Failure(message: "Network error")),
    ]

    for phase in phases {
      #expect(
        !TerminalSidebarUpdatePresentation.usesSelectedRowStyle(
          for: phase
        )
      )
    }
  }
}
