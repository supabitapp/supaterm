import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct GhosttySurfaceViewEnvironmentTests {
  @Test
  func supatermEnvironmentVariablesIncludePaneSocketAndCliPath() {
    let surfaceID = UUID(uuidString: "A72F7A7D-B5E8-497E-A5D5-D26A77A0A4C7")!
    let tabID = UUID(uuidString: "9F4EB4BE-9216-4DCA-A866-C8276D9EF2AA")!
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: surfaceID,
      tabID: tabID,
      context: .init(
        cliPath: "/Applications/Supaterm.app/Contents/Resources/bin/sp",
        socketPath: "/tmp/supaterm.sock"
      )
    )

    #expect(
      environmentVariables == [
        .init(key: SupatermCLIEnvironment.surfaceIDKey, value: surfaceID.uuidString),
        .init(key: SupatermCLIEnvironment.tabIDKey, value: tabID.uuidString),
        .init(key: SupatermCLIEnvironment.socketPathKey, value: "/tmp/supaterm.sock"),
        .init(key: SupatermCLIEnvironment.cliPathKey, value: "/Applications/Supaterm.app/Contents/Resources/bin/sp"),
      ]
    )
  }

  @Test
  func bundledCLIPathUsesResourcesBinDirectory() {
    #expect(
      GhosttySurfaceView.bundledCLIPath(
        resourcesURL: URL(fileURLWithPath: "/Applications/Supaterm.app/Contents/Resources", isDirectory: true))
        == "/Applications/Supaterm.app/Contents/Resources/bin/sp"
    )
  }
}
