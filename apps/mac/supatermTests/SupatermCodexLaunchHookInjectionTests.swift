import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermCodexLaunchHookInjectionTests {
  @Test
  func argumentsPinPaneSocketCLIAndClientProcess() throws {
    let surfaceID = UUID(uuidString: "BA864E81-56B8-4610-B8E1-9E3D0F16DEEF")!
    let tabID = UUID(uuidString: "0FEF397C-128B-4BC7-A31B-1129AFB6B8EE")!
    let arguments = try #require(
      SupatermCodexLaunchHookInjection.arguments(
        environment: [
          SupatermCLIEnvironment.cliPathKey: "/Applications/Supaterm's Dev.app/Contents/MacOS/sp",
          SupatermCLIEnvironment.socketPathKey: "/tmp/supaterm dev.sock",
          SupatermCLIEnvironment.surfaceIDKey: surfaceID.uuidString,
          SupatermCLIEnvironment.tabIDKey: tabID.uuidString,
        ],
        processID: 12_345
      )
    )

    #expect(
      arguments.prefix(4) == [
        "--enable",
        "hooks",
        "--dangerously-bypass-hook-trust",
        "-c",
      ])
    let override = try #require(arguments.last)
    #expect(override.contains("hooks.SessionStart="))
    #expect(override.contains("--pid 12345"))
    #expect(override.contains("--surface-id '\(surfaceID.uuidString)'"))
    #expect(override.contains("--tab-id '\(tabID.uuidString)'"))
    #expect(override.contains("--launch-bound"))
    #expect(override.contains("--socket '/tmp/supaterm dev.sock'"))
    #expect(override.contains("/Applications/Supaterm'\\\\''s Dev.app/Contents/MacOS/sp"))
    #expect(!override.contains("SUPATERM_"))
    #expect(!override.contains("$PPID"))
  }

  @Test
  func argumentsRequireCompletePaneContext() {
    #expect(
      SupatermCodexLaunchHookInjection.arguments(
        environment: [
          SupatermCLIEnvironment.cliPathKey: "/tmp/sp",
          SupatermCLIEnvironment.socketPathKey: "/tmp/supaterm.sock",
        ],
        processID: 12_345
      ) == nil
    )
  }
}
