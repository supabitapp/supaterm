import SupatermUpdateFeature
import Testing

@testable import supaterm

struct TerminalSidebarUpdatePresentationTests {
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
