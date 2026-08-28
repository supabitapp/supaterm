import Foundation
import SupatermCLIShared
import Testing

struct SPAgentDetectionCommandTests {
  @Test
  func reloadRulesPrintsEveryActiveManifestSource() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let reload = SupatermAgentDetectionReloadResult(
      generation: 42,
      overrideDirectory: "/tmp/agent-detection",
      manifests: [
        SupatermAgentDetectionManifestInfo(
          agentID: "codex",
          displayName: "Codex",
          version: "local.1",
          origin: .local,
          path: "/tmp/agent-detection/codex.toml"
        )
      ]
    )

    try await withSocketRuntime(
      replying: { request, _ in
        #expect(request.method == SupatermSocketMethod.appAgentDetectionReload)
        return try .ok(id: request.id, encodableResult: reload)
      },
      run: { endpoint in
        let result = try cli.run([
          "agent", "reload-rules", "--socket", endpoint.path,
        ])

        #expect(result.exitCode == 0)
        #expect(result.stderr.isEmpty)
        #expect(result.stdout.contains("generation\t42\n"))
        #expect(
          result.stdout.contains(
            "manifest\tcodex\tlocal.1\tlocal\t/tmp/agent-detection/codex.toml"
          )
        )
      }
    )
  }
}
