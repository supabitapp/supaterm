import AppKit
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct TerminalHostStateAgentPresentationTests {
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
    host.handleCommand(.createTab(inheritingFromSurfaceID: nil))

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
  func tabAgentPresentationHidesFocusedInputStatus() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    let window = makeWindow(focusing: surface)
    defer { window.contentView = nil }

    #expect(host.setTestAgentActivity(.codex(.needsInput), for: surface.id))
    #expect(host.tabAgentPresentation(for: tabID).status == nil)
  }

  @Test
  func tabAgentPresentationShowsBackgroundInputStatus() throws {
    let host = makeHost()
    let firstTabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)

    #expect(host.setTestAgentActivity(.codex(.needsInput), for: firstSurface.id))

    host.handleCommand(.createTab(inheritingFromSurfaceID: nil))

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
  func commandFinishedClearsAgentActivityAndLatestResponse() throws {
    let host = makeHost()
    let tabID = try #require(host.selectedTabID)
    let surface = try #require(host.selectedSurfaceView)
    #expect(host.setTestAgentActivity(.pi(.running, detail: "Thinking"), for: surface.id))
    #expect(host.setTestAgentResponse("Thinking", for: surface.id))

    surface.bridge.onCommandFinished?()

    #expect(host.agentActivity(for: tabID) == nil)
    #expect(host.tabAgentPresentation(for: tabID).latestResponse?.text == nil)
  }

  private func makeHost(
    windowActivity: WindowActivityState = WindowActivityState(
      isKeyWindow: true,
      isVisible: true
    )
  ) -> TerminalHostState {
    initializeGhosttyForTests()
    let host = TerminalHostState()
    host.windowActivity = windowActivity
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    return host
  }
}
