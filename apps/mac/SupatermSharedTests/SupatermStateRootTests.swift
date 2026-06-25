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
}
