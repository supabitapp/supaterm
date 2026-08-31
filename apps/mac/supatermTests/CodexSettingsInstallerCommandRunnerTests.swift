import Testing

@testable import SupatermSupport

extension CodexSettingsInstallerTests {
  @Test
  func enableHooksCommandArgumentsUseInteractiveLoginShell() {
    #expect(
      CodexSettingsInstaller.enableHooksCommandArguments()
        == ["-l", "-i", "-c", "codex features enable hooks"]
    )
  }

  @Test
  func versionCommandUsesInteractiveLoginShell() {
    #expect(
      CodexSettingsInstaller.versionCommandArguments()
        == ["-l", "-i", "-c", "codex --version"]
    )
  }
}
