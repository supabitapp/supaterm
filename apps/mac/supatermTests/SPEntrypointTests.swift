import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPEntrypointTests {
  @Test
  func redirectedCLIPathUsesPaneCLIWhenExecutableDiffers() {
    let redirectedPath = SPEntrypoint.redirectedCLIPath(
      environment: [
        SupatermCLIEnvironment.cliPathKey:
          "/tmp/DerivedData/Build/Products/Debug/supaterm.app/Contents/Resources/bin/sp",
      ],
      currentExecutablePath: "/Applications/supaterm.app/Contents/Resources/bin/sp",
      isExecutableFile: {
        $0 == "/tmp/DerivedData/Build/Products/Debug/supaterm.app/Contents/Resources/bin/sp"
      }
    )

    #expect(
      redirectedPath == "/tmp/DerivedData/Build/Products/Debug/supaterm.app/Contents/Resources/bin/sp"
    )
  }

  @Test
  func redirectedCLIPathSkipsWhenCurrentExecutableAlreadyMatches() {
    let redirectedPath = SPEntrypoint.redirectedCLIPath(
      environment: [
        SupatermCLIEnvironment.cliPathKey: "/tmp/build/Debug/../Debug/supaterm.app/Contents/Resources/bin/sp"
      ],
      currentExecutablePath: "/tmp/build/Debug/supaterm.app/Contents/Resources/bin/sp",
      isExecutableFile: {
        $0 == "/tmp/build/Debug/supaterm.app/Contents/Resources/bin/sp"
      }
    )

    #expect(redirectedPath == nil)
  }

  @Test
  func redirectedCLIPathSkipsMissingExecutable() {
    let redirectedPath = SPEntrypoint.redirectedCLIPath(
      environment: [
        SupatermCLIEnvironment.cliPathKey: "/tmp/build/Debug/supaterm.app/Contents/Resources/bin/sp"
      ],
      currentExecutablePath: "/Applications/supaterm.app/Contents/Resources/bin/sp",
      isExecutableFile: { _ in
        false
      }
    )

    #expect(redirectedPath == nil)
  }
}
