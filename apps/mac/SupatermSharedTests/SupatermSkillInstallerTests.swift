import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermSkillInstallerTests {
  @Test
  func hasSupatermSkillInstalledChecksSkillPath() throws {
    let rootURL = try temporarySkillRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let homeDirectoryURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let skillDefinitionURL = SupatermSkillInstaller.skillDefinitionURL(homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(
      at: skillDefinitionURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data("name: supaterm".utf8).write(to: skillDefinitionURL)

    let installer = SupatermSkillInstaller(
      homeDirectoryURL: homeDirectoryURL,
      bundledSkillDirectoryURL: nil
    )

    #expect(installer.hasSupatermSkillInstalled())
  }

  @Test
  func installCreatesGlobalSkillSymlinkToBundledSkill() throws {
    let rootURL = try temporarySkillRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let homeDirectoryURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let bundledSkillDirectoryURL = try bundledSkillDirectory(in: rootURL)
    let installer = SupatermSkillInstaller(
      homeDirectoryURL: homeDirectoryURL,
      bundledSkillDirectoryURL: bundledSkillDirectoryURL
    )

    try installer.installSupatermSkill()

    #expect(
      try symbolicLinkDestination(
        at: SupatermSkillInstaller.skillDirectoryURL(homeDirectoryURL: homeDirectoryURL)
      ) == bundledSkillDirectoryURL.path
    )
  }

  @Test
  func installRepairsStaleSymlink() throws {
    let rootURL = try temporarySkillRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let homeDirectoryURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let bundledSkillDirectoryURL = try bundledSkillDirectory(in: rootURL)
    let staleSkillDirectoryURL = rootURL.appendingPathComponent("stale", isDirectory: true)
    let skillDirectoryURL = SupatermSkillInstaller.skillDirectoryURL(homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(
      at: skillDirectoryURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try FileManager.default.createSymbolicLink(
      at: skillDirectoryURL,
      withDestinationURL: staleSkillDirectoryURL
    )

    try SupatermSkillInstaller(
      homeDirectoryURL: homeDirectoryURL,
      bundledSkillDirectoryURL: bundledSkillDirectoryURL
    )
    .installSupatermSkill()

    #expect(try symbolicLinkDestination(at: skillDirectoryURL) == bundledSkillDirectoryURL.path)
  }

  @Test
  func installReplacesExistingDirectory() throws {
    let rootURL = try temporarySkillRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let homeDirectoryURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let bundledSkillDirectoryURL = try bundledSkillDirectory(in: rootURL)
    let skillDirectoryURL = SupatermSkillInstaller.skillDirectoryURL(homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(at: skillDirectoryURL, withIntermediateDirectories: true)
    try Data("name: old".utf8)
      .write(to: SupatermSkillInstaller.skillDefinitionURL(skillDirectoryURL: skillDirectoryURL))

    try SupatermSkillInstaller(
      homeDirectoryURL: homeDirectoryURL,
      bundledSkillDirectoryURL: bundledSkillDirectoryURL
    )
    .installSupatermSkill()

    #expect(try symbolicLinkDestination(at: skillDirectoryURL) == bundledSkillDirectoryURL.path)
  }

  @Test
  func manualInstallCommandUsesBundledInstaller() {
    #expect(SupatermSkillInstaller.manualInstallCommand == "sp agent install-skill")
  }

  @Test
  func bundledSkillDirectoryUsesResourceURL() throws {
    let rootURL = try temporarySkillRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let bundledSkillDirectoryURL = try bundledSkillDirectory(in: rootURL)

    #expect(
      SupatermSkillInstaller.bundledSkillDirectoryURL(
        resourceURL: rootURL.appendingPathComponent("bundle", isDirectory: true),
        executableURL: nil
      ) == bundledSkillDirectoryURL
    )
  }

  @Test
  func bundledSkillDirectoryUsesExecutableResourceSibling() throws {
    let rootURL = try temporarySkillRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let bundledSkillDirectoryURL = try bundledSkillDirectory(in: rootURL)
    let executableURL =
      rootURL
      .appendingPathComponent("bundle", isDirectory: true)
      .appendingPathComponent("bin", isDirectory: true)
      .appendingPathComponent("sp", isDirectory: false)

    #expect(
      SupatermSkillInstaller.bundledSkillDirectoryURL(
        resourceURL: nil,
        executableURL: executableURL
      ) == bundledSkillDirectoryURL
    )
  }

  @Test
  func bundledSkillDirectoryResolvesExecutableSymlink() throws {
    let rootURL = try temporarySkillRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let bundledSkillDirectoryURL = try bundledSkillDirectory(in: rootURL)
    let executableURL =
      rootURL
      .appendingPathComponent("bundle", isDirectory: true)
      .appendingPathComponent("bin", isDirectory: true)
      .appendingPathComponent("sp", isDirectory: false)
    try FileManager.default.createDirectory(
      at: executableURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data().write(to: executableURL)

    let symlinkURL =
      rootURL
      .appendingPathComponent("external", isDirectory: true)
      .appendingPathComponent("sp", isDirectory: false)
    try FileManager.default.createDirectory(
      at: symlinkURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try FileManager.default.createSymbolicLink(at: symlinkURL, withDestinationURL: executableURL)

    #expect(
      SupatermSkillInstaller.bundledSkillDirectoryURL(
        resourceURL: nil,
        executableURL: symlinkURL
      ) == bundledSkillDirectoryURL
    )
  }

  @Test
  func installFailsWhenBundledSkillIsUnavailable() throws {
    let rootURL = try temporarySkillRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let missingSkillDirectoryURL = rootURL.appendingPathComponent("missing", isDirectory: true)

    #expect(
      throws: SupatermSkillInstallerError.bundledSkillUnavailable(missingSkillDirectoryURL.path)
    ) {
      try SupatermSkillInstaller(
        homeDirectoryURL: rootURL.appendingPathComponent("home", isDirectory: true),
        bundledSkillDirectoryURL: missingSkillDirectoryURL
      )
      .installSupatermSkill()
    }
  }
}

private func bundledSkillDirectory(in rootURL: URL) throws -> URL {
  let skillDirectoryURL =
    rootURL
    .appendingPathComponent("bundle", isDirectory: true)
    .appendingPathComponent("skills", isDirectory: true)
    .appendingPathComponent("supaterm", isDirectory: true)
  try FileManager.default.createDirectory(at: skillDirectoryURL, withIntermediateDirectories: true)
  try Data("name: supaterm".utf8)
    .write(to: SupatermSkillInstaller.skillDefinitionURL(skillDirectoryURL: skillDirectoryURL))
  return skillDirectoryURL
}

private func symbolicLinkDestination(at url: URL) throws -> String {
  try FileManager.default.destinationOfSymbolicLink(atPath: url.path)
}

private func temporarySkillRoot() throws -> URL {
  try FileManager.default.url(
    for: .itemReplacementDirectory,
    in: .userDomainMask,
    appropriateFor: FileManager.default.temporaryDirectory,
    create: true
  )
}
