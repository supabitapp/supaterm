import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared
@testable import SupatermSupport

struct SupatermSkillsTests {
  @Test
  func listsSkillsByNameFromTheirDefinitions() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)

    let skills = try SupatermSkills(
      bundledSkillsDirectoryURL: bundledSkillsDirectoryURL
    ).list()

    #expect(
      skills
        == [
          SupatermSkillSummary(name: "coding-agents", description: "Launch coding agents."),
          SupatermSkillSummary(name: "core", description: "Control Supaterm."),
        ]
    )
  }

  @Test
  func getsOnlyTheSkillDefinitionByDefault() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)

    let skill = try SupatermSkills(
      bundledSkillsDirectoryURL: bundledSkillsDirectoryURL
    ).get(name: "core")

    #expect(skill.name == "core")
    #expect(skill.content.contains("# Core"))
    #expect(skill.files == nil)
  }

  @Test
  func returnsBundledSkillDirectoryPath() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)

    let path = try SupatermSkills(
      bundledSkillsDirectoryURL: bundledSkillsDirectoryURL
    ).path(name: "core")

    #expect(path == skillDataURL(bundledSkillsDirectoryURL).appendingPathComponent("core").path)
  }

  @Test
  func jsonFailureUsesErrorEnvelope() throws {
    let object = try jsonObject(SPSkillsFailure(error: "Skill not found: unknown"))

    #expect(object["success"] as? Bool == false)
    #expect(object["error"] as? String == "Skill not found: unknown")
  }

  @Test
  func fullSkillIncludesSortedRelativeFiles() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)

    let skill = try SupatermSkills(
      bundledSkillsDirectoryURL: bundledSkillsDirectoryURL
    ).get(name: "core", full: true)

    #expect(
      skill.files
        == [
          SupatermSkillFile(path: "references/panes.md", content: "Panes\n"),
          SupatermSkillFile(path: "references/tabs.md", content: "Tabs\n"),
        ]
    )
    #expect(
      renderSkill(skill).hasSuffix(
        "--- references/panes.md ---\n\nPanes\n\n--- references/tabs.md ---\n\nTabs\n"
      )
    )
  }

  @Test
  func rejectsUnknownSkill() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)

    #expect(throws: SupatermSkillsError.skillNotFound("unknown")) {
      try SupatermSkills(bundledSkillsDirectoryURL: bundledSkillsDirectoryURL)
        .get(name: "unknown")
    }
  }

  @Test
  func rejectsSkillPathTraversal() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)

    #expect(throws: SupatermSkillsError.skillNotFound("../skills/supaterm")) {
      try SupatermSkills(bundledSkillsDirectoryURL: bundledSkillsDirectoryURL)
        .get(name: "../skills/supaterm")
    }
    #expect(throws: SupatermSkillsError.skillNotFound("../skills/supaterm")) {
      try SupatermSkills(bundledSkillsDirectoryURL: bundledSkillsDirectoryURL)
        .path(name: "../skills/supaterm")
    }
  }

  @Test
  func rejectsDefinitionWhoseNameDiffersFromItsDirectory() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)
    let coreDefinitionURL = skillDataURL(bundledSkillsDirectoryURL)
      .appendingPathComponent("core/SKILL.md")
    try Data(skillDefinition(name: "other", description: "Invalid.", title: "Other").utf8)
      .write(to: coreDefinitionURL)

    do {
      _ = try SupatermSkills(bundledSkillsDirectoryURL: bundledSkillsDirectoryURL).list()
      Issue.record("Expected an invalid skill error.")
    } catch SupatermSkillsError.invalidSkill(let path) {
      #expect(
        URL(fileURLWithPath: path).resolvingSymlinksInPath()
          == coreDefinitionURL.deletingLastPathComponent().resolvingSymlinksInPath()
      )
    } catch {
      Issue.record("Unexpected error: \(error)")
    }
  }

  @Test
  func installCopiesTheDiscoverySkillDirectory() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)
    let homeDirectoryURL = rootURL.appendingPathComponent("home", isDirectory: true)

    let result = try SupatermSkills(
      homeDirectoryURL: homeDirectoryURL,
      bundledSkillsDirectoryURL: bundledSkillsDirectoryURL
    ).install()

    let installedDirectoryURL = SupatermSkills.skillDirectoryURL(homeDirectoryURL: homeDirectoryURL)
    let claudeDirectoryURL = SupatermSkills.claudeSkillDirectoryURL(
      homeDirectoryURL: homeDirectoryURL
    )
    #expect(result.path == installedDirectoryURL.path)
    #expect(symbolicLinkDestination(at: installedDirectoryURL) == nil)
    #expect(symbolicLinkDestination(at: claudeDirectoryURL) == installedDirectoryURL.path)
    #expect(
      try String(
        contentsOf: SupatermSkills.skillDefinitionURL(skillDirectoryURL: installedDirectoryURL),
        encoding: .utf8
      ).contains("sp skills get core")
    )
    #expect(
      try String(
        contentsOf: installedDirectoryURL.appendingPathComponent("agents/openai.yaml"),
        encoding: .utf8
      ) == "display_name: Supaterm\n"
    )
  }

  @Test
  func installReplacesAStaleSymlinkWithACopy() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)
    let homeDirectoryURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let installedDirectoryURL = SupatermSkills.skillDirectoryURL(homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(
      at: installedDirectoryURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try FileManager.default.createSymbolicLink(
      at: installedDirectoryURL,
      withDestinationURL: rootURL.appendingPathComponent("stale")
    )

    try SupatermSkills(
      homeDirectoryURL: homeDirectoryURL,
      bundledSkillsDirectoryURL: bundledSkillsDirectoryURL
    ).install()

    #expect(symbolicLinkDestination(at: installedDirectoryURL) == nil)
    #expect(FileManager.default.fileExists(atPath: installedDirectoryURL.path))
  }

  @Test
  func installReplacesAnExistingDirectory() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)
    let homeDirectoryURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let installedDirectoryURL = SupatermSkills.skillDirectoryURL(homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(
      at: installedDirectoryURL, withIntermediateDirectories: true)
    try Data("old".utf8).write(to: installedDirectoryURL.appendingPathComponent("old.txt"))

    try SupatermSkills(
      homeDirectoryURL: homeDirectoryURL,
      bundledSkillsDirectoryURL: bundledSkillsDirectoryURL
    ).install()

    #expect(
      !FileManager.default.fileExists(
        atPath: installedDirectoryURL.appendingPathComponent("old.txt").path))
    #expect(
      FileManager.default.fileExists(
        atPath: installedDirectoryURL.appendingPathComponent("SKILL.md").path))
  }

  @Test
  func installReplacesAnExistingClaudeSkillAndKeepsOtherClaudeSkills() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)
    let homeDirectoryURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let claudeSkillDirectoryURL = SupatermSkills.claudeSkillDirectoryURL(
      homeDirectoryURL: homeDirectoryURL
    )
    let otherSkillURL = claudeSkillDirectoryURL.deletingLastPathComponent()
      .appendingPathComponent("other", isDirectory: true)
    try FileManager.default.createDirectory(
      at: claudeSkillDirectoryURL,
      withIntermediateDirectories: true
    )
    try FileManager.default.createDirectory(at: otherSkillURL, withIntermediateDirectories: true)
    try Data("old".utf8).write(to: claudeSkillDirectoryURL.appendingPathComponent("old.txt"))

    try SupatermSkills(
      homeDirectoryURL: homeDirectoryURL,
      bundledSkillsDirectoryURL: bundledSkillsDirectoryURL
    ).install()

    let installedDirectoryURL = SupatermSkills.skillDirectoryURL(homeDirectoryURL: homeDirectoryURL)
    #expect(symbolicLinkDestination(at: claudeSkillDirectoryURL) == installedDirectoryURL.path)
    #expect(FileManager.default.fileExists(atPath: otherSkillURL.path))
  }

  @Test
  func bundledSkillsDirectoryUsesResourceURL() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)

    #expect(
      SupatermSkills.bundledSkillsDirectoryURL(
        resourceURL: bundledSkillsDirectoryURL,
        executableURL: nil
      ) == bundledSkillsDirectoryURL
    )
  }

  @Test
  func bundledSkillsDirectoryUsesExecutableResourceSibling() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)
    let executableURL =
      bundledSkillsDirectoryURL
      .deletingLastPathComponent()
      .appendingPathComponent("MacOS", isDirectory: true)
      .appendingPathComponent("sp", isDirectory: false)

    #expect(
      SupatermSkills.bundledSkillsDirectoryURL(
        resourceURL: nil,
        executableURL: executableURL
      ) == bundledSkillsDirectoryURL
    )
  }

  @Test
  func bundledSkillsDirectoryResolvesExecutableSymlink() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)
    let executableURL =
      bundledSkillsDirectoryURL
      .deletingLastPathComponent()
      .appendingPathComponent("MacOS", isDirectory: true)
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
      SupatermSkills.bundledSkillsDirectoryURL(
        resourceURL: nil,
        executableURL: symlinkURL
      ) == bundledSkillsDirectoryURL
    )
  }

  @Test
  func installFailsWhenBundledSkillsAreUnavailable() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let missingURL = rootURL.appendingPathComponent("missing", isDirectory: true)

    #expect(throws: SupatermSkillsError.bundledSkillsUnavailable(missingURL.path)) {
      try SupatermSkills(
        homeDirectoryURL: rootURL.appendingPathComponent("home", isDirectory: true),
        bundledSkillsDirectoryURL: missingURL
      ).install()
    }
  }

  @Test
  func manualInstallCommandUsesSkillsCommand() {
    #expect(SupatermSkills.manualInstallCommand == "sp skills install")
  }
}

private func jsonObject<T: Encodable>(_ value: T) throws -> [String: Any] {
  try #require(
    JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any]
  )
}

private func symbolicLinkDestination(at url: URL) -> String? {
  try? FileManager.default.destinationOfSymbolicLink(atPath: url.path)
}
