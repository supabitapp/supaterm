import AppKit
import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSocketFeature
@testable import SupatermTerminalCore
@testable import supaterm

@MainActor
struct TerminalCommandExecutorAgentExplainTests {
  @Test
  func agentExplainSkipsMissingWindowsAndRewritesTheResolvedWindowIndex() throws {
    initializeGhosttyForTests()
    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let firstHost = TerminalHostState()
    let secondHost = TerminalHostState()
    firstHost.ensureInitialTab(focusing: false, startupCommand: nil)
    secondHost.ensureInitialTab(focusing: false, startupCommand: nil)
    let secondSurfaceID = try #require(secondHost.selectedSurfaceView?.id)
    let firstWindow = registerAgentExplainWindow(host: firstHost, registry: registry)
    let secondWindow = registerAgentExplainWindow(host: secondHost, registry: registry)

    let result = try commandExecutor.agentDetectionExplain(
      TerminalPaneTarget(paneID: secondSurfaceID)
    )

    #expect(result.target.windowIndex == 2)
    #expect(result.target.paneID == secondSurfaceID)
    #expect(result.mode == .none)
    #expect(result.status == .detectionDisabled)
    withExtendedLifetime([firstWindow, secondWindow]) {}
  }

  @Test
  func terminalPaneExecutorReturnsTheTypedAgentExplainResult() throws {
    initializeGhosttyForTests()
    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let surfaceID = try #require(host.selectedSurfaceView?.id)
    let window = registerAgentExplainWindow(host: host, registry: registry)

    let execution = try commandExecutor.execute(
      SocketRequestExecutor.TerminalPaneRequest.agentExplain(
        TerminalPaneTarget(paneID: surfaceID)
      )
    )

    guard case .agentExplain(let result) = execution else {
      Issue.record("Expected an agent explain result.")
      return
    }
    #expect(result.target.paneID == surfaceID)
    #expect(result.mode == .none)
    #expect(result.status == .detectionDisabled)
    withExtendedLifetime(window) {}
  }

  private func registerAgentExplainWindow(
    host: TerminalHostState,
    registry: TerminalWindowRegistry
  ) -> NSWindow {
    let windowControllerID = UUID()
    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: windowControllerID,
      store: Store(initialState: AppFeature.State()) {
        AppFeature()
      },
      terminal: host,
      requestConfirmedWindowClose: {}
    )
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)
    return window
  }
}
