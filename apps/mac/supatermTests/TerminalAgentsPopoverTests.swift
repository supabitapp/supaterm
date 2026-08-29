import ComposableArchitecture
import CoreGraphics
import Darwin
import Foundation
import Sharing
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct TerminalAgentsPopoverTests {
  private struct ScopeFixture {
    let host: TerminalHostState
    let splitSurfaceIDs: [UUID]
    let secondTabSurfaceID: UUID
    let hiddenSurfaceID: UUID
  }

  @Test
  func preferredHeightUsesVisibleRows() {
    #expect(TerminalAgentsPopoverMetrics.preferredHeight(itemCount: 0) == 82)
    #expect(TerminalAgentsPopoverMetrics.preferredHeight(itemCount: 4) == 190)
    #expect(TerminalAgentsPopoverMetrics.preferredHeight(itemCount: 8) == 334)
  }

  @Test
  func preferredHeightCapsAtEightRows() {
    #expect(TerminalAgentsPopoverMetrics.visibleItemCount(9) == 8)
    #expect(
      TerminalAgentsPopoverMetrics.preferredHeight(itemCount: 9)
        == TerminalAgentsPopoverMetrics.preferredHeight(itemCount: 8)
    )
  }

  @Test
  @MainActor
  func aggregatesLiveAgentsFromEveryPane() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = try scopeFixture()

      expectDetection(
        in: fixture.host,
        surfaceID: fixture.splitSurfaceIDs[0],
        identity: AgentDetectionAgentIdentity(id: "codex", displayName: "Codex"),
        phase: .running,
        processID: 41
      )
      expectDetection(
        in: fixture.host,
        surfaceID: fixture.splitSurfaceIDs[1],
        identity: AgentDetectionAgentIdentity(id: "custom", displayName: "Custom"),
        phase: .needsInput,
        processID: 42
      )
      expectDetection(
        in: fixture.host,
        surfaceID: fixture.secondTabSurfaceID,
        identity: AgentDetectionAgentIdentity(id: "claude", displayName: "Claude Code"),
        phase: .idle,
        processID: 43
      )
      expectDetection(
        in: fixture.host,
        surfaceID: fixture.hiddenSurfaceID,
        identity: AgentDetectionAgentIdentity(id: "pi", displayName: "Pi"),
        phase: .unknown,
        processID: 44
      )

      let items = fixture.host.windowAgentPresentations()

      #expect(items.map(\.identity.displayName) == ["Codex", "Custom", "Claude Code", "Pi"])
      #expect(items.map(\.task) == ["Split", "Split", "Second", "Hidden"])
      #expect(items.map(\.workspace) == ["first-pane", "second-pane", "second-tab", "hidden-space"])
      #expect(items.map(\.status) == [.working, .needsInput, .idle, .unknown])
      #expect(Set(items.map(\.id)).count == items.count)
      #expect(
        Set(items.map(\.id.surfaceID))
          == Set(
            fixture.splitSurfaceIDs + [fixture.secondTabSurfaceID, fixture.hiddenSurfaceID]
          )
      )
    }
  }

  @Test
  @MainActor
  func identityOnlySessionIsUnknown() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let tabID = try #require(host.selectedTabID)
    let surfaceID = try #require(host.selectedSurfaceView?.id)
    let application = host.applyAgentEvent(
      TerminalAgentEvent(
        scope: TerminalAgentEvent.Scope(agent: .codex, sessionID: "identity-only"),
        context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue),
        processID: getpid(),
        workingDirectoryPath: "/tmp/identity-only",
        action: .sessionStarted
      )
    )

    let item = try #require(host.windowAgentPresentations().first)

    #expect(application.changed)
    #expect(item.identity == AgentDetectionAgentIdentity(.codex))
    #expect(item.workspace == "identity-only")
    #expect(item.status == .unknown)
  }

  @Test
  @MainActor
  func completionKeepsTaskAndWorkspaceUntilItIsViewed() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    let surfaceIDs = try restoreSplitHost(host, workingDirectoryPath: "/tmp/pane-workspace")
    let surfaceID = try #require(surfaceIDs.last)
    #expect(
      host.applyTestAgentActivity(
        .pi(.running, detail: "Finish the audit"),
        for: surfaceID,
        sessionID: "completed-session",
        processID: nil,
        workingDirectoryPath: "/tmp/completed-workspace"
      )
    )

    host.handleCommandFinished(for: surfaceID)

    let item = try #require(host.windowAgentPresentations().first)
    #expect(item.task == "Finish the audit")
    #expect(item.workspace == "completed-workspace")
    #expect(item.status == .done)
    #expect(
      item.id
        == TerminalHostState.WindowAgentPresentationID(
          surfaceID: surfaceID,
          completionIdentity: .native(agent: .pi, sessionID: "completed-session")
        )
    )

    let tabID = try #require(host.tabID(containing: surfaceID))
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.applyFocusedSurface(surfaceID, in: tabID)
    #expect(host.windowAgentPresentations().isEmpty)
  }

  @MainActor
  private func scopeFixture() throws -> ScopeFixture {
    initializeGhosttyForTests()

    let spaces = [TerminalSpaceItem(name: "Main"), TerminalSpaceItem(name: "Hidden")]
    @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
    $catalog.withLock {
      $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
    }
    let splitTabID = TerminalTabID()
    let secondTabID = TerminalTabID()
    let hiddenTabID = TerminalTabID()
    let splitSurfaceIDs = [UUID(), UUID()]
    let secondTabSurfaceID = UUID()
    let hiddenSurfaceID = UUID()
    let host = TerminalHostState.test(spaceID: spaces[0].id)
    #expect(
      host.restore(
        from: TerminalWindowSession(
          displayedSpaceID: spaces[0].id,
          spaces: [
            spaceSession(
              spaceID: spaces[0].id,
              selectedTabID: splitTabID,
              tabs: [
                splitTab(id: splitTabID, surfaceIDs: splitSurfaceIDs),
                leafTab(
                  id: secondTabID,
                  title: "Second",
                  surfaceID: secondTabSurfaceID,
                  workingDirectoryPath: "/tmp/second-tab"
                ),
              ]
            ),
            spaceSession(
              spaceID: spaces[1].id,
              selectedTabID: hiddenTabID,
              tabs: [
                leafTab(
                  id: hiddenTabID,
                  title: "Hidden",
                  surfaceID: hiddenSurfaceID,
                  workingDirectoryPath: "/tmp/hidden-space"
                )
              ]
            ),
          ]
        )
      )
    )
    #expect(host.displaySpace(spaces[1].id))
    #expect(host.displaySpace(spaces[0].id))
    setWorkingDirectory("/tmp/first-pane", for: splitSurfaceIDs[0], in: host)
    setWorkingDirectory("/tmp/second-pane", for: splitSurfaceIDs[1], in: host)
    setWorkingDirectory("/tmp/second-tab", for: secondTabSurfaceID, in: host)
    setWorkingDirectory("/tmp/hidden-space", for: hiddenSurfaceID, in: host)
    return ScopeFixture(
      host: host,
      splitSurfaceIDs: splitSurfaceIDs,
      secondTabSurfaceID: secondTabSurfaceID,
      hiddenSurfaceID: hiddenSurfaceID
    )
  }

  private func splitTab(
    id: TerminalTabID,
    surfaceIDs: [UUID]
  ) -> TerminalTabSession {
    TerminalTabSession(
      id: id,
      lockedTitle: "Split",
      focusedPaneIndex: 0,
      root: .split(
        TerminalPaneSplitSession(
          direction: .horizontal,
          ratio: 0.5,
          left: .leaf(
            TerminalPaneLeafSession(
              id: surfaceIDs[0],
              workingDirectoryPath: "/tmp/first-pane"
            )
          ),
          right: .leaf(
            TerminalPaneLeafSession(
              id: surfaceIDs[1],
              workingDirectoryPath: "/tmp/second-pane"
            )
          )
        )
      )
    )
  }

  private func leafTab(
    id: TerminalTabID,
    title: String,
    surfaceID: UUID,
    workingDirectoryPath: String
  ) -> TerminalTabSession {
    TerminalTabSession(
      id: id,
      lockedTitle: title,
      focusedPaneIndex: 0,
      root: .leaf(
        TerminalPaneLeafSession(
          id: surfaceID,
          workingDirectoryPath: workingDirectoryPath
        )
      )
    )
  }

  private func spaceSession(
    spaceID: TerminalSpaceID,
    selectedTabID: TerminalTabID,
    tabs: [TerminalTabSession]
  ) -> TerminalSpaceSession {
    TerminalSpaceSession(
      spaceID: spaceID,
      selectedTabID: selectedTabID,
      nodes: tabs.enumerated().map { index, tab in
        TerminalTabNodeSession(
          item: .tab(tab.id),
          parent: .root(isPinned: false),
          order: index
        )
      },
      groups: [],
      collapsedGroupIDs: [],
      tabs: tabs
    )
  }

  @MainActor
  private func setWorkingDirectory(
    _ path: String,
    for surfaceID: UUID,
    in host: TerminalHostState
  ) {
    host.surfaces[surfaceID]?.bridge.state.pwd = path
  }

  @MainActor
  private func expectDetection(
    in host: TerminalHostState,
    surfaceID: UUID,
    identity: AgentDetectionAgentIdentity,
    phase: AgentActivityPhase,
    processID: Int32
  ) {
    #expect(
      host.applyAgentDetection(
        TerminalAgentDetectionObservation(
          agent: identity,
          phase: phase,
          processIdentity: TerminalAgentProcessIdentity(
            processID: processID,
            startTimeMicroseconds: 1
          ),
          ruleID: "popover-test",
          generation: 1,
          sequence: 1
        ),
        for: surfaceID
      )
    )
  }
}
