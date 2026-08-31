import Foundation
import Testing

@testable import SupatermSupport

struct PiSettingsInstallerSourceTests {
  @Test
  func hasSupatermPackageInstalledMatchesCanonicalSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources(
      [PiSettingsInstaller.canonicalPackageSource],
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = installer(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.hasSupatermPackageInstalled())
  }

  @Test
  func hasSupatermPackageInstalledMatchesSSHSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources(
      ["git:git@github.com:supabitapp/supaterm-skills.git"],
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = installer(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.hasSupatermPackageInstalled())
  }

  @Test
  func hasSupatermPackageInstalledMatchesLocalPathSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources(
      ["../../code/github.com/supabitapp/supaterm-skills"],
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = installer(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.hasSupatermPackageInstalled())
  }

  @Test
  func hasSupatermPackageInstalledMatchesLocalGitPathSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources(
      ["../../code/github.com/supabitapp/supaterm-skills.git"],
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = installer(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.hasSupatermPackageInstalled())
  }

  @Test
  func hostedShorthandsAndRefsShareCanonicalIdentity() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let canonicalIdentity = canonicalPiPackageSource(homeDirectoryURL: homeDirectoryURL).identity
    let sources = [
      "git:github:supabitapp/supaterm-skills",
      "git:github:supabitapp/supaterm-skills#main",
      "git:github.com/supabitapp/supaterm-skills#main",
      "https://github.com/supabitapp/supaterm-skills#main",
      "git:git@github.com:supabitapp/supaterm-skills.git@main",
    ]

    for source in sources {
      #expect(
        piPackageSource(source, homeDirectoryURL: homeDirectoryURL).identity == canonicalIdentity)
    }
  }

  @Test
  func canonicalInstallDisplayCommandUsesCanonicalPackageSource() {
    #expect(
      PiSettingsInstaller.canonicalInstallDisplayCommand
        == "pi install \(PiSettingsInstaller.canonicalPackageSource)"
    )
  }

  @Test
  func hasSupatermPackageInstalledIgnoresLegacyRepoSource() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources(
      ["git:github.com/supabitapp/supaterm"],
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = installer(homeDirectoryURL: homeDirectoryURL)

    #expect(try !installer.hasSupatermPackageInstalled())
  }

  @Test
  func invalidSettingsSurfaceAReadableError() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiSettings("not json", homeDirectoryURL: homeDirectoryURL)
    let installer = installer(homeDirectoryURL: homeDirectoryURL)

    #expect(throws: PiSettingsInstallerError.invalidSettings) {
      try installer.hasSupatermPackageInstalled()
    }
  }

  private func installer(homeDirectoryURL: URL) -> PiSettingsInstaller {
    PiSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkPiAvailable: { true },
      runPiMutation: { _, _ in PiSettingsInstaller.CommandResult(status: 0) }
    )
  }
}
