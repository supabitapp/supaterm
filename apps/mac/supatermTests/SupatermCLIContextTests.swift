import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermCLIContextTests {
  @Test
  func environmentKeysStayStable() {
    #expect(SupatermCLIEnvironment.cliPathKey == "SUPATERM_CLI_PATH")
    #expect(SupatermCLIEnvironment.stateHomeKey == "SUPATERM_STATE_HOME")
    #expect(SupatermCLIEnvironment.surfaceIDKey == "SUPATERM_SURFACE_ID")
    #expect(SupatermCLIEnvironment.tabIDKey == "SUPATERM_TAB_ID")
    #expect(SupatermCLIEnvironment.windowIDKey == "SUPATERM_WINDOW_ID")
    #expect(SupatermCLIEnvironment.socketPathKey == "SUPATERM_SOCKET_PATH")
  }

  @Test
  func environmentVariablesExportCurrentPaneIdentifiers() {
    let windowID = UUID(uuidString: "83926489-14C6-4D6E-9404-D4DF1D0FB841")!
    let surfaceID = UUID(uuidString: "A72F7A7D-B5E8-497E-A5D5-D26A77A0A4C7")!
    let tabID = UUID(uuidString: "9F4EB4BE-9216-4DCA-A866-C8276D9EF2AA")!
    let context = SupatermCLIContext(windowID: windowID, surfaceID: surfaceID, tabID: tabID)

    #expect(
      context.environmentVariables == [
        SupatermCLIEnvironmentVariable(key: "SUPATERM_WINDOW_ID", value: windowID.uuidString),
        SupatermCLIEnvironmentVariable(key: "SUPATERM_SURFACE_ID", value: surfaceID.uuidString),
        SupatermCLIEnvironmentVariable(key: "SUPATERM_TAB_ID", value: tabID.uuidString),
      ]
    )
  }

  @Test
  func environmentParsingRestoresPaneContext() {
    let windowID = UUID(uuidString: "F76DA2D2-C2B9-421F-A4C5-E4F3C126DBE5")!
    let surfaceID = UUID(uuidString: "D9130D56-7B15-4C76-8A1A-CF4BC0B31155")!
    let tabID = UUID(uuidString: "D556A7EB-6B68-4B90-8948-12FC1871B4AE")!
    let environment = [
      SupatermCLIEnvironment.windowIDKey: windowID.uuidString,
      SupatermCLIEnvironment.surfaceIDKey: surfaceID.uuidString,
      SupatermCLIEnvironment.tabIDKey: tabID.uuidString,
    ]

    #expect(
      SupatermCLIContext(environment: environment)
        == SupatermCLIContext(windowID: windowID, surfaceID: surfaceID, tabID: tabID)
    )
  }

  @Test
  func environmentParsingRejectsMissingOrInvalidIdentifiers() {
    let validID = UUID().uuidString

    #expect(
      SupatermCLIContext(environment: [
        SupatermCLIEnvironment.surfaceIDKey: validID,
        SupatermCLIEnvironment.tabIDKey: validID,
      ]) == nil
    )
    #expect(
      SupatermCLIContext(environment: [
        SupatermCLIEnvironment.windowIDKey: validID,
        SupatermCLIEnvironment.surfaceIDKey: validID,
      ]) == nil
    )
    #expect(
      SupatermCLIContext(environment: [
        SupatermCLIEnvironment.windowIDKey: validID,
        SupatermCLIEnvironment.surfaceIDKey: "not-a-uuid",
        SupatermCLIEnvironment.tabIDKey: validID,
      ]) == nil
    )
  }
}
