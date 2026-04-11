import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPOnboardingInteractionTests {
  private let intro = "Glad to have you onboard with Supaterm, let's get you setup.\n"

  @Test
  func runSkipsConfiguredAgents() {
    let input = ScriptedInput([])
    let output = OutputRecorder()
    let installs = InstallRecorder()

    let result = SPOnboardingInteraction(
      integrations: [
        integration(agent: .claude, isConfigured: { true }, installs: installs),
        integration(agent: .codex, isConfigured: { true }, installs: installs),
        integration(agent: .pi, isAvailable: { true }, isConfigured: { true }, installs: installs),
      ],
      skillIntegrations: [],
      io: .init(readLine: input.readLine, write: output.write)
    ).run()

    #expect(result == .init(didWriteOutput: false))
    #expect(output.text.isEmpty)
    #expect(installs.agents.isEmpty)
  }

  @Test
  func runPromptsOnceForMissingIntegrationsAndInstallsAllWhenAccepted() {
    let input = ScriptedInput(["y"])
    let output = OutputRecorder()
    let installs = InstallRecorder()

    let result = SPOnboardingInteraction(
      integrations: [
        integration(agent: .claude, isConfigured: { false }, installs: installs),
        integration(agent: .codex, isConfigured: { false }, installs: installs),
      ],
      skillIntegrations: [],
      io: .init(readLine: input.readLine, write: output.write)
    ).run()

    #expect(result == .init(didWriteOutput: true))
    #expect(output.text.contains(intro))
    #expect(
      output.text.contains(
        "Set up Supaterm coding-agent hooks for Claude Code and Codex? [y/N] "
      )
    )
    #expect(output.text.contains("Configuring Claude Code hooks...\n"))
    #expect(output.text.contains("Configuring Codex hooks...\n"))
    #expect(output.text.contains("Configured Claude Code hooks.\n"))
    #expect(output.text.contains("Configured Codex hooks.\n"))
    #expect(installs.agents == [.claude, .codex])
  }

  @Test
  func runPromptsForAvailablePiAndShowsInstallCommand() {
    let input = ScriptedInput(["y"])
    let output = OutputRecorder()
    let installs = InstallRecorder()

    let result = SPOnboardingInteraction(
      integrations: [
        integration(agent: .pi, isAvailable: { true }, isConfigured: { false }, installs: installs)
      ],
      skillIntegrations: [],
      io: .init(readLine: input.readLine, write: output.write)
    ).run()

    #expect(result == .init(didWriteOutput: true))
    #expect(output.text.contains(intro))
    #expect(output.text.contains("Set up Supaterm coding-agent hooks for Pi? [y/N] "))
    #expect(output.text.contains("Installing the Supaterm Pi package...\n"))
    #expect(output.text.contains("Running: \(PiSettingsInstaller.canonicalInstallDisplayCommand)\n"))
    #expect(output.text.contains("Installed the Supaterm Pi package.\n"))
    #expect(installs.agents == [.pi])
  }

  @Test
  func runForcePromptsConfiguredAgentsAndInstallsWhenAccepted() {
    let input = ScriptedInput(["yes"])
    let output = OutputRecorder()
    let installs = InstallRecorder()

    let result = SPOnboardingInteraction(
      force: true,
      integrations: [
        integration(agent: .claude, isConfigured: { true }, installs: installs),
        integration(agent: .codex, isConfigured: { true }, installs: installs),
      ],
      skillIntegrations: [],
      io: .init(readLine: input.readLine, write: output.write)
    ).run()

    #expect(result == .init(didWriteOutput: true))
    #expect(occurrenceCount(of: intro, in: output.text) == 1)
    #expect(
      output.text.contains(
        "Set up Supaterm coding-agent hooks for Claude Code and Codex? [y/N] "
      )
    )
    #expect(output.text.contains("Configured Claude Code hooks.\n"))
    #expect(output.text.contains("Configured Codex hooks.\n"))
    #expect(installs.agents == [.claude, .codex])
  }

  @Test
  func runForceSkipsUnavailablePi() {
    let input = ScriptedInput(["y"])
    let output = OutputRecorder()
    let installs = InstallRecorder()

    let result = SPOnboardingInteraction(
      force: true,
      integrations: [
        integration(agent: .pi, isAvailable: { false }, isConfigured: { false }, installs: installs)
      ],
      skillIntegrations: [],
      io: .init(readLine: input.readLine, write: output.write)
    ).run()

    #expect(result == .init(didWriteOutput: false))
    #expect(output.text.isEmpty)
    #expect(installs.agents.isEmpty)
  }

  @Test
  func runRepromptsUntilItReceivesValidAnswer() {
    let input = ScriptedInput(["later", "yes"])
    let output = OutputRecorder()
    let installs = InstallRecorder()

    let result = SPOnboardingInteraction(
      integrations: [
        integration(agent: .claude, isConfigured: { false }, installs: installs)
      ],
      skillIntegrations: [],
      io: .init(readLine: input.readLine, write: output.write)
    ).run()

    let prompt = "Set up Supaterm coding-agent hooks for Claude Code? [y/N] "

    #expect(result == .init(didWriteOutput: true))
    #expect(occurrenceCount(of: intro, in: output.text) == 1)
    #expect(occurrenceCount(of: prompt, in: output.text) == 2)
    #expect(output.text.contains("Enter y or n.\n"))
    #expect(installs.agents == [.claude])
  }

  @Test
  func runContinuesAfterInspectionFailure() {
    let input = ScriptedInput(["y"])
    let output = OutputRecorder()
    let installs = InstallRecorder()

    let result = SPOnboardingInteraction(
      integrations: [
        .init(
          displayName: "Claude Code",
          installCommand: nil,
          installFailureSubject: "Claude Code hooks",
          installVerb: "configure",
          progressMessage: "Configuring Claude Code hooks...\n",
          isAvailable: { true },
          isConfigured: { throw ClaudeSettingsInstallerError.invalidJSON },
          inspectionSubject: "Claude Code hooks",
          successMessage: "Configured Claude Code hooks.\n",
          install: {}
        ),
        integration(agent: .codex, isConfigured: { false }, installs: installs),
      ],
      skillIntegrations: [],
      io: .init(readLine: input.readLine, write: output.write)
    ).run()

    #expect(result == .init(didWriteOutput: true))
    #expect(
      output.text.contains(
        "Could not inspect Claude Code hooks: Claude settings must be valid JSON before Supaterm can install hooks.\n"
      )
    )
    #expect(output.text.contains(intro))
    #expect(output.text.contains("Set up Supaterm coding-agent hooks for Codex? [y/N] "))
    #expect(output.text.contains("Configured Codex hooks.\n"))
    #expect(installs.agents == [.codex])
  }

  @Test
  func runContinuesAfterInstallFailure() {
    let input = ScriptedInput(["yes"])
    let output = OutputRecorder()
    let installs = InstallRecorder()

    let result = SPOnboardingInteraction(
      integrations: [
        .init(
          displayName: "Claude Code",
          installCommand: nil,
          installFailureSubject: "Claude Code hooks",
          installVerb: "configure",
          progressMessage: "Configuring Claude Code hooks...\n",
          isAvailable: { true },
          isConfigured: { false },
          inspectionSubject: "Claude Code hooks",
          successMessage: "Configured Claude Code hooks.\n",
          install: {
            installs.record(.claude)
            throw ClaudeSettingsInstallerError.invalidRootObject
          }
        ),
        integration(agent: .codex, isConfigured: { false }, installs: installs),
      ],
      skillIntegrations: [],
      io: .init(readLine: input.readLine, write: output.write)
    ).run()

    #expect(result == .init(didWriteOutput: true))
    #expect(
      output.text.contains(
        "Could not configure Claude Code hooks: "
          + "Claude settings must be a JSON object before Supaterm can install hooks.\n"
      )
    )
    #expect(occurrenceCount(of: intro, in: output.text) == 1)
    #expect(
      output.text.contains(
        "Set up Supaterm coding-agent hooks for Claude Code and Codex? [y/N] "
      )
    )
    #expect(output.text.contains("Configured Codex hooks.\n"))
    #expect(installs.agents == [.claude, .codex])
  }

  @Test
  func interactivePromptingRequiresHumanTTYAndVisibleOutput() {
    #expect(shouldPromptInteractively(mode: .human, isQuiet: false, isInputTTY: true, isOutputTTY: true))
    #expect(!shouldPromptInteractively(mode: .json, isQuiet: false, isInputTTY: true, isOutputTTY: true))
    #expect(!shouldPromptInteractively(mode: .plain, isQuiet: false, isInputTTY: true, isOutputTTY: true))
    #expect(!shouldPromptInteractively(mode: .human, isQuiet: true, isInputTTY: true, isOutputTTY: true))
    #expect(!shouldPromptInteractively(mode: .human, isQuiet: false, isInputTTY: false, isOutputTTY: true))
    #expect(!shouldPromptInteractively(mode: .human, isQuiet: false, isInputTTY: true, isOutputTTY: false))
  }

  @Test
  func runPromptsSeparatelyForHooksAndSkill() {
    let input = ScriptedInput(["n", "y"])
    let output = OutputRecorder()
    let installs = InstallRecorder()

    let result = SPOnboardingInteraction(
      integrations: [
        integration(agent: .claude, isConfigured: { false }, installs: installs)
      ],
      skillIntegrations: [
        skillIntegration(isConfigured: { false }, installs: installs)
      ],
      io: .init(readLine: input.readLine, write: output.write)
    ).run()

    #expect(result == .init(didWriteOutput: true))
    #expect(occurrenceCount(of: intro, in: output.text) == 1)
    #expect(output.text.contains("Set up Supaterm coding-agent hooks for Claude Code? [y/N] "))
    #expect(output.text.contains("Setup agent skills to control Supaterm? [y/N] "))
    #expect(output.text.contains("Installing the Supaterm skill...\n"))
    #expect(output.text.contains("Running: \(SupatermSkillInstaller.automatedInstallCommand)\n"))
    #expect(output.text.contains("Installed the Supaterm skill.\n"))
    #expect(installs.agents.isEmpty)
    #expect(installs.skills == ["supaterm"])
  }

  @Test
  func runSkillInstallUnavailableShowsManualCommand() {
    let input = ScriptedInput(["y"])
    let output = OutputRecorder()
    let installs = InstallRecorder()

    let result = SPOnboardingInteraction(
      integrations: [],
      skillIntegrations: [
        .init(
          displayName: "Supaterm skill",
          installCommand: SupatermSkillInstaller.automatedInstallCommand,
          installFailureSubject: "the Supaterm skill",
          installVerb: "install",
          progressMessage: "Installing the Supaterm skill...\n",
          isAvailable: { true },
          isConfigured: { false },
          inspectionSubject: "the Supaterm skill",
          successMessage: "Installed the Supaterm skill.\n",
          install: {
            throw SupatermSkillInstallerError.npxUnavailable
          },
        )
      ],
      io: .init(readLine: input.readLine, write: output.write)
    ).run()

    #expect(result == .init(didWriteOutput: true))
    #expect(output.text.contains("Setup agent skills to control Supaterm? [y/N] "))
    #expect(
      output.text.contains(
        "Could not install the Supaterm skill: Install Node.js tooling and run "
          + "npx skills add supabitapp/supaterm --skill supaterm -g in a terminal.\n"
      )
    )
    #expect(installs.skills.isEmpty)
  }
}

private func integration(
  agent: SupatermAgentKind,
  isAvailable: @escaping @Sendable () throws -> Bool = { true },
  isConfigured: @escaping @Sendable () throws -> Bool,
  installs: InstallRecorder
) -> SPOnboardingInteraction.AgentIntegration {
  switch agent {
  case .claude:
    return .init(
      displayName: "Claude Code",
      installCommand: nil,
      installFailureSubject: "Claude Code hooks",
      installVerb: "configure",
      progressMessage: "Configuring Claude Code hooks...\n",
      isAvailable: isAvailable,
      isConfigured: isConfigured,
      inspectionSubject: "Claude Code hooks",
      successMessage: "Configured Claude Code hooks.\n",
      install: {
        installs.record(.claude)
      }
    )
  case .codex:
    return .init(
      displayName: "Codex",
      installCommand: nil,
      installFailureSubject: "Codex hooks",
      installVerb: "configure",
      progressMessage: "Configuring Codex hooks...\n",
      isAvailable: isAvailable,
      isConfigured: isConfigured,
      inspectionSubject: "Codex hooks",
      successMessage: "Configured Codex hooks.\n",
      install: {
        installs.record(.codex)
      }
    )
  case .pi:
    return .init(
      displayName: "Pi",
      installCommand: PiSettingsInstaller.canonicalInstallDisplayCommand,
      installFailureSubject: "the Supaterm Pi package",
      installVerb: "install",
      progressMessage: "Installing the Supaterm Pi package...\n",
      isAvailable: isAvailable,
      isConfigured: isConfigured,
      inspectionSubject: "Pi package",
      successMessage: "Installed the Supaterm Pi package.\n",
      install: {
        installs.record(.pi)
      }
    )
  }
}

private func skillIntegration(
  isAvailable: @escaping @Sendable () throws -> Bool = { true },
  isConfigured: @escaping @Sendable () throws -> Bool,
  installs: InstallRecorder
) -> SPOnboardingInteraction.AgentIntegration {
  .init(
    displayName: "Supaterm skill",
    installCommand: SupatermSkillInstaller.automatedInstallCommand,
    installFailureSubject: "the Supaterm skill",
    installVerb: "install",
    progressMessage: "Installing the Supaterm skill...\n",
    isAvailable: isAvailable,
    isConfigured: isConfigured,
    inspectionSubject: "the Supaterm skill",
    successMessage: "Installed the Supaterm skill.\n",
    install: {
      installs.recordSkill("supaterm")
    }
  )
}

private func occurrenceCount(
  of value: String,
  in text: String
) -> Int {
  text.components(separatedBy: value).count - 1
}

nonisolated final class ScriptedInput: @unchecked Sendable {
  private let lock = NSLock()
  private var values: [String?]

  init(_ values: [String?]) {
    self.values = values
  }

  func readLine() -> String? {
    lock.lock()
    defer { lock.unlock() }
    guard !values.isEmpty else { return nil }
    return values.removeFirst()
  }
}

nonisolated final class OutputRecorder: @unchecked Sendable {
  private let lock = NSLock()
  private var value = ""

  func write(_ value: String) {
    lock.lock()
    self.value += value
    lock.unlock()
  }

  var text: String {
    lock.lock()
    let text = value
    lock.unlock()
    return text
  }
}

nonisolated final class InstallRecorder: @unchecked Sendable {
  private let lock = NSLock()
  private var value: [SupatermAgentKind] = []
  private var skillValue: [String] = []

  func record(_ agent: SupatermAgentKind) {
    lock.lock()
    value.append(agent)
    lock.unlock()
  }

  func recordSkill(_ skill: String) {
    lock.lock()
    skillValue.append(skill)
    lock.unlock()
  }

  var agents: [SupatermAgentKind] {
    lock.lock()
    let agents = value
    lock.unlock()
    return agents
  }

  var skills: [String] {
    lock.lock()
    let skills = skillValue
    lock.unlock()
    return skills
  }
}
