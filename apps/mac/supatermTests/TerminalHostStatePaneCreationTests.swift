import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalHostStatePaneCreationTests {
  @Test
  func createPaneEqualizesSplitsWhenRequested() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let host = restoredHost(rootRatio: 0.2)
      let paneID = try #require(host.selectedSurfaceView?.id)

      _ = try host.createPane(
        .init(
          startupCommand: nil,
          direction: .right,
          focus: false,
          equalize: true,
          target: .contextPane(paneID)
        )
      )

      let rootSplit = try restoredRootSplit(host)
      let nestedSplit = try rightNestedSplit(rootSplit)

      #expect(abs(rootSplit.ratio - (1.0 / 3.0)) < 0.000_001)
      #expect(abs(nestedSplit.ratio - 0.5) < 0.000_001)
    }
  }

  @Test
  func createPanePreservesExistingRatiosWhenEqualizeIsDisabled() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let host = restoredHost(rootRatio: 0.2)
      let paneID = try #require(host.selectedSurfaceView?.id)

      _ = try host.createPane(
        .init(
          startupCommand: nil,
          direction: .right,
          focus: false,
          equalize: false,
          target: .contextPane(paneID)
        )
      )

      let rootSplit = try restoredRootSplit(host)
      let nestedSplit = try rightNestedSplit(rootSplit)

      #expect(abs(rootSplit.ratio - 0.2) < 0.000_001)
      #expect(abs(nestedSplit.ratio - 0.5) < 0.000_001)
    }
  }

  private func restoredHost(rootRatio: Double) -> TerminalHostState {
    let host = TerminalHostState()
    let spaceID = host.spaces[0].id
    let tabSession = TerminalTabSession(
      isPinned: false,
      lockedTitle: nil,
      focusedPaneIndex: 1,
      root: .split(
        .init(
          direction: .horizontal,
          ratio: rootRatio,
          left: .leaf(.init(workingDirectoryPath: "/tmp/left")),
          right: .leaf(.init(workingDirectoryPath: "/tmp/right"))
        )
      )
    )
    let spaceSession = TerminalWindowSpaceSession(
      id: spaceID,
      selectedTabIndex: 0,
      tabs: [tabSession]
    )
    let session = TerminalWindowSession(
      selectedSpaceID: spaceID,
      spaces: [spaceSession]
    )

    #expect(host.restore(from: session))
    return host
  }

  private func restoredRootSplit(_ host: TerminalHostState) throws -> TerminalPaneSplitSession {
    let snapshot = host.restorationSnapshot()
    let root = try #require(snapshot.spaces.first?.tabs.first?.root)
    guard case .split(let split) = root else {
      Issue.record("Expected split root")
      throw TestError()
    }
    return split
  }

  private func rightNestedSplit(_ split: TerminalPaneSplitSession) throws -> TerminalPaneSplitSession {
    guard case .split(let nestedSplit) = split.right else {
      Issue.record("Expected right nested split")
      throw TestError()
    }
    return nestedSplit
  }
}

private struct TestError: Error {}
