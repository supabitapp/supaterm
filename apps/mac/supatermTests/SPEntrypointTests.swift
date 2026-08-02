import ArgumentParser
import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPEntrypointTests {
  @Test
  func redirectedCLIPathUsesPaneCLIWhenExecutableDiffers() {
    let paneCLIPath = "/tmp/DerivedData/Build/Products/Debug/supaterm.app/Contents/MacOS/sp"
    let redirectedPath = SPEntrypoint.redirectedCLIPath(
      environment: [SupatermCLIEnvironment.cliPathKey: paneCLIPath],
      currentExecutablePath: "/Applications/supaterm.app/Contents/MacOS/sp",
      isExecutableFile: {
        $0 == paneCLIPath
      }
    )

    #expect(redirectedPath == paneCLIPath)
  }

  @Test
  func redirectedCLIPathSkipsWhenCurrentExecutableAlreadyMatches() {
    let paneCLIPath = "/tmp/build/Debug/../Debug/supaterm.app/Contents/MacOS/sp"
    let redirectedPath = SPEntrypoint.redirectedCLIPath(
      environment: [SupatermCLIEnvironment.cliPathKey: paneCLIPath],
      currentExecutablePath: "/tmp/build/Debug/supaterm.app/Contents/MacOS/sp",
      isExecutableFile: {
        $0 == "/tmp/build/Debug/supaterm.app/Contents/MacOS/sp"
      }
    )

    #expect(redirectedPath == nil)
  }

  @Test
  func redirectedCLIPathSkipsMissingExecutable() {
    let paneCLIPath = "/tmp/build/Debug/supaterm.app/Contents/MacOS/sp"
    let redirectedPath = SPEntrypoint.redirectedCLIPath(
      environment: [SupatermCLIEnvironment.cliPathKey: paneCLIPath],
      currentExecutablePath: "/Applications/supaterm.app/Contents/MacOS/sp",
      isExecutableFile: { _ in
        false
      }
    )

    #expect(redirectedPath == nil)
  }

  @Test
  func rawEntrypointValidationErrorsUseValidationMessage() {
    #expect(
      SPEntrypoint.errorMessage(for: ValidationError("wait-for timed out waiting for 'missing'"))
        == "wait-for timed out waiting for 'missing'"
    )
  }

  @Test
  func canonicalPathFollowsSymlinks() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let executableURL = temporaryDirectory.appendingPathComponent("sp-real", isDirectory: false)
    let symlinkURL = temporaryDirectory.appendingPathComponent("sp", isDirectory: false)
    try writeExecutable(at: executableURL, script: "#!/bin/sh\nexit 0\n")
    try FileManager.default.createSymbolicLink(at: symlinkURL, withDestinationURL: executableURL)

    #expect(SPExecutable.canonicalPath(symlinkURL.path) == executableURL.path)
  }
}
