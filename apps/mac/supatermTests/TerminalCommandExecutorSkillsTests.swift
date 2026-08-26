import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct TerminalCommandExecutorSkillsTests {
  @Test
  func listReturnsEveryBundledSkill() throws {
    let harness = try SkillsHarness()
    defer { harness.remove() }

    let result = try harness.commandExecutor.skillsList(harness.skills)

    #expect(
      result
        == SupatermSkillListResult(
          skills: [
            SupatermSkillSummary(name: "coding-agents", description: "Launch coding agents."),
            SupatermSkillSummary(name: "core", description: "Control Supaterm."),
          ]
        )
    )
  }

  @Test
  func getReturnsTheDefinitionAndOnlyIncludesFilesWhenFull() throws {
    let harness = try SkillsHarness()
    defer { harness.remove() }

    let skill = try harness.commandExecutor.skillsGet(
      SupatermSkillGetRequest(name: "core"),
      skills: harness.skills
    )
    let full = try harness.commandExecutor.skillsGet(
      SupatermSkillGetRequest(name: "core", full: true),
      skills: harness.skills
    )

    #expect(skill.name == "core")
    #expect(skill.content.contains("# Core"))
    #expect(skill.files == nil)
    #expect(
      full.files == [
        SupatermSkillFile(path: "references/panes.md", content: "Panes\n"),
        SupatermSkillFile(path: "references/tabs.md", content: "Tabs\n"),
      ]
    )
  }

  @Test
  func pathReturnsTheBundledSkillDirectory() throws {
    let harness = try SkillsHarness()
    defer { harness.remove() }

    let result = try harness.commandExecutor.skillsPath(
      SupatermSkillPathRequest(name: "core"),
      skills: harness.skills
    )

    #expect(
      result
        == SupatermSkillPathResult(
          path: skillDataURL(harness.bundledSkillsDirectoryURL)
            .appendingPathComponent("core")
            .path
        )
    )
  }

  @Test
  func installCopiesTheDiscoverySkillIntoTheHomeDirectory() throws {
    let harness = try SkillsHarness()
    defer { harness.remove() }

    let result = try harness.commandExecutor.skillsInstall(harness.skills)

    let installedDirectoryURL = SupatermSkills.skillDirectoryURL(
      homeDirectoryURL: harness.homeDirectoryURL
    )
    #expect(result == SupatermSkillInstallResult(path: installedDirectoryURL.path))
    #expect(
      FileManager.default.fileExists(
        atPath: SupatermSkills.skillDefinitionURL(skillDirectoryURL: installedDirectoryURL).path
      )
    )
  }

  @Test
  func unknownSkillsFailWithTheSkillNotFoundMessage() throws {
    let harness = try SkillsHarness()
    defer { harness.remove() }

    #expect(throws: SupatermSkillsError.skillNotFound("missing")) {
      try harness.commandExecutor.skillsGet(
        SupatermSkillGetRequest(name: "missing"),
        skills: harness.skills
      )
    }
    #expect(throws: SupatermSkillsError.skillNotFound("missing")) {
      try harness.commandExecutor.skillsPath(
        SupatermSkillPathRequest(name: "missing"),
        skills: harness.skills
      )
    }
    #expect(
      SupatermSkillsError.skillNotFound("missing").localizedDescription
        == "Skill not found: missing. Run `sp skills list` to see available skills."
    )
  }
}

@MainActor
private struct SkillsHarness {
  let rootURL: URL
  let homeDirectoryURL: URL
  let bundledSkillsDirectoryURL: URL
  let registry: TerminalWindowRegistry
  let commandExecutor: TerminalCommandExecutor

  init() throws {
    rootURL = try temporarySkillsRoot()
    homeDirectoryURL = rootURL.appendingPathComponent("home", isDirectory: true)
    bundledSkillsDirectoryURL = try bundledSkillsDirectory(in: rootURL)
    registry = TerminalWindowRegistry.test()
    commandExecutor = makeCommandExecutor(registry: registry)
  }

  var skills: SupatermSkills {
    SupatermSkills(
      homeDirectoryURL: homeDirectoryURL,
      bundledSkillsDirectoryURL: bundledSkillsDirectoryURL
    )
  }

  func remove() {
    try? FileManager.default.removeItem(at: rootURL)
  }
}
