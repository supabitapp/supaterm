import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct GhosttySurfaceViewEnvironmentTests {
  @Test
  func supatermEnvironmentVariablesIncludePaneSocketCliAndPrependedAppPaths() {
    let surfaceID = UUID(uuidString: "A72F7A7D-B5E8-497E-A5D5-D26A77A0A4C7")!
    let tabID = UUID(uuidString: "9F4EB4BE-9216-4DCA-A866-C8276D9EF2AA")!
    let path = [
      "/Applications/Supaterm.app/Contents/MacOS",
      "/Applications/Supaterm.app/Contents/Resources/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].joined(separator: ":")
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: surfaceID,
      tabID: tabID,
      context: .init(
        claudeWrapperDirectory: "/Applications/Supaterm.app/Contents/Resources/bin",
        cliPath: "/Applications/Supaterm.app/Contents/MacOS/sp",
        processEnvironment: ["PATH": "/usr/local/bin:/usr/bin:/bin"],
        socketPath: "/tmp/supaterm.sock"
      )
    )

    #expect(
      environmentVariables == [
        .init(key: SupatermCLIEnvironment.surfaceIDKey, value: surfaceID.uuidString),
        .init(key: SupatermCLIEnvironment.tabIDKey, value: tabID.uuidString),
        .init(key: SupatermCLIEnvironment.socketPathKey, value: "/tmp/supaterm.sock"),
        .init(key: SupatermCLIEnvironment.cliPathKey, value: "/Applications/Supaterm.app/Contents/MacOS/sp"),
        .init(key: "PATH", value: path),
      ]
    )
  }

  @Test
  func prependedPathMovesWrapperDirectoryToFrontWithoutDuplication() {
    #expect(
      GhosttySurfaceView.prependedPath(
        "/Applications/Supaterm.app/Contents/Resources/bin",
        currentPath: "/usr/local/bin:/Applications/Supaterm.app/Contents/Resources/bin:/usr/bin"
      ) == "/Applications/Supaterm.app/Contents/Resources/bin:/usr/local/bin:/usr/bin"
    )
  }

  @Test
  func cliDirectoryReturnsBundledExecutableDirectory() {
    #expect(
      GhosttySurfaceView.cliDirectory("/Applications/Supaterm.app/Contents/MacOS/sp")
        == "/Applications/Supaterm.app/Contents/MacOS"
    )
  }
}
