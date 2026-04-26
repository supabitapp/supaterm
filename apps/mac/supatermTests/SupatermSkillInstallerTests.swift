import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermSkillInstallerTests {
  @Test
  func hasSupatermSkillInstalledChecksSkillFile() throws {
    let homeDirectoryURL = try temporarySkillHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let skillDefinitionURL = SupatermSkillInstaller.skillDefinitionURL(homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(
      at: skillDefinitionURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data("name: supaterm".utf8).write(to: skillDefinitionURL)

    let installer = SupatermSkillInstaller(
      homeDirectoryURL: homeDirectoryURL,
      checkNPXAvailable: { true },
      runInstallCommand: { _ in
        .init(status: 0, standardError: "")
      }
    )

    #expect(installer.hasSupatermSkillInstalled())
  }

  @Test
  func installUsesAutomatedGlobalNPXCommand() throws {
    let capture = SkillCommandCapture()
    let installer = SupatermSkillInstaller(
      checkNPXAvailable: { true },
      runInstallCommand: { arguments in
        capture.record(arguments)
        return .init(status: 0, standardError: "")
      }
    )

    try installer.installSupatermSkill()

    #expect(
      capture.commands == [
        SupatermSkillInstaller.automatedInstallCommandArguments()
      ]
    )
  }

  @Test
  func manualInstallCommandTargetsGlobalSupatermSkill() {
    #expect(
      SupatermSkillInstaller.manualInstallCommand
        == "npx skills add supabitapp/supaterm-skills --skill supaterm -g"
    )
  }

  @Test
  func manualComputerUseInstallCommandTargetsComputerUseSkill() {
    #expect(
      SupatermSkillInstaller.manualComputerUseInstallCommand
        == "npx skills add supabitapp/supaterm-skills --skill supaterm-computer-use -g"
    )
  }

  @Test
  func automatedInstallCommandArgumentsUseInteractiveLoginShell() {
    #expect(
      SupatermSkillInstaller.automatedInstallCommandArguments()
        == ["-l", "-i", "-c", "npx skills add supabitapp/supaterm-skills --skill supaterm -g -y"]
    )
  }

  @Test
  func installFailsWhenNPXIsUnavailable() {
    let installer = SupatermSkillInstaller(
      checkNPXAvailable: { false },
      runInstallCommand: { _ in
        Issue.record("runInstallCommand should not be called when npx is unavailable.")
        return .init(status: 0, standardError: "")
      }
    )

    #expect(throws: SupatermSkillInstallerError.npxUnavailable) {
      try installer.installSupatermSkill()
    }
  }

  @Test
  func installSurfacesFailureOutput() {
    let installer = SupatermSkillInstaller(
      checkNPXAvailable: { true },
      runInstallCommand: { _ in
        .init(status: 1, standardError: "skills install failed")
      }
    )

    #expect(throws: SupatermSkillInstallerError.installFailed("skills install failed")) {
      try installer.installSupatermSkill()
    }
  }
}

private func temporarySkillHomeDirectory() throws -> URL {
  try FileManager.default.url(
    for: .itemReplacementDirectory,
    in: .userDomainMask,
    appropriateFor: FileManager.default.temporaryDirectory,
    create: true
  )
}

nonisolated final class SkillCommandCapture: @unchecked Sendable {
  private let lock = NSLock()
  private var value: [[String]] = []

  func record(_ arguments: [String]) {
    lock.lock()
    value.append(arguments)
    lock.unlock()
  }

  var commands: [[String]] {
    lock.lock()
    let commands = value
    lock.unlock()
    return commands
  }
}
