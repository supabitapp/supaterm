import Testing
import SupatermUpdateFeature

@testable import supaterm

struct TerminalSidebarUpdatePresentationTests {
  @Test
  func allPhasesUseRegularRowStyle() {
    let phases: [UpdatePhase] = [
      .permissionRequest,
      .checking,
      .updateAvailable(.init(contentLength: nil, releaseDate: nil, version: "1.2.3")),
      .downloading(.init(expectedLength: 400, progress: 100)),
      .extracting(.init(progress: 0.72)),
      .installing(.init(isAutoUpdate: false)),
      .notFound,
      .error(.init(message: "Network error")),
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
