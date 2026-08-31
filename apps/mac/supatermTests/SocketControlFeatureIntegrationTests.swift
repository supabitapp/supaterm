import ComposableArchitecture
import Foundation
import SupatermSocketFeature
import Testing

@testable import SPCLI
@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct SocketControlFeatureIntegrationTests {
  @Test
  func agentIntegrationSetupRoutesTheAgentAndRepliesWithHealth() async throws {
    let response = try await socketResponse(
      #"{"id":"agent-integration-setup-1","method":"app.agent_integration.setup","params":{"agent":"claude"}}"#,
      executeAgentIntegration: { request in
        guard case .agentIntegrationSetup(let payload) = request else {
          throw UnexpectedRequest()
        }
        #expect(payload == SupatermAgentIntegrationRequest(agent: .claude))
        return .agentIntegrationSetup(
          SupatermAgentIntegrationResult(agent: .claude, health: .healthy)
        )
      }
    )

    #expect(
      try jsonString(response)
        == #"{"id":"agent-integration-setup-1","ok":true,"result":{"agent":"claude","health":"healthy"}}"#
    )
  }

  @Test
  func hooksRemoveRoutesTheAgentAndRepliesWithHealth() async throws {
    let response = try await socketResponse(
      #"{"id":"hooks-remove-1","method":"app.hooks.remove","params":{"agent":"codex"}}"#,
      executeAgentIntegration: { request in
        guard case .hooksRemove(let payload) = request else {
          throw UnexpectedRequest()
        }
        #expect(payload == SupatermAgentIntegrationRequest(agent: .codex))
        return .hooksRemove(SupatermAgentIntegrationResult(agent: .codex, health: .absent))
      }
    )

    #expect(
      try jsonString(response)
        == #"{"id":"hooks-remove-1","ok":true,"result":{"agent":"codex","health":"absent"}}"#
    )
  }

  @Test(
    arguments: [
      #"{"id":"agent-integration-setup-2","method":"app.agent_integration.setup","params":{"agent":"gemini"}}"#,
      #"{"id":"agent-integration-setup-2","method":"app.agent_integration.setup","params":{}}"#,
    ]
  )
  func agentIntegrationSetupRejectsAnUnusableAgentParameter(json: String) async throws {
    let response = try await socketResponse(
      json,
      executeAgentIntegration: { _ in
        Issue.record("The executor must not run for an invalid agent parameter.")
        throw UnexpectedRequest()
      }
    )

    #expect(response.ok == false)
    #expect(response.id == "agent-integration-setup-2")
    #expect(response.error?.code == "invalid_request")
  }

  @Test
  func agentIntegrationSetupRepliesWithTheInstallerMessage() async throws {
    let response = try await socketResponse(
      #"{"id":"agent-integration-setup-3","method":"app.agent_integration.setup","params":{"agent":"claude"}}"#,
      executeAgentIntegration: { _ in
        throw ClaudeSettingsInstallerError.invalidJSON
      }
    )

    #expect(
      try jsonString(response) == """
        {"error":{"code":"internal_error","message":\
        "Claude settings must be valid JSON before Supaterm can install hooks."},\
        "id":"agent-integration-setup-3","ok":false}
        """
    )
  }

  @Test
  func skillsListRepliesWithEverySummary() async throws {
    let response = try await socketResponse(
      #"{"id":"skills-list-1","method":"app.skills.list","params":{}}"#,
      executeAgentIntegration: { request in
        guard case .skillsList = request else {
          throw UnexpectedRequest()
        }
        return .skillsList(
          SupatermSkillListResult(
            skills: [SupatermSkillSummary(name: "core", description: "Control Supaterm.")]
          )
        )
      }
    )

    #expect(
      try jsonString(response) == """
        {"id":"skills-list-1","ok":true,"result":{"skills":\
        [{"description":"Control Supaterm.","name":"core"}]}}
        """
    )
  }

  @Test
  func skillsGetRoutesNameAndFull() async throws {
    let response = try await socketResponse(
      #"{"id":"skills-get-1","method":"app.skills.get","params":{"full":true,"name":"core"}}"#,
      executeAgentIntegration: { request in
        guard case .skillsGet(let payload) = request else {
          throw UnexpectedRequest()
        }
        #expect(payload == SupatermSkillGetRequest(name: "core", full: true))
        return .skillsGet(
          SupatermSkillContent(
            name: "core",
            content: "# Core\n",
            files: [SupatermSkillFile(path: "references/tabs.md", content: "Tabs\n")]
          )
        )
      }
    )

    #expect(
      try jsonString(response) == """
        {"id":"skills-get-1","ok":true,"result":{"content":"# Core\\n","files":\
        [{"content":"Tabs\\n","path":"references\\/tabs.md"}],"name":"core"}}
        """
    )
  }

  @Test
  func skillsPathRepliesWithTheSkillDirectory() async throws {
    let response = try await socketResponse(
      #"{"id":"skills-path-1","method":"app.skills.path","params":{"name":"core"}}"#,
      executeAgentIntegration: { request in
        guard case .skillsPath(let payload) = request else {
          throw UnexpectedRequest()
        }
        #expect(payload == SupatermSkillPathRequest(name: "core"))
        return .skillsPath(SupatermSkillPathResult(path: "/tmp/skill-data/core"))
      }
    )

    #expect(
      try jsonString(response) == """
        {"id":"skills-path-1","ok":true,"result":{"path":"\\/tmp\\/skill-data\\/core"}}
        """
    )
  }

  @Test
  func skillsInstallRepliesWithTheInstalledPath() async throws {
    let response = try await socketResponse(
      #"{"id":"skills-install-1","method":"app.skills.install","params":{}}"#,
      executeAgentIntegration: { request in
        guard case .skillsInstall = request else {
          throw UnexpectedRequest()
        }
        return .skillsInstall(SupatermSkillInstallResult(path: "/tmp/home/.agents/skills/supaterm"))
      }
    )

    #expect(
      try jsonString(response) == """
        {"id":"skills-install-1","ok":true,"result":\
        {"path":"\\/tmp\\/home\\/.agents\\/skills\\/supaterm"}}
        """
    )
  }

  @Test
  func skillsGetRepliesWithNotFoundForAnUnknownSkill() async throws {
    let response = try await socketResponse(
      #"{"id":"skills-get-2","method":"app.skills.get","params":{"full":false,"name":"missing"}}"#,
      executeAgentIntegration: { _ in
        throw SupatermSkillsError.skillNotFound("missing")
      }
    )

    #expect(
      try jsonString(response) == """
        {"error":{"code":"not_found","message":\
        "Skill not found: missing. Run `sp skills list` to see available skills."},\
        "id":"skills-get-2","ok":false}
        """
    )
  }

  @Test
  func skillsListRepliesWithAnInternalErrorForMissingBundledSkills() async throws {
    let response = try await socketResponse(
      #"{"id":"skills-list-2","method":"app.skills.list","params":{}}"#,
      executeAgentIntegration: { _ in
        throw SupatermSkillsError.bundledSkillsUnavailable("/tmp/Resources")
      }
    )

    #expect(response.error?.code == "internal_error")
    #expect(response.error?.message == "Supaterm bundled skills are missing at /tmp/Resources.")
  }

  @Test
  func settingsValidateRoutesTheExplicitPath() async throws {
    let response = try await socketResponse(
      """
      {"id":"settings-validate-1","method":"app.settings.validate",\
      "params":{"path":"/tmp/settings.toml"}}
      """,
      executeApp: { request in
        guard case .settingsValidate(let payload) = request else {
          throw UnexpectedRequest()
        }
        #expect(payload == SupatermSettingsValidateRequest(path: "/tmp/settings.toml"))
        return .settingsValidate(
          SupatermSettingsValidationResult(
            path: "/tmp/settings.toml",
            status: .valid,
            warnings: ["Unknown config key `obsolete`."],
            errors: []
          )
        )
      }
    )

    #expect(
      try jsonString(response) == """
        {"id":"settings-validate-1","ok":true,"result":{"errors":[],\
        "path":"\\/tmp\\/settings.toml","status":"valid",\
        "warnings":["Unknown config key `obsolete`."]}}
        """
    )
  }

  @Test
  func settingsValidateWithoutAPathUsesTheDefaultFile() async throws {
    let response = try await socketResponse(
      #"{"id":"settings-validate-2","method":"app.settings.validate","params":{}}"#,
      executeApp: { request in
        guard case .settingsValidate(let payload) = request else {
          throw UnexpectedRequest()
        }
        #expect(payload == SupatermSettingsValidateRequest())
        return .settingsValidate(
          SupatermSettingsValidationResult(
            path: "/tmp/settings.toml",
            status: .missing,
            warnings: [],
            errors: []
          )
        )
      }
    )

    #expect(
      try jsonString(response) == """
        {"id":"settings-validate-2","ok":true,"result":{"errors":[],\
        "path":"\\/tmp\\/settings.toml","status":"missing","warnings":[]}}
        """
    )
  }
}

private struct UnexpectedRequest: Error {}

@MainActor
private func socketResponse(
  _ json: String,
  executeApp: (
    @MainActor @Sendable (SocketRequestExecutor.AppRequest) async throws -> SocketRequestExecutor.AppResult
  )? = nil,
  executeAgentIntegration: (
    @MainActor @Sendable (
      SocketRequestExecutor.AgentIntegrationRequest
    ) async throws -> SocketRequestExecutor.AgentIntegrationResult
  )? = nil
) async throws -> SupatermSocketResponse {
  let recorder = SocketReplyRecorder()
  let handle = UUID()
  let payload = try JSONDecoder().decode(SupatermSocketRequest.self, from: Data(json.utf8))
  let store = makeStore(
    updateDependencies: {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    },
    executeApp: executeApp,
    executeAgentIntegration: executeAgentIntegration
  )

  await store.send(.requestReceived(SocketControlClient.Request(handle: handle, payload: payload)))

  let records = await recorder.snapshot()
  #expect(records.count == 1)
  #expect(records.first?.handle == handle)
  return try #require(records.first?.response)
}
