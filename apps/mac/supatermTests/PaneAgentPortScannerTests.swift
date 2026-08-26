import ComposableArchitecture
import Darwin
import Foundation
import Sharing
import Testing

@testable import SupatermSupport
@testable import supaterm

struct PaneAgentPortScannerTests {
  @Test
  func lsofParserExtractsListeningPorts() {
    let ports = PaneAgentPortScanner.ports(
      fromLsofOutput: """
        p10
        n*:5173
        n127.0.0.1:5175
        p12
        n[::1]:8080
        """
    )

    #expect(ports == [10: [5173, 5175], 12: [8080]])
  }

  @Test
  @MainActor
  func portScannerBatchesSurfacesIntoSingleScan() async throws {
    let firstSurfaceID = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000001"))
    let secondSurfaceID = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000002"))
    let recorder = AgentPanelCommandRecorder(
      lsofOutput: """
        p11
        n*:5173
        p21
        n127.0.0.1:8080
        """
    )
    let scanner = await paneAgentPortScanner(
      recorder: recorder,
      processEntries: [
        processEntry(10, parentProcessID: 1, processGroupID: 10),
        processEntry(11, parentProcessID: 10, processGroupID: 10),
        processEntry(20, parentProcessID: 1, processGroupID: 20),
        processEntry(21, parentProcessID: 20, processGroupID: 20),
      ]
    )
    var deliveries: [(UUID, [String])] = []
    let deliver: PaneAgentPortScanner.Delivery = { surfaceID, artifacts in
      deliveries.append((surfaceID, artifacts.map(\.title)))
    }

    scanner.update(
      surfaceID: firstSurfaceID,
      context: portScanContext(nativeProcessIdentities: [processIdentity(10)]),
      deliver: deliver
    )
    scanner.update(
      surfaceID: secondSurfaceID,
      context: portScanContext(nativeProcessIdentities: [processIdentity(20)]),
      deliver: deliver
    )

    #expect(await scanner.scanOnce())
    #expect(await recorder.commandPaths() == ["/usr/sbin/lsof"])
    #expect(await recorder.arguments(for: "/usr/sbin/lsof").first?.contains("10,11,20,21") == true)
    #expect(deliveries.count == 2)
    #expect(deliveries[0].0 == firstSurfaceID)
    #expect(deliveries[0].1 == ["localhost:5173"])
    #expect(deliveries[1].0 == secondSurfaceID)
    #expect(deliveries[1].1 == ["localhost:8080"])
  }

  @Test
  @MainActor
  func portScannerDeliversOnlyChangedArtifacts() async throws {
    let surfaceID = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000010"))
    let recorder = AgentPanelCommandRecorder(
      lsofOutput: """
        p11
        n*:5173
        """
    )
    let scanner = await paneAgentPortScanner(
      recorder: recorder,
      processEntries: [
        processEntry(10, parentProcessID: 1, processGroupID: 10),
        processEntry(11, parentProcessID: 10, processGroupID: 10),
      ]
    )
    var deliveries: [[String]] = []
    let deliver: PaneAgentPortScanner.Delivery = { _, artifacts in
      deliveries.append(artifacts.map(\.title))
    }

    scanner.update(
      surfaceID: surfaceID,
      context: portScanContext(nativeProcessIdentities: [processIdentity(10)]),
      deliver: deliver
    )

    #expect(await scanner.scanOnce())
    #expect(await scanner.scanOnce() == false)

    scanner.update(
      surfaceID: surfaceID,
      context: portScanContext(nativeProcessIdentities: [processIdentity(10)]),
      deliver: deliver
    )

    #expect(await scanner.scanOnce() == false)

    scanner.clear(surfaceID: surfaceID, deliver: deliver)
    scanner.clear(surfaceID: surfaceID, deliver: deliver)

    #expect(deliveries == [["localhost:5173"], []])
  }

  @Test
  @MainActor
  func portScannerRemovesClearedSurfaceFromBatch() async throws {
    let firstSurfaceID = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000001"))
    let secondSurfaceID = try #require(UUID(uuidString: "00000000-0000-0000-0000-000000000002"))
    let recorder = AgentPanelCommandRecorder(
      lsofOutput: """
        p11
        n*:5173
        p21
        n127.0.0.1:8080
        """
    )
    let scanner = await paneAgentPortScanner(
      recorder: recorder,
      processEntries: [
        processEntry(10, parentProcessID: 1, processGroupID: 10),
        processEntry(11, parentProcessID: 10, processGroupID: 10),
        processEntry(20, parentProcessID: 1, processGroupID: 20),
        processEntry(21, parentProcessID: 20, processGroupID: 20),
      ]
    )
    var deliveries: [(UUID, [String])] = []
    let deliver: PaneAgentPortScanner.Delivery = { surfaceID, artifacts in
      deliveries.append((surfaceID, artifacts.map(\.title)))
    }

    scanner.update(
      surfaceID: firstSurfaceID,
      context: portScanContext(nativeProcessIdentities: [processIdentity(10)]),
      deliver: deliver
    )
    scanner.update(
      surfaceID: secondSurfaceID,
      context: portScanContext(nativeProcessIdentities: [processIdentity(20)]),
      deliver: deliver
    )
    await scanner.scanOnce()
    scanner.clear(surfaceID: firstSurfaceID, deliver: deliver)
    await recorder.reset()

    #expect(await scanner.scanOnce() == false)
    #expect(await recorder.arguments(for: "/usr/sbin/lsof").first?.contains("20,21") == true)

    scanner.clear(surfaceID: secondSurfaceID, deliver: deliver)
    await recorder.reset()

    #expect(await scanner.scanOnce() == false)
    #expect(await recorder.commandPaths().isEmpty)
    #expect(deliveries.contains { $0.0 == firstSurfaceID && $0.1.isEmpty })
  }

  @Test
  @MainActor
  func portScannerIncludesForegroundGroupAfterLeaderExits() async throws {
    let surfaceID = UUID()
    let recorder = AgentPanelCommandRecorder(
      lsofOutput: """
        p102
        n*:5173
        p103
        n127.0.0.1:8080
        """
    )
    let scanner = await paneAgentPortScanner(
      recorder: recorder,
      processEntries: [
        processEntry(101, parentProcessID: 1, processGroupID: 100),
        processEntry(102, parentProcessID: 1, processGroupID: 100),
        processEntry(103, parentProcessID: 102, processGroupID: 100),
        processEntry(200, parentProcessID: 1, processGroupID: 200),
      ]
    )
    var deliveredArtifacts: [PaneAgentArtifact] = []

    scanner.update(
      surfaceID: surfaceID,
      context: portScanContext(nativeProcessIdentities: [processIdentity(101)]),
      foregroundProcessGroupID: { 100 },
      deliver: { _, artifacts in
        deliveredArtifacts = artifacts
      }
    )

    #expect(await scanner.scanOnce())
    #expect(
      await recorder.arguments(for: "/usr/sbin/lsof").first?.contains("101,102,103") == true
    )
    #expect(deliveredArtifacts.map(\.title) == ["localhost:5173", "localhost:8080"])
  }

  @Test
  @MainActor
  func portScannerReadsFreshForegroundGroupEveryScan() async throws {
    let surfaceID = UUID()
    let recorder = AgentPanelCommandRecorder(
      lsofOutput: """
        p101
        n*:5173
        p201
        n*:8080
        """
    )
    let scanner = await paneAgentPortScanner(
      recorder: recorder,
      processEntries: [
        processEntry(10, parentProcessID: 1, processGroupID: 10),
        processEntry(101, parentProcessID: 1, processGroupID: 100),
        processEntry(201, parentProcessID: 1, processGroupID: 200),
      ]
    )
    let foregroundProcessGroupID = LockIsolated<Int32?>(100)
    var deliveredArtifacts: [PaneAgentArtifact] = []

    scanner.update(
      surfaceID: surfaceID,
      context: portScanContext(nativeProcessIdentities: [processIdentity(10)]),
      foregroundProcessGroupID: { foregroundProcessGroupID.value },
      deliver: { _, artifacts in
        deliveredArtifacts = artifacts
      }
    )

    #expect(await scanner.scanOnce())
    #expect(deliveredArtifacts.map(\.title) == ["localhost:5173"])

    foregroundProcessGroupID.withValue { $0 = 200 }
    await recorder.reset()

    #expect(await scanner.scanOnce())
    #expect(await recorder.arguments(for: "/usr/sbin/lsof").first?.contains("10,201") == true)
    #expect(await recorder.arguments(for: "/usr/sbin/lsof").first?.contains("10,101") == false)
    #expect(deliveredArtifacts.map(\.title) == ["localhost:8080"])
  }

  @Test
  @MainActor
  func fallbackPortRootUsesExactCurrentIdentityWithoutForegroundGroup() async {
    let surfaceID = UUID()
    let identity = processIdentity(10)
    let recorder = AgentPanelCommandRecorder(
      lsofOutput: """
        p11
        n*:5173
        p12
        n*:8080
        """
    )
    let scanner = await paneAgentPortScanner(
      recorder: recorder,
      processEntries: [
        processEntry(10, parentProcessID: 1, processGroupID: 100),
        processEntry(11, parentProcessID: 10, processGroupID: 100),
        processEntry(12, parentProcessID: 1, processGroupID: 100),
      ]
    )
    var deliveredArtifacts: [PaneAgentArtifact] = []

    scanner.update(
      surfaceID: surfaceID,
      context: portScanContext(fallbackProcessIdentity: identity),
      foregroundProcessGroupID: { 100 },
      deliver: { _, artifacts in
        deliveredArtifacts = artifacts
      }
    )

    #expect(await scanner.scanOnce())
    #expect(await recorder.arguments(for: "/usr/sbin/lsof").first?.contains("10,11") == true)
    #expect(await recorder.arguments(for: "/usr/sbin/lsof").first?.contains("12") == false)
    #expect(deliveredArtifacts.map(\.title) == ["localhost:5173"])
  }

  @Test
  @MainActor
  func reusedFallbackPIDWithNewStartDoesNotBecomeAPortRoot() async {
    let surfaceID = UUID()
    let stale = processIdentity(10)
    let recorder = AgentPanelCommandRecorder(lsofOutput: "p10\nn*:5173")
    let scanner = await paneAgentPortScanner(
      recorder: recorder,
      processEntries: [
        processEntry(
          10,
          startTimeMicroseconds: 2,
          parentProcessID: 1,
          processGroupID: 100
        )
      ]
    )
    var deliveries: [[PaneAgentArtifact]] = []

    scanner.update(
      surfaceID: surfaceID,
      context: portScanContext(fallbackProcessIdentity: stale),
      foregroundProcessGroupID: { 100 },
      deliver: { _, artifacts in
        deliveries.append(artifacts)
      }
    )

    #expect(await scanner.scanOnce() == false)
    #expect(await recorder.commandPaths().isEmpty)
    #expect(deliveries.isEmpty)
  }

  @Test
  @MainActor
  func reusedNativePIDDoesNotAuthorizeForegroundProcessGroup() async {
    let surfaceID = UUID()
    let stale = processIdentity(10)
    let recorder = AgentPanelCommandRecorder(lsofOutput: "p11\nn*:5173")
    let scanner = await paneAgentPortScanner(
      recorder: recorder,
      processEntries: [
        processEntry(
          10,
          startTimeMicroseconds: 2,
          parentProcessID: 1,
          processGroupID: 100
        ),
        processEntry(11, parentProcessID: 1, processGroupID: 100),
      ]
    )
    var deliveries: [[PaneAgentArtifact]] = []

    scanner.update(
      surfaceID: surfaceID,
      context: portScanContext(nativeProcessIdentities: [stale]),
      foregroundProcessGroupID: { 100 },
      deliver: { _, artifacts in
        deliveries.append(artifacts)
      }
    )

    #expect(await scanner.scanOnce() == false)
    #expect(await recorder.commandPaths().isEmpty)
    #expect(deliveries.isEmpty)
  }

  @Test
  @MainActor
  func fallbackIdentityDyingDuringPortScanClearsPriorResults() async {
    let surfaceID = UUID()
    let identity = processIdentity(10)
    let processTree = processTreeSnapshot([
      processEntry(10, parentProcessID: 1, processGroupID: 100),
      processEntry(11, parentProcessID: 10, processGroupID: 100),
    ])
    let isCurrent = LockIsolated(true)
    let diesDuringScan = LockIsolated(false)
    let runner = TerminalAgentPanelCommandRunner(
      run: { executableURL, _, _ in
        switch executableURL.path {
        case "/usr/sbin/lsof":
          if diesDuringScan.value {
            isCurrent.withValue { $0 = false }
          }
          return TerminalAgentPanelCommandResult(status: 0, stdout: "p11\nn*:5173")
        default:
          return TerminalAgentPanelCommandResult(status: 1, stdout: "")
        }
      },
      runLoginCommand: { _, _ in
        TerminalAgentPanelCommandResult(status: 1, stdout: "")
      }
    )
    let scanner = PaneAgentPortScanner(
      runner: runner,
      captureProcessTree: { processTree },
      isProcessCurrent: { candidate in
        candidate != identity || isCurrent.value
      }
    )
    var deliveries: [[String]] = []
    scanner.update(
      surfaceID: surfaceID,
      context: portScanContext(fallbackProcessIdentity: identity),
      deliver: { _, artifacts in
        deliveries.append(artifacts.map(\.title))
      }
    )

    #expect(await scanner.scanOnce())
    #expect(deliveries == [["localhost:5173"]])

    diesDuringScan.withValue { $0 = true }

    #expect(await scanner.scanOnce())
    #expect(deliveries == [["localhost:5173"], []])
  }

  @Test
  @MainActor
  func descendantReusedDuringPortScanIsFilteredWhileCurrentSiblingRemains() async {
    let surfaceID = UUID()
    let root = processIdentity(10)
    let reusedDescendant = processIdentity(11)
    let replacement = processIdentity(11, startTimeMicroseconds: 2)
    let currentSibling = processIdentity(12)
    let processTree = processTreeSnapshot([
      processEntry(10, parentProcessID: 1, processGroupID: 100),
      processEntry(11, parentProcessID: 10, processGroupID: 100),
      processEntry(12, parentProcessID: 10, processGroupID: 100),
    ])
    let currentProcessIdentities = LockIsolated<Set<TerminalAgentProcessIdentity>>([
      root,
      reusedDescendant,
      currentSibling,
    ])
    let runner = TerminalAgentPanelCommandRunner(
      run: { executableURL, _, _ in
        guard executableURL.path == "/usr/sbin/lsof" else {
          return TerminalAgentPanelCommandResult(status: 1, stdout: "")
        }
        currentProcessIdentities.withValue {
          $0.remove(reusedDescendant)
          $0.insert(replacement)
        }
        return TerminalAgentPanelCommandResult(
          status: 0,
          stdout: "p11\nn*:5173\np12\nn*:8080"
        )
      },
      runLoginCommand: { _, _ in
        TerminalAgentPanelCommandResult(status: 1, stdout: "")
      }
    )
    let scanner = PaneAgentPortScanner(
      runner: runner,
      captureProcessTree: { processTree },
      isProcessCurrent: { currentProcessIdentities.value.contains($0) }
    )
    var deliveredArtifacts: [PaneAgentArtifact] = []

    scanner.update(
      surfaceID: surfaceID,
      context: portScanContext(nativeProcessIdentities: [root]),
      deliver: { _, artifacts in
        deliveredArtifacts = artifacts
      }
    )

    #expect(await scanner.scanOnce())
    #expect(deliveredArtifacts.map(\.title) == ["localhost:8080"])
  }

  @Test
  @MainActor
  func nativePortRootsKeepForegroundGroupWhenFallbackIdentityIsStale() async {
    let surfaceID = UUID()
    let staleFallback = processIdentity(20)
    let recorder = AgentPanelCommandRecorder(
      lsofOutput: """
        p11
        n*:5173
        p12
        n*:8080
        p20
        n*:9000
        """
    )
    let scanner = await paneAgentPortScanner(
      recorder: recorder,
      processEntries: [
        processEntry(10, parentProcessID: 1, processGroupID: 100),
        processEntry(11, parentProcessID: 10, processGroupID: 100),
        processEntry(12, parentProcessID: 1, processGroupID: 100),
        processEntry(
          20,
          startTimeMicroseconds: 2,
          parentProcessID: 1,
          processGroupID: 200
        ),
      ]
    )
    var deliveredArtifacts: [PaneAgentArtifact] = []

    scanner.update(
      surfaceID: surfaceID,
      context: portScanContext(
        nativeProcessIdentities: [processIdentity(10)],
        fallbackProcessIdentity: staleFallback
      ),
      foregroundProcessGroupID: { 100 },
      deliver: { _, artifacts in
        deliveredArtifacts = artifacts
      }
    )

    #expect(await scanner.scanOnce())
    #expect(await recorder.arguments(for: "/usr/sbin/lsof").first?.contains("10,11,12") == true)
    #expect(await recorder.arguments(for: "/usr/sbin/lsof").first?.contains("20") == false)
    #expect(deliveredArtifacts.map(\.title) == ["localhost:5173", "localhost:8080"])
  }

  @Test
  @MainActor
  func commandFinishReregistersPortTracking() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.supatermSettings) var supatermSettings = .default
      $supatermSettings.withLock {
        $0.codingAgentsShowPanel = true
      }

      initializeGhosttyForTests()

      let host = TerminalHostState.test()
      let surfaceID = try #require(
        restoreSplitHost(
          host,
          workingDirectoryPath: FileManager.default.temporaryDirectory.path(percentEncoded: false)
        ).first
      )
      let processID = getpid()
      #expect(
        host.startTestAgentSession(
          agent: .codex,
          for: surfaceID,
          sessionID: "session-1",
          processID: processID
        )
      )
      let identity = try #require(TerminalAgentProcessInspector.identity(for: processID))
      let recorder = AgentPanelCommandRecorder(lsofOutput: "")
      let scanner = await paneAgentPortScanner(
        recorder: recorder,
        processEntries: [
          processEntry(
            processID,
            startTimeMicroseconds: identity.startTimeMicroseconds,
            parentProcessID: 1,
            processGroupID: processID
          )
        ],
        interval: .seconds(60)
      )
      let controller = TerminalAgentPanelController(
        terminal: host,
        portScanner: scanner
      )
      host.agentPanelController = controller
      defer { controller.stop() }

      controller.surfaceFocused(surfaceID)
      _ = await scanner.scanOnce()
      await recorder.reset()

      controller.surfaceCommandFinished(surfaceID)
      _ = await scanner.scanOnce()

      #expect(await recorder.commandPaths() == ["/usr/sbin/lsof"])
    }
  }
}

nonisolated private func processIdentity(
  _ processID: Int32,
  startTimeMicroseconds: UInt64 = 1
) -> TerminalAgentProcessIdentity {
  TerminalAgentProcessIdentity(
    processID: processID,
    startTimeMicroseconds: startTimeMicroseconds
  )
}

nonisolated private func processEntry(
  _ processID: Int32,
  startTimeMicroseconds: UInt64 = 1,
  parentProcessID: Int32,
  processGroupID: Int32
) -> ProcessEntry {
  ProcessEntry(
    identity: processIdentity(
      processID,
      startTimeMicroseconds: startTimeMicroseconds
    ),
    parentProcessID: parentProcessID,
    processGroupID: processGroupID,
    name: ""
  )
}

nonisolated private func processTreeSnapshot(
  _ entries: [ProcessEntry]
) -> TerminalAgentProcessTreeSnapshot {
  TerminalAgentProcessTreeSnapshot(entries: entries)
}

@MainActor
private func paneAgentPortScanner(
  recorder: AgentPanelCommandRecorder,
  processEntries: [ProcessEntry],
  interval: Duration = .seconds(10),
  isProcessCurrent: @escaping @Sendable (TerminalAgentProcessIdentity) -> Bool = { _ in true }
) async -> PaneAgentPortScanner {
  let processTree = processTreeSnapshot(processEntries)
  return PaneAgentPortScanner(
    runner: await recorder.runner(),
    interval: interval,
    captureProcessTree: { processTree },
    isProcessCurrent: isProcessCurrent
  )
}

nonisolated private func portScanContext(
  nativeProcessIdentities: Set<TerminalAgentProcessIdentity> = [],
  fallbackProcessIdentity: TerminalAgentProcessIdentity? = nil
) -> TerminalPanePortScanContext {
  TerminalPanePortScanContext(
    nativeProcessIdentities: nativeProcessIdentities,
    fallbackProcessIdentity: fallbackProcessIdentity
  )
}

private actor AgentPanelCommandRecorder {
  private let lsofOutput: String
  private var commands: [(path: String, arguments: [String])] = []

  init(lsofOutput: String) {
    self.lsofOutput = lsofOutput
  }

  func runner() -> TerminalAgentPanelCommandRunner {
    TerminalAgentPanelCommandRunner(
      run: { executableURL, arguments, _ in
        await self.run(executableURL: executableURL, arguments: arguments)
      },
      runLoginCommand: { _, _ in
        TerminalAgentPanelCommandResult(status: 1, stdout: "")
      }
    )
  }

  func reset() {
    commands = []
  }

  func commandPaths() -> [String] {
    commands.map(\.path)
  }

  func arguments(for path: String) -> [[String]] {
    commands.compactMap { command in
      command.path == path ? command.arguments : nil
    }
  }

  private func run(
    executableURL: URL,
    arguments: [String]
  ) -> TerminalAgentPanelCommandResult {
    let path = executableURL.path
    commands.append((path, arguments))
    switch path {
    case "/usr/sbin/lsof":
      return TerminalAgentPanelCommandResult(status: 0, stdout: lsofOutput)
    default:
      return TerminalAgentPanelCommandResult(status: 1, stdout: "")
    }
  }
}
