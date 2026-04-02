import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct GhosttySurfaceViewEnvironmentTests {
  @Test
  func supatermEnvironmentVariablesIncludePaneSocketCliAndPrependedPath() {
    let surfaceID = UUID(uuidString: "A72F7A7D-B5E8-497E-A5D5-D26A77A0A4C7")!
    let tabID = UUID(uuidString: "9F4EB4BE-9216-4DCA-A866-C8276D9EF2AA")!
    let path = [
      "/Applications/Supaterm.app/Contents/Resources/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].joined(separator: ":")
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: surfaceID,
      tabID: tabID,
      socketPath: "/tmp/supaterm.sock",
      cliPath: "/Applications/Supaterm.app/Contents/Resources/bin/sp",
      processEnvironment: ["PATH": "/usr/local/bin:/usr/bin:/bin"]
    )

    #expect(
      environmentVariables == [
        .init(key: SupatermCLIEnvironment.surfaceIDKey, value: surfaceID.uuidString),
        .init(key: SupatermCLIEnvironment.tabIDKey, value: tabID.uuidString),
        .init(key: SupatermCLIEnvironment.socketPathKey, value: "/tmp/supaterm.sock"),
        .init(key: SupatermCLIEnvironment.cliPathKey, value: "/Applications/Supaterm.app/Contents/Resources/bin/sp"),
        .init(key: "PATH", value: path),
      ]
    )
  }

  @Test
  func prependedPathMovesCliDirectoryToFrontWithoutDuplication() {
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
      GhosttySurfaceView.cliDirectory("/Applications/Supaterm.app/Contents/Resources/bin/sp")
        == "/Applications/Supaterm.app/Contents/Resources/bin"
    )
  }

  @Test
  func setSurfaceTitleActionPreservesEmptyTitle() {
    #expect(GhosttySurfaceView.setSurfaceTitleAction("") == "set_surface_title:")
  }

  @Test
  func setSurfaceTitleActionPreservesWhitespaceAndColons() {
    #expect(GhosttySurfaceView.setSurfaceTitleAction("  ") == "set_surface_title:  ")
    #expect(
      GhosttySurfaceView.setSurfaceTitleAction("foo:bar") == "set_surface_title:foo:bar"
    )
  }
}
