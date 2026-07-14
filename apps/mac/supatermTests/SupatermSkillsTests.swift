import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

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
  func jsonUsesSuccessDataEnvelopeAndOmitsFilesUnlessFull() throws {
    let rootURL = try temporarySkillsRoot()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)
    let skills = SupatermSkills(bundledSkillsDirectoryURL: bundledSkillsDirectoryURL)

    let conciseObject = try jsonObject(
      SPSkillsSuccess(data: [try skills.get(name: "core")])
    )
    let conciseData = try #require(conciseObject["data"] as? [[String: Any]])
    #expect(conciseObject["success"] as? Bool == true)
    #expect(conciseData.count == 1)
    #expect(conciseData[0]["name"] as? String == "core")
    #expect(conciseData[0]["files"] == nil)

    let fullObject = try jsonObject(
      SPSkillsSuccess(data: [try skills.get(name: "core", full: true)])
    )
    let fullData = try #require(fullObject["data"] as? [[String: Any]])
    let files = try #require(fullData[0]["files"] as? [[String: Any]])
    #expect(files.map { $0["path"] as? String } == ["references/panes.md", "references/tabs.md"])
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
      #expect(path.hasSuffix("/bundle/skill-data/core"))
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
    #expect(result.path == installedDirectoryURL.path)
    #expect(symbolicLinkDestination(at: installedDirectoryURL) == nil)
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
      .appendingPathComponent("bin", isDirectory: true)
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

private func bundledSkillsDirectory(in rootURL: URL) throws -> URL {
  let bundledSkillsDirectoryURL = rootURL.appendingPathComponent("bundle", isDirectory: true)
  let discoverySkillDirectoryURL =
    bundledSkillsDirectoryURL
    .appendingPathComponent("skills/supaterm", isDirectory: true)
  try FileManager.default.createDirectory(
    at: discoverySkillDirectoryURL.appendingPathComponent("agents", isDirectory: true),
    withIntermediateDirectories: true
  )
  try Data(
    skillDefinition(
      name: "supaterm",
      description: "Discover Supaterm skills.",
      title: "Supaterm",
      body: "Run `sp skills get core`."
    ).utf8
  ).write(to: discoverySkillDirectoryURL.appendingPathComponent("SKILL.md"))
  try Data("display_name: Supaterm\n".utf8)
    .write(to: discoverySkillDirectoryURL.appendingPathComponent("agents/openai.yaml"))

  let skillDataDirectoryURL = skillDataURL(bundledSkillsDirectoryURL)
  let coreDirectoryURL = skillDataDirectoryURL.appendingPathComponent("core", isDirectory: true)
  let referencesDirectoryURL = coreDirectoryURL.appendingPathComponent(
    "references", isDirectory: true)
  try FileManager.default.createDirectory(
    at: referencesDirectoryURL, withIntermediateDirectories: true)
  try Data(skillDefinition(name: "core", description: "Control Supaterm.", title: "Core").utf8)
    .write(to: coreDirectoryURL.appendingPathComponent("SKILL.md"))
  try Data("Tabs\n".utf8).write(to: referencesDirectoryURL.appendingPathComponent("tabs.md"))
  try Data("Panes\n".utf8).write(to: referencesDirectoryURL.appendingPathComponent("panes.md"))

  let agentsDirectoryURL = skillDataDirectoryURL.appendingPathComponent(
    "coding-agents",
    isDirectory: true
  )
  try FileManager.default.createDirectory(at: agentsDirectoryURL, withIntermediateDirectories: true)
  try Data(
    skillDefinition(
      name: "coding-agents",
      description: "Launch coding agents.",
      title: "Coding Agents"
    ).utf8
  ).write(to: agentsDirectoryURL.appendingPathComponent("SKILL.md"))
  return bundledSkillsDirectoryURL
}

private func skillDataURL(_ bundledSkillsDirectoryURL: URL) -> URL {
  bundledSkillsDirectoryURL.appendingPathComponent("skill-data", isDirectory: true)
}

private func skillDefinition(
  name: String,
  description: String,
  title: String,
  body: String = ""
) -> String {
  """
  ---
  name: \(name)
  description: \(description)
  ---

  # \(title)

  \(body)
  """
}

private func jsonObject<T: Encodable>(_ value: T) throws -> [String: Any] {
  try #require(
    JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any]
  )
}

private func symbolicLinkDestination(at url: URL) -> String? {
  try? FileManager.default.destinationOfSymbolicLink(atPath: url.path)
}

private func temporarySkillsRoot() throws -> URL {
  try FileManager.default.url(
    for: .itemReplacementDirectory,
    in: .userDomainMask,
    appropriateFor: FileManager.default.temporaryDirectory,
    create: true
  )
}
