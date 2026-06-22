import AppKit
import Foundation
import GhosttyKit
import Testing

@testable import SupatermCLIShared
@testable import SupatermGhosttyFeature
@testable import SupatermTerminalFeature
@testable import supaterm

@MainActor
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
        SupatermCLIEnvironmentVariable(key: SupatermCLIEnvironment.surfaceIDKey, value: surfaceID.uuidString),
        SupatermCLIEnvironmentVariable(key: SupatermCLIEnvironment.tabIDKey, value: tabID.uuidString),
        SupatermCLIEnvironmentVariable(key: SupatermCLIEnvironment.socketPathKey, value: "/tmp/supaterm.sock"),
        SupatermCLIEnvironmentVariable(
          key: SupatermCLIEnvironment.cliPathKey,
          value: "/Applications/Supaterm.app/Contents/Resources/bin/sp"
        ),
        SupatermCLIEnvironmentVariable(key: ZmxEnvironment.directoryKey, value: "/tmp/zmx-\(getuid())"),
        SupatermCLIEnvironmentVariable(key: ZmxEnvironment.sessionKey, value: ""),
        SupatermCLIEnvironmentVariable(key: ZmxEnvironment.sessionPrefixKey, value: ""),
        SupatermCLIEnvironmentVariable(key: "PATH", value: path),
      ]
    )
  }

  @Test
  func supatermEnvironmentVariablesUseShortZmxDirectory() {
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: UUID(),
      tabID: UUID(),
      socketPath: nil,
      cliPath: nil,
      processEnvironment: [
        "ZMX_DIR": "/var/folders/" + String(repeating: "a", count: 80),
        "XDG_RUNTIME_DIR": "/var/folders/" + String(repeating: "b", count: 80),
        "TMPDIR": "/var/folders/" + String(repeating: "c", count: 80),
      ]
    )

    #expect(
      environmentVariables.contains(
        SupatermCLIEnvironmentVariable(key: ZmxEnvironment.directoryKey, value: "/tmp/zmx-\(getuid())")
      )
    )
  }

  @Test
  func supatermEnvironmentVariablesClearInheritedZmxSessionContext() {
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: UUID(),
      tabID: UUID(),
      socketPath: nil,
      cliPath: nil,
      processEnvironment: [
        ZmxEnvironment.sessionKey: "parent-session",
        ZmxEnvironment.sessionPrefixKey: "parent-prefix-",
      ]
    )

    #expect(environmentVariables.contains(SupatermCLIEnvironmentVariable(key: ZmxEnvironment.sessionKey, value: "")))
    #expect(
      environmentVariables.contains(SupatermCLIEnvironmentVariable(key: ZmxEnvironment.sessionPrefixKey, value: ""))
    )
  }

  @Test
  func supatermEnvironmentVariablesOmitZmxDirectoryWhenZmxSessionsAreDisabled() {
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: UUID(),
      tabID: UUID(),
      socketPath: nil,
      cliPath: nil,
      zmxSessionsEnabled: false
    )

    #expect(!environmentVariables.contains { $0.key == ZmxEnvironment.directoryKey })
    #expect(!environmentVariables.contains { $0.key == ZmxEnvironment.sessionKey })
    #expect(!environmentVariables.contains { $0.key == ZmxEnvironment.sessionPrefixKey })
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
  func supatermEnvironmentVariablesIncludeStateHomeWhenPresent() {
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: UUID(),
      tabID: UUID(),
      socketPath: nil,
      cliPath: nil,
      processEnvironment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
    )

    #expect(
      environmentVariables.contains(
        SupatermCLIEnvironmentVariable(key: SupatermCLIEnvironment.stateHomeKey, value: "/tmp/supaterm-dev")
      )
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
  func titleOverrideTreatsEmptyStringAsRestoreDefault() {
    #expect(GhosttySurfaceView.titleOverride(from: "") == nil)
  }

  @Test
  func titleOverridePreservesWhitespaceAndColons() {
    #expect(GhosttySurfaceView.titleOverride(from: "  ") == "  ")
    #expect(GhosttySurfaceView.titleOverride(from: "foo:bar") == "foo:bar")
  }

  @Test
  func scrollOnFocusedSurfaceCountsAsDirectInteraction() throws {
    initializeGhosttyForTests()

    let runtime = GhosttyRuntime()
    let view = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    var interactionCount = 0
    view.onDirectInteraction = {
      interactionCount += 1
    }
    view.focusDidChange(true)
    let cgEvent = try #require(
      CGEvent(
        scrollWheelEvent2Source: nil,
        units: .pixel,
        wheelCount: 1,
        wheel1: 1,
        wheel2: 0,
        wheel3: 0
      )
    )
    let scrollEvent = try #require(NSEvent(cgEvent: cgEvent))

    view.scrollWheel(with: scrollEvent)

    #expect(interactionCount == 1)
  }
}
