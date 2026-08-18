import Darwin
import Foundation
import Synchronization
import Testing

@testable import SupatermSupport

nonisolated struct AgentDetectionProcessRecognizerTests {
  private static let foregroundProcessGroupID: pid_t = 400

  private static let codex = AgentDetectionProcessManifest(
    agentID: "codex",
    processes: [AgentDetectionProcessRule(executable: "codex")]
  )

  private static let claude = AgentDetectionProcessManifest(
    agentID: "claude",
    processes: [
      AgentDetectionProcessRule(executable: "claude"),
      AgentDetectionProcessRule(
        executable: "node",
        scriptSuffix: "/@anthropic-ai/claude-code/cli.js"
      ),
    ]
  )

  private static func process(
    _ processID: pid_t,
    parentProcessID: pid_t = 1,
    processGroupID: pid_t = foregroundProcessGroupID,
    startTimeMicroseconds: UInt64? = nil,
    name: String
  ) -> ProcessEntry {
    ProcessEntry(
      identity: TerminalAgentProcessIdentity(
        processID: processID,
        startTimeMicroseconds: startTimeMicroseconds ?? UInt64(processID)
      ),
      parentProcessID: parentProcessID,
      processGroupID: processGroupID,
      name: name
    )
  }

  private static func invocation(
    _ executablePath: String,
    arguments: [String]
  ) -> ProcessInvocation {
    ProcessInvocation(
      executablePath: executablePath,
      arguments: arguments,
      terminalType: nil
    )
  }

  private static func match(
    entries: [ProcessEntry],
    invocations: [pid_t: ProcessInvocation],
    manifests: [AgentDetectionProcessManifest] = [codex, claude],
    foregroundProcessGroupID: pid_t = foregroundProcessGroupID
  ) -> AgentDetectionProcessMatch? {
    AgentDetectionProcessRecognizer.matches(
      foregroundProcessGroupIDs: [foregroundProcessGroupID],
      manifests: manifests,
      table: ProcessTable(entries: entries),
      invocation: { invocations[$0] }
    )[foregroundProcessGroupID]
  }

  @Test
  func batchSnapshotsTheProcessTableOnce() {
    let snapshotCount = Mutex(0)
    _ = AgentDetectionProcessRecognizer.matches(
      foregroundProcessGroupIDs: [
        Self.foregroundProcessGroupID,
        Self.foregroundProcessGroupID + 1,
      ],
      manifests: [Self.codex],
      table: {
        snapshotCount.withLock { $0 += 1 }
        return ProcessTable(entries: [])
      },
      invocation: { _ in nil }
    )

    #expect(snapshotCount.withLock { $0 } == 1)
  }

  @Test
  func matchesEachRequestedForegroundGroupFromOneTable() {
    let secondProcessGroupID = Self.foregroundProcessGroupID + 1
    let unrequestedProcessGroupID = secondProcessGroupID + 1
    let invocations: [pid_t: ProcessInvocation] = [
      100: Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"]),
      200: Self.invocation("/opt/homebrew/bin/claude", arguments: ["claude"]),
      300: Self.invocation("/tmp/should-not-be-read", arguments: ["codex"]),
    ]
    let matches = AgentDetectionProcessRecognizer.matches(
      foregroundProcessGroupIDs: [Self.foregroundProcessGroupID, secondProcessGroupID],
      manifests: [Self.codex, Self.claude],
      table: ProcessTable(
        entries: [
          Self.process(100, name: "codex"),
          Self.process(
            200,
            processGroupID: secondProcessGroupID,
            name: "claude"
          ),
          Self.process(
            300,
            processGroupID: unrequestedProcessGroupID,
            name: "codex"
          ),
        ]
      ),
      invocation: { invocations[$0] }
    )

    #expect(
      matches
        == [
          Self.foregroundProcessGroupID: AgentDetectionProcessMatch(
            agentID: "codex",
            processIdentity: TerminalAgentProcessIdentity(
              processID: 100,
              startTimeMicroseconds: 100
            )
          ),
          secondProcessGroupID: AgentDetectionProcessMatch(
            agentID: "claude",
            processIdentity: TerminalAgentProcessIdentity(
              processID: 200,
              startTimeMicroseconds: 200
            )
          ),
        ]
    )
  }

  @Test
  func batchIgnoresNonpositiveAndUnavailableGroups() {
    let invocation = Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"])
    let matches = AgentDetectionProcessRecognizer.matches(
      foregroundProcessGroupIDs: [Int32.min, -1, 0, 999],
      manifests: [Self.codex],
      table: ProcessTable(entries: [Self.process(100, name: "codex")]),
      invocation: { _ in invocation }
    )

    #expect(matches.isEmpty)
  }

  @Test
  func matchesExactExecutable() {
    let result = Self.match(
      entries: [Self.process(100, name: "codex")],
      invocations: [
        100: Self.invocation(
          "/opt/homebrew/bin/codex",
          arguments: ["codex", "--resume"]
        )
      ]
    )

    #expect(
      result
        == AgentDetectionProcessMatch(
          agentID: "codex",
          processIdentity: TerminalAgentProcessIdentity(
            processID: 100,
            startTimeMicroseconds: 100
          )
        )
    )
  }

  @Test
  func ignoresProcessesOutsideTheForegroundGroup() {
    let backgroundGroupID = Self.foregroundProcessGroupID + 1
    let result = Self.match(
      entries: [
        Self.process(
          100,
          processGroupID: backgroundGroupID,
          name: "codex"
        )
      ],
      invocations: [
        100: Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"])
      ]
    )

    #expect(result == nil)
  }

  @Test
  func matchesDeclaredWrappersByOneCompleteScriptArgument() {
    let cases: [(path: String, arguments: [String])] = [
      ("/opt/homebrew/bin/node", ["node", "/pkg/agent/cli.js", "--resume"]),
      ("/usr/bin/python3", ["python3", "-u", "/pkg/agent/cli.js"]),
      ("/bin/sh", ["sh", "/pkg/agent/cli.js"]),
      ("/usr/bin/env", ["env", "node", "/pkg/agent/cli.js"]),
    ]

    for wrapper in cases {
      let executable = URL(fileURLWithPath: wrapper.path).lastPathComponent
      let manifest = AgentDetectionProcessManifest(
        agentID: "agent",
        processes: [
          AgentDetectionProcessRule(
            executable: executable,
            scriptSuffix: "/agent/cli.js"
          )
        ]
      )
      let result = Self.match(
        entries: [Self.process(100, name: executable)],
        invocations: [
          100: Self.invocation(wrapper.path, arguments: wrapper.arguments)
        ],
        manifests: [manifest]
      )

      #expect(
        result
          == AgentDetectionProcessMatch(
            agentID: "agent",
            processIdentity: TerminalAgentProcessIdentity(
              processID: 100,
              startTimeMicroseconds: 100
            )
          )
      )
    }
  }

  @Test
  func matchesDeclaredProcessTitleAfterArgumentsAreRewritten() {
    let manifest = AgentDetectionProcessManifest(
      agentID: "agent",
      processes: [
        AgentDetectionProcessRule(executable: "node", processTitle: "pi")
      ]
    )
    let result = Self.match(
      entries: [Self.process(100, name: "node")],
      invocations: [
        100: Self.invocation("/opt/homebrew/bin/node", arguments: ["pi"])
      ],
      manifests: [manifest]
    )

    #expect(
      result
        == AgentDetectionProcessMatch(
          agentID: "agent",
          processIdentity: TerminalAgentProcessIdentity(
            processID: 100,
            startTimeMicroseconds: 100
          )
        )
    )
  }

  @Test
  func declaredProcessTitleRequiresMatchingExecutableAndTitle() {
    let manifest = AgentDetectionProcessManifest(
      agentID: "agent",
      processes: [
        AgentDetectionProcessRule(executable: "node", processTitle: "pi")
      ]
    )
    let cases = [
      (
        Self.process(100, name: "python3"),
        Self.invocation("/opt/homebrew/bin/node", arguments: ["pi"])
      ),
      (
        Self.process(100, name: "node"),
        Self.invocation("/opt/homebrew/bin/node", arguments: ["other"])
      ),
      (
        Self.process(100, name: "node"),
        Self.invocation("/usr/bin/python3", arguments: ["pi"])
      ),
    ]

    for (entry, invocation) in cases {
      let result = Self.match(
        entries: [entry],
        invocations: [100: invocation],
        manifests: [manifest]
      )

      #expect(result == nil)
    }
  }

  @Test
  func wrapperRequiresTheDeclaredExecutable() {
    let result = Self.match(
      entries: [Self.process(100, name: "python3")],
      invocations: [
        100: Self.invocation(
          "/usr/bin/python3",
          arguments: ["node", "/pkg/@anthropic-ai/claude-code/cli.js"]
        )
      ]
    )

    #expect(result == nil)
  }

  @Test
  func wrapperRejectsJoinedArgumentSubstrings() {
    let scriptSuffix = "/@anthropic-ai/claude-code/cli.js"
    let invalidArguments = [
      ["node", "--eval=run('/pkg\(scriptSuffix)')"],
      ["node", "/pkg/@anthropic-ai/claude-code/cli", ".js"],
      ["node", "/pkg\(scriptSuffix).backup"],
      ["/pkg\(scriptSuffix)"],
    ]

    for arguments in invalidArguments {
      let result = Self.match(
        entries: [Self.process(100, name: "node")],
        invocations: [
          100: Self.invocation("/opt/homebrew/bin/node", arguments: arguments)
        ]
      )
      #expect(result == nil)
    }
  }

  @Test
  func exactExecutableOutranksARootWrapper() {
    let result = Self.match(
      entries: [
        Self.process(100, name: "node"),
        Self.process(200, parentProcessID: 100, name: "codex"),
      ],
      invocations: [
        100: Self.invocation(
          "/opt/homebrew/bin/node",
          arguments: ["node", "/pkg/@anthropic-ai/claude-code/cli.js"]
        ),
        200: Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"]),
      ]
    )

    #expect(result?.agentID == "codex")
    #expect(result?.processIdentity.processID == 200)
  }

  @Test
  func equalExactMatchesForDifferentAgentsAreUnknown() {
    let result = Self.match(
      entries: [
        Self.process(100, name: "codex"),
        Self.process(200, parentProcessID: 100, name: "claude"),
      ],
      invocations: [
        100: Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"]),
        200: Self.invocation("/opt/homebrew/bin/claude", arguments: ["claude"]),
      ]
    )

    #expect(result == nil)
  }

  @Test
  func equalWrapperMatchesForDifferentAgentsAreUnknown() {
    let manifests = [
      AgentDetectionProcessManifest(
        agentID: "first",
        processes: [
          AgentDetectionProcessRule(executable: "node", scriptSuffix: "/agent/cli.js")
        ]
      ),
      AgentDetectionProcessManifest(
        agentID: "second",
        processes: [
          AgentDetectionProcessRule(executable: "node", scriptSuffix: "/agent/cli.js")
        ]
      ),
    ]
    let result = Self.match(
      entries: [Self.process(100, name: "node")],
      invocations: [
        100: Self.invocation(
          "/opt/homebrew/bin/node",
          arguments: ["node", "/pkg/agent/cli.js"]
        )
      ],
      manifests: manifests
    )

    #expect(result == nil)
  }

  @Test
  func equalMatchesForOneAgentChooseTheRootMostProcess() {
    let result = Self.match(
      entries: [
        Self.process(300, name: "codex"),
        Self.process(100, parentProcessID: 300, name: "codex"),
      ],
      invocations: [
        100: Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"]),
        300: Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"]),
      ]
    )

    #expect(result?.processIdentity.processID == 300)
  }

  @Test
  func equalRootMatchesForOneAgentChooseTheLowestProcessID() {
    let result = Self.match(
      entries: [
        Self.process(300, name: "codex"),
        Self.process(100, name: "codex"),
      ],
      invocations: [
        100: Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"]),
        300: Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"]),
      ]
    )

    #expect(result?.processIdentity.processID == 100)
  }

  @Test
  func processNameCannotOverrideADifferentExecutablePath() {
    let result = Self.match(
      entries: [Self.process(100, name: "codex")],
      invocations: [
        100: Self.invocation("/tmp/not-codex", arguments: ["codex"])
      ]
    )

    #expect(result == nil)
  }

  @Test
  func executablePathCannotOverrideADifferentProcessName() {
    let result = Self.match(
      entries: [Self.process(100, name: "node")],
      invocations: [
        100: Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"])
      ]
    )

    #expect(result == nil)
  }

  @Test
  func wrapperRequiresMatchingProcessNameAndExecutablePath() {
    let result = Self.match(
      entries: [Self.process(100, name: "python3")],
      invocations: [
        100: Self.invocation(
          "/opt/homebrew/bin/node",
          arguments: ["node", "/pkg/@anthropic-ai/claude-code/cli.js"]
        )
      ]
    )

    #expect(result == nil)
  }

  @Test
  func missingInvocationHasNoMatch() {
    let result = Self.match(
      entries: [Self.process(100, name: "codex")],
      invocations: [:]
    )

    #expect(result == nil)
  }

}
