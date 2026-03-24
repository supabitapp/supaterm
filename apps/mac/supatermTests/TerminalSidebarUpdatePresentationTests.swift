import Testing

@testable import supaterm

struct TerminalSidebarUpdatePresentationTests {
  @Test
  func permissionRequestUsesSelectedRowStyle() {
    #expect(
      TerminalSidebarUpdatePresentation.usesSelectedRowStyle(
        for: .permissionRequest
      )
    )
  }

  @Test
  func updateAvailableUsesSelectedRowStyle() {
    #expect(
      TerminalSidebarUpdatePresentation.usesSelectedRowStyle(
        for: .updateAvailable(.init(contentLength: nil, releaseDate: nil, version: "1.2.3"))
      )
    )
  }

  @Test
  func installingUsesSelectedRowStyle() {
    #expect(
      TerminalSidebarUpdatePresentation.usesSelectedRowStyle(
        for: .installing(.init(isAutoUpdate: false))
      )
    )
  }

  @Test
  func transientAndResultPhasesUseRegularRowStyle() {
    #expect(
      !TerminalSidebarUpdatePresentation.usesSelectedRowStyle(
        for: .checking
      )
    )
    #expect(
      !TerminalSidebarUpdatePresentation.usesSelectedRowStyle(
        for: .downloading(.init(expectedLength: 400, progress: 100))
      )
    )
    #expect(
      !TerminalSidebarUpdatePresentation.usesSelectedRowStyle(
        for: .error(.init(message: "Network error"))
      )
    )
    #expect(
      !TerminalSidebarUpdatePresentation.usesSelectedRowStyle(
        for: .notFound
      )
    )
  }
}
