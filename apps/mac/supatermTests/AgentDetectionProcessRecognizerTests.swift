import Darwin
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
    processes: [AgentDetectionProcessRule(executable: "claude")]
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
  func sharedSamplerReusesOneProcessTableWithinTheCacheInterval() async {
    let clock = ContinuousClock()
    let currentTime = Mutex(clock.now)
    let snapshotCount = Mutex(0)
    let secondProcessGroupID = Self.foregroundProcessGroupID + 1
    let sampler = AgentDetectionProcessSampler(
      currentTime: { currentTime.withLock { $0 } },
      processTable: {
        snapshotCount.withLock { $0 += 1 }
        return ProcessTable(
          entries: [
            Self.process(100, name: "codex"),
            Self.process(200, processGroupID: secondProcessGroupID, name: "codex"),
          ]
        )
      },
      invocation: { processID in
        Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex", "\(processID)"])
      }
    )

    async let first = sampler.matches(
      foregroundProcessGroupIDs: [Self.foregroundProcessGroupID],
      manifests: [Self.codex]
    )
    async let second = sampler.matches(
      foregroundProcessGroupIDs: [secondProcessGroupID],
      manifests: [Self.codex]
    )
    let matches = await (first, second)

    #expect(matches.0[Self.foregroundProcessGroupID]?.processIdentity.processID == 100)
    #expect(matches.1[secondProcessGroupID]?.processIdentity.processID == 200)
    #expect(snapshotCount.withLock { $0 } == 1)

    currentTime.withLock { $0 = $0.advanced(by: .milliseconds(500)) }
    _ = await sampler.matches(
      foregroundProcessGroupIDs: [Self.foregroundProcessGroupID],
      manifests: [Self.codex]
    )

    #expect(snapshotCount.withLock { $0 } == 2)
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
  func matchesDeclaredProcessTitleAfterArgumentsAreRewritten() {
    let manifest = AgentDetectionProcessManifest(
      agentID: "agent",
      processes: [
        AgentDetectionProcessRule(executable: "node", processTitle: "pi")
      ]
    )
    let result = Self.match(
      entries: [Self.process(100, name: "pi")],
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
        Self.process(100, name: "node"),
        Self.invocation("/opt/homebrew/bin/node", arguments: ["other"])
      ),
      (
        Self.process(100, name: "python3"),
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
  func matchesAnAgentWrappedByANodeEntryPoint() {
    let manifest = AgentDetectionProcessManifest(
      agentID: "gemini",
      processes: [
        AgentDetectionProcessRule(
          executable: "node",
          argumentPathSuffix: "@google/gemini-cli/bundle/gemini.js"
        )
      ]
    )
    let result = Self.match(
      entries: [Self.process(100, name: "node")],
      invocations: [
        100: Self.invocation(
          "/opt/homebrew/bin/node",
          arguments: [
            "node",
            "/opt/homebrew/lib/node_modules/@google/gemini-cli/bundle/gemini.js",
          ]
        )
      ],
      manifests: [manifest]
    )

    #expect(result?.agentID == "gemini")
    #expect(result?.processIdentity.processID == 100)
  }

  @Test
  func matchesAnInterpretedAgentByItsLaunchCommand() {
    let manifest = AgentDetectionProcessManifest(
      agentID: "kimi",
      processes: [
        AgentDetectionProcessRule(executable: "python3", launchCommand: "kimi")
      ]
    )
    let result = Self.match(
      entries: [Self.process(100, name: "python3")],
      invocations: [
        100: Self.invocation(
          "/opt/homebrew/bin/python3",
          arguments: ["/opt/homebrew/bin/kimi", "--continue"]
        )
      ],
      manifests: [manifest]
    )

    #expect(result?.agentID == "kimi")
    #expect(result?.processIdentity.processID == 100)
  }

  @Test
  func wrappedAgentRequiresTheExactRuntimeAndEntryPointComponents() {
    let manifest = AgentDetectionProcessManifest(
      agentID: "gemini",
      processes: [
        AgentDetectionProcessRule(
          executable: "node",
          argumentPathSuffix: "@google/gemini-cli/bundle/gemini.js"
        )
      ]
    )
    let cases = [
      Self.invocation(
        "/opt/homebrew/bin/bun",
        arguments: ["bun", "/node_modules/@google/gemini-cli/bundle/gemini.js"]
      ),
      Self.invocation(
        "/opt/homebrew/bin/node",
        arguments: ["node", "/node_modules/@google/gemini-cli-copy/bundle/gemini.js"]
      ),
      Self.invocation(
        "/opt/homebrew/bin/node",
        arguments: [
          "node",
          "/tmp/server.js",
          "/node_modules/@google/gemini-cli/bundle/gemini.js",
        ]
      ),
    ]

    for invocation in cases {
      let result = Self.match(
        entries: [Self.process(100, name: "node")],
        invocations: [100: invocation],
        manifests: [manifest]
      )

      #expect(result == nil)
    }
  }

  @Test
  func codingAgentCatalogHasOneMarkAndProcessManifestPerAgent() {
    let expected = [
      "amp", "antigravity", "claude", "cline", "codex", "copilot", "cursor", "gemini",
      "goose", "grok", "hermes", "kimi", "opencode", "pi", "qwen",
    ]

    #expect(TerminalCodingAgentCatalog.all.map(\.id) == expected)
    #expect(TerminalCodingAgentCatalog.processManifests.map(\.agentID) == expected)
    #expect(Set(TerminalCodingAgentCatalog.all.map(\.markImageName)).count == expected.count)
    #expect(TerminalCodingAgentCatalog.all.allSatisfy { !$0.processes.isEmpty })
  }

  @Test
  func exactExecutableOutranksARootProcessTitle() {
    let manifests = [
      AgentDetectionProcessManifest(
        agentID: "pi",
        processes: [AgentDetectionProcessRule(executable: "node", processTitle: "pi")]
      ),
      Self.codex,
    ]
    let result = Self.match(
      entries: [
        Self.process(100, name: "node"),
        Self.process(200, parentProcessID: 100, name: "codex"),
      ],
      invocations: [
        100: Self.invocation(
          "/opt/homebrew/bin/node",
          arguments: ["pi"]
        ),
        200: Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"]),
      ],
      manifests: manifests
    )

    #expect(result?.agentID == "codex")
    #expect(result?.processIdentity.processID == 200)
  }

  @Test
  func nativeExecutableOutranksARewrittenProcessName() {
    let manifests = [
      AgentDetectionProcessManifest(
        agentID: "pi",
        processes: [
          AgentDetectionProcessRule(executable: "pi"),
          AgentDetectionProcessRule(executable: "node", processTitle: "pi"),
        ]
      ),
      Self.codex,
    ]
    let result = Self.match(
      entries: [
        Self.process(100, name: "pi"),
        Self.process(200, parentProcessID: 100, name: "codex"),
      ],
      invocations: [
        100: Self.invocation("/opt/homebrew/bin/node", arguments: ["pi"]),
        200: Self.invocation("/opt/homebrew/bin/codex", arguments: ["codex"]),
      ],
      manifests: manifests
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
  func equalProcessTitleMatchesForDifferentAgentsAreUnknown() {
    let manifests = [
      AgentDetectionProcessManifest(
        agentID: "first",
        processes: [
          AgentDetectionProcessRule(executable: "node", processTitle: "agent")
        ]
      ),
      AgentDetectionProcessManifest(
        agentID: "second",
        processes: [
          AgentDetectionProcessRule(executable: "node", processTitle: "agent")
        ]
      ),
    ]
    let result = Self.match(
      entries: [Self.process(100, name: "node")],
      invocations: [
        100: Self.invocation(
          "/opt/homebrew/bin/node",
          arguments: ["agent"]
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
  func argumentsCannotNameAnExecutableNeitherKernelFactNames() {
    let result = Self.match(
      entries: [Self.process(100, name: "fish")],
      invocations: [
        100: Self.invocation("/opt/homebrew/bin/fish", arguments: ["codex"])
      ]
    )

    #expect(result == nil)
  }

  @Test
  func matchesAnExecutableSymlinkedToAVersionedImage() {
    let result = Self.match(
      entries: [Self.process(100, name: "2.1.236")],
      invocations: [
        100: Self.invocation(
          "/Users/khoi/.local/bin/claude",
          arguments: ["claude", "--resume"]
        )
      ]
    )

    #expect(
      result
        == AgentDetectionProcessMatch(
          agentID: "claude",
          processIdentity: TerminalAgentProcessIdentity(
            processID: 100,
            startTimeMicroseconds: 100
          )
        )
    )
  }

  @Test
  func matchesAnImageTheLaunchPathDoesNotName() {
    let result = Self.match(
      entries: [Self.process(100, name: "codex")],
      invocations: [
        100: Self.invocation("/opt/homebrew/bin/codex-shim", arguments: ["codex"])
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
  func missingInvocationHasNoMatch() {
    let result = Self.match(
      entries: [Self.process(100, name: "codex")],
      invocations: [:]
    )

    #expect(result == nil)
  }

}
