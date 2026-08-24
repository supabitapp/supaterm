import Foundation
import Testing

@testable import SupatermSupport
@testable import supaterm

struct AgentDetectionRuleSourceTests {
  @Test
  func repositoryLoadsBundledManifests() async throws {
    let repository = try AgentDetectionRuleRepository(bundle: SupatermResources.bundle)
    let snapshot = await repository.snapshot()

    #expect(snapshot.generation > 0)
    #expect(snapshot.processManifests.map(\.agentID) == ["claude", "codex", "pi"])
    #expect(snapshot.manifests.map(\.source.origin) == [.bundled, .bundled, .bundled])
  }

  @Test
  func knownAgentWithoutMatchingEvidenceFallsBackToUnknown() async throws {
    let repository = try AgentDetectionRuleRepository(bundle: SupatermResources.bundle)
    let evaluations = await repository.evaluate([
      AgentDetectionEvaluationRequest(
        agentID: "pi",
        input: AgentDetectionInput(screen: "", oscTitle: "")
      )
    ])
    let evaluation = try #require(evaluations[0])

    #expect(evaluation.identity == AgentDetectionAgentIdentity(id: "pi", displayName: "Pi"))
    #expect(evaluation.match.result == .unknown)
    #expect(evaluation.match.ruleID == AgentDetectionMatcher.fallbackRuleID)
  }

  @Test
  func signalEvaluationStopsBeforeScreenCaptureWhenDecisive() async throws {
    let repository = try AgentDetectionRuleRepository(bundle: SupatermResources.bundle)
    let evaluations = await repository.evaluateSignals([
      AgentDetectionSignalRequest(
        agentID: "codex",
        input: AgentDetectionSignalInput(oscTitle: "⠋ project")
      ),
      AgentDetectionSignalRequest(
        agentID: "pi",
        input: AgentDetectionSignalInput(oscTitle: "")
      ),
    ])

    let codex = try #require(evaluations[0])
    let pi = try #require(evaluations[1])
    guard case .matched(let codexEvaluation) = codex else {
      Issue.record("Expected a decisive signal match.")
      return
    }
    guard case .needsScreen = pi else {
      Issue.record("Expected screen evaluation.")
      return
    }

    #expect(codexEvaluation.match.ruleID == "osc_title_working")
    #expect(codexEvaluation.match.result == .running)
  }

  @Test
  func unknownAgentCannotSelectRules() async throws {
    let repository = try AgentDetectionRuleRepository(bundle: SupatermResources.bundle)
    let evaluations = await repository.evaluate([
      AgentDetectionEvaluationRequest(
        agentID: "unknown",
        input: AgentDetectionInput(screen: "Working...", oscTitle: "")
      )
    ])

    #expect(evaluations == [nil])
  }

  @Test
  func repositoryReloadsLocalManifestsAtomically() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString,
      isDirectory: true
    )
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let manifestURL = directory.appendingPathComponent("pi.toml", isDirectory: false)
    try Data(
      """
      id = "pi"
      version = "local.1"

      [[rules]]
      id = "local_working"
      state = "working"
      contains = ["local signal"]
      """.utf8
    ).write(to: manifestURL)
    let repository = try AgentDetectionRuleRepository(
      bundle: SupatermResources.bundle,
      overrideDirectoryURL: directory
    )

    let initial = await repository.snapshot()
    let pi = try #require(initial.manifests.first(where: { $0.agent.id == "pi" }))
    #expect(pi.version == "local.1")
    #expect(pi.source == AgentDetectionManifestSource(origin: .local, path: manifestURL.path))
    #expect(
      await repository.evaluate([
        AgentDetectionEvaluationRequest(
          agentID: "pi",
          input: AgentDetectionInput(screen: "local signal", oscTitle: "")
        )
      ])[0]?.match.result == .running
    )

    try Data(
      """
      id = "pi"
      version = "local.2"

      [[rules]]
      id = "local_idle"
      state = "idle"
      visible_idle = true
      contains = ["local signal"]
      """.utf8
    ).write(to: manifestURL)
    let reloaded = try await repository.reload()
    #expect(reloaded.generation != initial.generation)
    #expect(reloaded.manifests.first(where: { $0.agent.id == "pi" })?.version == "local.2")
    #expect(
      await repository.evaluate([
        AgentDetectionEvaluationRequest(
          agentID: "pi",
          input: AgentDetectionInput(screen: "local signal", oscTitle: "")
        )
      ])[0]?.match.result == .idle
    )

    try Data("id = \"pi\"\ninvalid = true\n".utf8).write(to: manifestURL)
    do {
      _ = try await repository.reload()
      Issue.record("Expected the invalid local manifest to fail.")
    } catch {
      #expect(error.localizedDescription.contains(manifestURL.path))
    }
    #expect(await repository.snapshot() == reloaded)
  }

  @Test
  func startupCanFallBackToBundledRulesWithoutAcceptingInvalidReloads() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString,
      isDirectory: true
    )
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let manifestURL = directory.appendingPathComponent("pi.toml", isDirectory: false)
    try Data("id = \"pi\"\ninvalid = true\n".utf8).write(to: manifestURL)

    let repository = try AgentDetectionRuleRepository(
      bundle: SupatermResources.bundle,
      overrideDirectoryURL: directory,
      fallsBackToBundledRules: true
    )
    let snapshot = await repository.snapshot()

    #expect(repository.startupFallbackErrorDescription?.contains(manifestURL.path) == true)
    #expect(snapshot.manifests.allSatisfy { $0.source.origin == .bundled })
    await #expect(throws: AgentDetectionRuleSetError.self) {
      try await repository.reload()
    }
    #expect(await repository.snapshot() == snapshot)
  }
}
