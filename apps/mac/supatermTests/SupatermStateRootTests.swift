import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermStateRootTests {
  @Test
  func directoryURLFallsBackToSupatermConfigUnderHome() {
    #expect(
      SupatermStateRoot.directoryURL(
        homeDirectoryPath: "/tmp/khoi",
        environment: [:]
      )
        == URL(fileURLWithPath: "/tmp/khoi", isDirectory: true)
        .appendingPathComponent(".config", isDirectory: true)
        .appendingPathComponent("supaterm", isDirectory: true)
    )
  }

  @Test
  func directoryURLUsesStateHomeWhenPresent() {
    #expect(
      SupatermStateRoot.directoryURL(
        homeDirectoryPath: "/tmp/ignored",
        environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
      )
        == URL(fileURLWithPath: "/tmp/supaterm-dev", isDirectory: true)
        .standardizedFileURL
    )
  }

  @Test
  func fileURLAppendsNameToResolvedDirectory() {
    #expect(
      SupatermStateRoot.fileURL(
        "settings.toml",
        homeDirectoryPath: "/tmp/ignored",
        environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
      )
        == URL(fileURLWithPath: "/tmp/supaterm-dev", isDirectory: true)
        .appendingPathComponent("settings.toml", isDirectory: false)
        .standardizedFileURL
    )
  }

  @Test
  func hostPathsUseStateIdentityInsteadOfAppInstance() {
    let runtimeBase = URL(fileURLWithPath: "/tmp/supaterm-runtime", isDirectory: true)
    let first = SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.instanceNameKey: "first",
        SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-state",
      ],
      runtimeBase: runtimeBase
    )
    let second = SupatermHostPaths(
      environment: [
        SupatermCLIEnvironment.instanceNameKey: "second",
        SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-state",
      ],
      runtimeBase: runtimeBase
    )

    #expect(first == second)
    #expect(first.socket == first.runtimeRoot.appendingPathComponent("host.sock"))
  }

  @Test
  func hostPathsSeparateStateRoots() {
    let runtimeBase = URL(fileURLWithPath: "/tmp/supaterm-runtime", isDirectory: true)
    let first = SupatermHostPaths(
      environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-state-a"],
      runtimeBase: runtimeBase
    )
    let second = SupatermHostPaths(
      environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-state-b"],
      runtimeBase: runtimeBase
    )

    #expect(first.runtimeRoot != second.runtimeRoot)
    #expect(first.socket != second.socket)
  }
}
