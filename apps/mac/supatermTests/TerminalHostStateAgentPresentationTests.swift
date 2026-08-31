import AppKit
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct TerminalHostStateAgentPresentationTests {
  private struct BackgroundScreenFixture {
    let host: TerminalHostState
    let processIdentity: TerminalAgentProcessIdentity
    let surfaceID: UUID
    let tabID: TerminalTabID
  }

  @Test
  func agentActivityStoresNormalizedDetail() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    #expect(
      host.setTestAgentActivity(
        .pi(.running, detail: "  Bash · git status --short  "),
        for: surface.id
      )
    )

    #expect(
      host.agentActivity(for: tabID)
        == .pi(.running, detail: "Bash · git status --short")
    )
    #expect(host.showsAgentActivityDetail(for: tabID))
  }

  @Test
  func latestAgentResponseUsesNewestCompletion() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    #expect(
      host.startTestAgentSession(
        agent: .pi,
        for: surface.id,
        sessionID: "session-1",
        processID: nil
      )
    )

    #expect(host.setTestAgentResponse("First message", for: surface.id))
    #expect(host.setTestAgentResponse("Final answer", for: surface.id))

    #expect(host.tabAgentPresentation(for: tabID).latestResponse?.text == "Final answer")
  }

  @Test
  func agentActivityDetailFollowsFocusedPane() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )

    #expect(
      host.setTestAgentActivity(
        .pi(.running, detail: "Bash · git status --short"),
        for: firstSurface.id
      )
    )
    #expect(host.showsAgentActivityDetail(for: tabID))

    _ = try host.focusPane(TerminalPaneTarget(paneID: secondPane.paneID))
    #expect(!host.showsAgentActivityDetail(for: tabID))

    _ = try host.focusPane(TerminalPaneTarget(paneID: firstSurface.id))
    #expect(host.showsAgentActivityDetail(for: tabID))
  }

  @Test
  func tabStatusUsesHighestPriorityPaneWhileDetailStaysFocused() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )

    #expect(
      host.setTestAgentActivity(
        .pi(.running, detail: "Focused detail"),
        for: firstSurface.id
      )
    )
    #expect(host.setTestAgentActivity(.claude(.needsInput), for: secondPane.paneID))

    #expect(host.agentActivity(for: tabID) == .claude(.needsInput))
    #expect(host.showsAgentActivityDetail(for: tabID))
    #expect(host.tabAgentPresentation(for: tabID).status == .needsInput)
  }

  @Test
  func unseenDoneTakesPriorityOverWorkingUntilTheTabIsViewed() throws {
    let host = makeHost(windowActivity: .inactive)
    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )
    _ = host.createTab(inheritingFromSurfaceID: nil)

    #expect(host.setTestAgentActivity(.codex(.running), for: firstSurface.id))
    #expect(host.setTestAgentActivity(.pi(.idle), for: secondPane.paneID))
    _ = try host.notifyStructuredAgent(
      TerminalNotifyRequest(
        body: "Done.",
        target: .pane(secondPane.paneID),
        title: "Claude Code"
      ),
      semantic: .completion
    )

    #expect(host.tabAgentPresentation(for: tabID).status == .done)

    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.selectTab(tabID)

    #expect(host.unreadNotificationCount(for: tabID) == 0)
    #expect(host.tabAgentPresentation(for: tabID).status == .working)
    #expect(host.selectedSurfaceView?.id == firstSurface.id)
  }

  @Test(arguments: [AgentActivityPhase.running, .needsInput])
  func backgroundScreenCompletionShowsDoneOverTerminalNotificationUntilViewed(
    activePhase: AgentActivityPhase
  ) throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    let window = makeWindow(focusing: surface)
    defer { window.contentView = nil }
    let processIdentity = TerminalAgentProcessIdentity(
      processID: 42,
      startTimeMicroseconds: 1
    )
    _ = host.createTab(inheritingFromSurfaceID: nil)

    #expect(
      host.applyAgentDetection(
        agentDetectionObservation(
          phase: activePhase,
          processIdentity: processIdentity,
          ruleID: "screen_working",
          sequence: 1
        ),
        for: surface.id
      )
    )
    host.handleDesktopNotification(
      body: "Done.",
      surfaceID: surface.id,
      title: "Codex"
    )
    #expect(host.unreadNotificationCount(for: tabID) == 1)

    #expect(
      host.applyAgentDetection(
        agentDetectionObservation(
          phase: .idle,
          processIdentity: processIdentity,
          ruleID: "osc_title_idle",
          sequence: 2
        ),
        for: surface.id
      )
    )
    #expect(host.tabAgentPresentation(for: tabID).status == .done)
    #expect(host.unreadNotificationCount(for: tabID) == 1)

    host.selectTab(tabID)

    #expect(host.tabAgentPresentation(for: tabID).status == nil)
    #expect(host.unreadNotificationCount(for: tabID) == 0)
  }

  @Test
  func backgroundNativeCompletionShowsDoneWithoutNotification() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)

    #expect(host.setTestAgentActivity(.pi(.running), for: surface.id))
    _ = host.createTab(inheritingFromSurfaceID: nil)

    #expect(host.setTestAgentActivity(.pi(.idle), for: surface.id))
    #expect(host.tabAgentPresentation(for: tabID).status == .done)
    #expect(host.unreadNotificationCount(for: tabID) == 0)
  }

  @Test(arguments: [1, 2])
  func screenIdleWithoutActiveTransitionStaysUnread(idleCount: Int) throws {
    let fixture = try makeBackgroundScreenFixture()

    #expect(applyScreenPhases(Array(repeating: .idle, count: idleCount), to: fixture))
    fixture.host.handleDesktopNotification(
      body: "Build finished",
      surfaceID: fixture.surfaceID,
      title: "Build"
    )

    #expect(fixture.host.tabAgentPresentation(for: fixture.tabID).status == nil)
    #expect(fixture.host.unreadNotificationCount(for: fixture.tabID) == 1)
  }

  @Test
  func newScreenTurnClearsDone() throws {
    let fixture = try makeBackgroundScreenFixture()

    #expect(applyScreenPhases([.running, .idle], to: fixture))
    #expect(fixture.host.tabAgentPresentation(for: fixture.tabID).status == .done)

    #expect(applyScreenPhases([.running], to: fixture, startingSequence: 3))

    #expect(fixture.host.tabAgentPresentation(for: fixture.tabID).status == .working)
  }

  @Test
  func focusedScreenCompletionDoesNotShowDone() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    let window = makeWindow(focusing: surface)
    defer { window.contentView = nil }
    let processIdentity = TerminalAgentProcessIdentity(
      processID: 42,
      startTimeMicroseconds: 1
    )

    #expect(
      applyScreenPhases(
        [.running, .idle],
        to: host,
        surfaceID: surface.id,
        processIdentity: processIdentity
      )
    )

    #expect(host.tabAgentPresentation(for: tabID).status == nil)
  }

  @Test
  func screenProcessReplacementClearsDone() throws {
    let fixture = try makeBackgroundScreenFixture()

    #expect(applyScreenPhases([.running, .idle], to: fixture))
    #expect(fixture.host.tabAgentPresentation(for: fixture.tabID).status == .done)

    #expect(
      fixture.host.applyAgentDetection(
        agentDetectionObservation(
          phase: .idle,
          processIdentity: TerminalAgentProcessIdentity(
            processID: 42,
            startTimeMicroseconds: 2
          ),
          sequence: 3
        ),
        for: fixture.surfaceID
      )
    )

    #expect(fixture.host.tabAgentPresentation(for: fixture.tabID).status == nil)
  }

  @Test
  func latestAgentResponseFollowsFocusedPaneOnly() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )

    #expect(host.setTestAgentActivity(.pi(.idle), for: firstSurface.id))
    #expect(host.setTestAgentResponse("Focused response", for: firstSurface.id))
    #expect(host.setTestAgentActivity(.pi(.idle), for: secondPane.paneID))
    #expect(host.setTestAgentResponse("Background response", for: secondPane.paneID))
    #expect(host.tabAgentPresentation(for: tabID).latestResponse?.text == "Focused response")

    _ = try host.focusPane(TerminalPaneTarget(paneID: secondPane.paneID))

    #expect(host.tabAgentPresentation(for: tabID).latestResponse?.text == "Background response")
  }

  @Test
  func tabAgentPresentationShowsFocusedInputStatus() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    let window = makeWindow(focusing: surface)
    defer { window.contentView = nil }

    #expect(host.setTestAgentActivity(.codex(.needsInput), for: surface.id))
    #expect(host.tabAgentPresentation(for: tabID).status == .needsInput)
  }

  @Test
  func tabAgentPresentationShowsBackgroundInputStatus() throws {
    let host = makeHost()
    let firstTabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)

    #expect(host.setTestAgentActivity(.codex(.needsInput), for: firstSurface.id))

    _ = host.createTab(inheritingFromSurfaceID: nil)

    #expect(host.tabAgentPresentation(for: firstTabID).status == .needsInput)
  }

  @Test
  func closingStatusOwningPaneFallsBackToRemainingPaneActivity() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )

    #expect(
      host.setTestAgentActivity(
        .pi(.running, detail: "Focused detail"),
        for: firstSurface.id
      )
    )
    #expect(host.setTestAgentActivity(.claude(.needsInput), for: secondPane.paneID))
    #expect(host.agentActivity(for: tabID) == .claude(.needsInput))

    host.performCloseSurface(secondPane.paneID)

    #expect(host.agentActivity(for: tabID) == .pi(.running, detail: "Focused detail"))
    #expect(host.showsAgentActivityDetail(for: tabID))
  }

  @Test
  func commandFinishKeepsIdleExitStateAndClearsLatestResponse() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    #expect(host.setTestAgentActivity(.pi(.running, detail: "Thinking"), for: surface.id))
    #expect(host.setTestAgentResponse("Thinking", for: surface.id))

    surface.bridge.onCommandFinished?()

    #expect(host.agentActivity(for: tabID) == .pi(.idle))
    #expect(host.tabAgentPresentation(for: tabID).status == .done)
    #expect(host.tabAgentPresentation(for: tabID).latestResponse?.text == nil)
  }

  @Test
  func tabPanePresentationsKeepSplitOrderAndResolveIndicators() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )
    let thirdPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .down,
        focus: false,
        equalize: true,
        target: .pane(secondPane.paneID)
      )
    )
    let secondSurface = try #require(host.surfaces[secondPane.paneID])
    let thirdSurface = try #require(host.surfaces[thirdPane.paneID])
    firstSurface.bridge.state.title = "/repo - Codex 1"
    firstSurface.bridge.state.pwd = "/repo"
    secondSurface.bridge.state.title = "Review agent 1"
    thirdSurface.bridge.state.pwd = "/tmp/unused"
    #expect(host.setTestAgentActivity(.codex(.running), for: firstSurface.id))
    #expect(host.setTestAgentActivity(.claude(.needsInput), for: secondSurface.id))
    firstSurface.bridge.state.bellCount = 1
    thirdSurface.bridge.state.bellCount = 1
    host.notificationStore.append(
      TerminalHostState.PaneNotification(
        attentionState: .unread,
        body: "Review needs attention",
        createdAt: Date(),
        title: "Review"
      ),
      for: secondSurface.id
    )

    let panes = host.tabPanePresentations(for: tabID)

    #expect(panes.map(\.id) == [firstSurface.id, secondSurface.id, thirdSurface.id])
    #expect(panes.map(\.title) == ["Codex 1", "Review agent 1", "Pane 3"])
    #expect(panes.map(\.indicator) == [.agent(.working), .agent(.needsInput), .attention])
    #expect(panes.map(\.isFocused) == [true, false, false])

    _ = try host.focusPane(TerminalPaneTarget(paneID: secondSurface.id))

    #expect(
      host.tabPanePresentations(for: tabID).map(\.isFocused)
        == [false, true, false]
    )
  }

  @Test
  func tabAgentWorkspacesPutFocusedFirstAndDedupeRepoBranches() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )
    let thirdPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .down,
        focus: false,
        equalize: true,
        target: .pane(secondPane.paneID)
      )
    )
    let fourthPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(thirdPane.paneID)
      )
    )
    let secondSurface = try #require(host.surfaces[secondPane.paneID])
    let thirdSurface = try #require(host.surfaces[thirdPane.paneID])
    let fourthSurface = try #require(host.surfaces[fourthPane.paneID])
    firstSurface.bridge.state.pwd = "/repo/apps/mac"
    secondSurface.bridge.state.pwd = "/other-repo"
    thirdSurface.bridge.state.pwd = "/repo/docs"
    fourthSurface.bridge.state.pwd = "/repo/other"

    #expect(host.setTestAgentActivity(.codex(.running), for: firstSurface.id))
    #expect(host.setTestAgentActivity(.claude(.needsInput), for: secondSurface.id))
    #expect(host.setTestAgentActivity(.codex(.running), for: thirdSurface.id))
    #expect(host.setTestAgentActivity(.claude(.needsInput), for: fourthSurface.id))
    host.storePaneAgentMetadata(
      TerminalHostState.PaneAgentMetadata(
        branchDetails: branchDetails(repositoryRootPath: "/repo", branchName: "feature/a")
      ),
      for: firstSurface.id
    )
    host.storePaneAgentMetadata(
      TerminalHostState.PaneAgentMetadata(
        branchDetails: branchDetails(repositoryRootPath: "/other-repo", branchName: "feature/a")
      ),
      for: secondSurface.id
    )
    host.storePaneAgentMetadata(
      TerminalHostState.PaneAgentMetadata(
        branchDetails: branchDetails(repositoryRootPath: "/repo", branchName: "feature/a")
      ),
      for: thirdSurface.id
    )
    host.storePaneAgentMetadata(
      TerminalHostState.PaneAgentMetadata(
        branchDetails: branchDetails(repositoryRootPath: "/repo", branchName: "feature/b")
      ),
      for: fourthSurface.id
    )
    _ = try host.focusPane(TerminalPaneTarget(paneID: thirdSurface.id))

    let context = host.tabAgentContext(for: tabID)
    let workspaces = context.workspaces

    #expect(context.presentation.status == .needsInput)
    #expect(
      workspaces.map(\.id) == [
        .git(repositoryRootPath: "/repo", branchName: "feature/a"),
        .git(repositoryRootPath: "/other-repo", branchName: "feature/a"),
        .git(repositoryRootPath: "/repo", branchName: "feature/b"),
      ]
    )
    #expect(
      workspaces.map(\.workingDirectoryPath)
        == ["/repo/docs/", "/other-repo/", "/repo/other/"]
    )
  }

  private func makeHost(
    windowActivity: WindowActivityState = WindowActivityState(
      isKeyWindow: true,
      isVisible: true
    )
  ) -> TerminalHostState {
    initializeGhosttyForTests()
    let host = TerminalHostState.test()
    host.windowActivity = windowActivity
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    return host
  }

  private func makeBackgroundScreenFixture() throws -> BackgroundScreenFixture {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let surfaceID = try #require(host.selectedSurfaceView?.id)
    _ = host.createTab(inheritingFromSurfaceID: nil)
    return BackgroundScreenFixture(
      host: host,
      processIdentity: TerminalAgentProcessIdentity(
        processID: 42,
        startTimeMicroseconds: 1
      ),
      surfaceID: surfaceID,
      tabID: tabID
    )
  }

  private func applyScreenPhases(
    _ phases: [AgentActivityPhase],
    to fixture: BackgroundScreenFixture,
    startingSequence: UInt64 = 1
  ) -> Bool {
    applyScreenPhases(
      phases,
      to: fixture.host,
      surfaceID: fixture.surfaceID,
      processIdentity: fixture.processIdentity,
      startingSequence: startingSequence
    )
  }

  private func applyScreenPhases(
    _ phases: [AgentActivityPhase],
    to host: TerminalHostState,
    surfaceID: UUID,
    processIdentity: TerminalAgentProcessIdentity,
    startingSequence: UInt64 = 1
  ) -> Bool {
    phases.enumerated().allSatisfy { offset, phase in
      host.applyAgentDetection(
        agentDetectionObservation(
          phase: phase,
          processIdentity: processIdentity,
          sequence: startingSequence + UInt64(offset)
        ),
        for: surfaceID
      )
    }
  }

  private func branchDetails(
    repositoryRootPath: String,
    branchName: String
  ) -> PaneAgentBranchDetails {
    PaneAgentBranchDetails(
      repositoryRootPath: repositoryRootPath,
      branchName: branchName,
      addedLineCount: 0,
      removedLineCount: 0,
      pullRequestStatus: .unavailable
    )
  }
}
