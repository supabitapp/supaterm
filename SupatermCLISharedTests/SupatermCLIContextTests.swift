import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermCLIContextTests {
  @Test
  func environmentKeysStayStable() {
    #expect(SupatermCLIEnvironment.surfaceIDKey == "SUPATERM_SURFACE_ID")
    #expect(SupatermCLIEnvironment.tabIDKey == "SUPATERM_TAB_ID")
    #expect(SupatermCLIEnvironment.paneSessionNameKey == "SUPATERM_PANE_SESSION")
    #expect(SupatermCLIEnvironment.socketPathKey == "SUPATERM_SOCKET_PATH")
  }

  @Test
  func environmentVariablesExportCurrentPaneIdentifiers() {
    let surfaceID = UUID(uuidString: "A72F7A7D-B5E8-497E-A5D5-D26A77A0A4C7")!
    let tabID = UUID(uuidString: "9F4EB4BE-9216-4DCA-A866-C8276D9EF2AA")!
    let context = SupatermCLIContext(
      surfaceID: surfaceID,
      tabID: tabID,
      paneSessionName: "supaterm.session"
    )

    #expect(
      context.environmentVariables == [
        .init(key: "SUPATERM_SURFACE_ID", value: surfaceID.uuidString),
        .init(key: "SUPATERM_TAB_ID", value: tabID.uuidString),
        .init(key: "SUPATERM_PANE_SESSION", value: "supaterm.session"),
      ]
    )
  }

  @Test
  func environmentParsingRestoresPaneContext() {
    let surfaceID = UUID(uuidString: "D9130D56-7B15-4C76-8A1A-CF4BC0B31155")!
    let tabID = UUID(uuidString: "D556A7EB-6B68-4B90-8948-12FC1871B4AE")!
    let environment = [
      SupatermCLIEnvironment.surfaceIDKey: surfaceID.uuidString,
      SupatermCLIEnvironment.tabIDKey: tabID.uuidString,
      SupatermCLIEnvironment.paneSessionNameKey: "supaterm.session",
    ]

    #expect(
      SupatermCLIContext(environment: environment) == .init(
        surfaceID: surfaceID,
        tabID: tabID,
        paneSessionName: "supaterm.session"
      )
    )
  }

  @Test
  func environmentParsingRejectsMissingOrInvalidIdentifiers() {
    let validID = UUID().uuidString

    #expect(
      SupatermCLIContext(environment: [
        SupatermCLIEnvironment.surfaceIDKey: validID
      ]) == nil
    )
    #expect(
      SupatermCLIContext(environment: [
        SupatermCLIEnvironment.surfaceIDKey: "not-a-uuid",
        SupatermCLIEnvironment.tabIDKey: validID,
      ]) == nil
    )
  }
}
