import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPEntrypointTests {
  @Test
  func redirectedCLIPathUsesPaneCLIWhenExecutableDiffers() {
    let paneCLIPath = "/tmp/DerivedData/Build/Products/Debug/supaterm.app/Contents/Resources/bin/sp"
    let redirectedPath = SPEntrypoint.redirectedCLIPath(
      environment: [SupatermCLIEnvironment.cliPathKey: paneCLIPath],
      currentExecutablePath: "/Applications/supaterm.app/Contents/Resources/bin/sp",
      isExecutableFile: {
        $0 == paneCLIPath
      }
    )

    #expect(redirectedPath == paneCLIPath)
  }

  @Test
  func redirectedCLIPathSkipsWhenCurrentExecutableAlreadyMatches() {
    let paneCLIPath = "/tmp/build/Debug/../Debug/supaterm.app/Contents/Resources/bin/sp"
    let redirectedPath = SPEntrypoint.redirectedCLIPath(
      environment: [SupatermCLIEnvironment.cliPathKey: paneCLIPath],
      currentExecutablePath: "/tmp/build/Debug/supaterm.app/Contents/Resources/bin/sp",
      isExecutableFile: {
        $0 == "/tmp/build/Debug/supaterm.app/Contents/Resources/bin/sp"
      }
    )

    #expect(redirectedPath == nil)
  }

  @Test
  func redirectedCLIPathSkipsMissingExecutable() {
    let paneCLIPath = "/tmp/build/Debug/supaterm.app/Contents/Resources/bin/sp"
    let redirectedPath = SPEntrypoint.redirectedCLIPath(
      environment: [SupatermCLIEnvironment.cliPathKey: paneCLIPath],
      currentExecutablePath: "/Applications/supaterm.app/Contents/Resources/bin/sp",
      isExecutableFile: { _ in
        false
      }
    )

    #expect(redirectedPath == nil)
  }
}
