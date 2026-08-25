import Foundation
import GhosttyKit
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateChildExitTests {
  @Test
  func childExitedRequestsImmediateCloseAndMarksActionHandled() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState(zmxSessionsEnabled: false)
    host.ensureInitialTab(focusing: false, startupCommand: nil)

    let surface = try #require(host.selectedSurfaceView)
    let target = ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_SHOW_CHILD_EXITED, action: ghostty_action_u())
    action.action.child_exited.exit_code = 0
    action.action.child_exited.timetime_ms = 28

    #expect(surface.bridge.handleAction(target: target, action: action))
    #expect(surface.bridge.state.childExitCode == 0)
    #expect(surface.bridge.state.childExitTimeMs == 28)
    surface.bridge.closeSurface(processAlive: false)

    #expect(host.pendingEvents == [.windowCloseRequested(needsConfirmation: false)])
  }

  @Test
  func childExitRetriesAReportedZmxSessionBeforeClosing() async throws {
    initializeGhosttyForTests()
    let listedSessions = Mutex(0)
    let listedSurfaceID = Mutex<UUID?>(nil)
    let host = TerminalHostState(
      sessionHostClient: TerminalSessionHostClient(
        isAvailable: { false },
        canManageSessions: { true },
        sessionID: { $0.uuidString.lowercased() },
        commandWrapper: { _, _ in nil },
        killSession: { _ in },
        listSessions: {
          listedSessions.withLock { count in
            count += 1
            return count == 1
              ? listedSurfaceID.withLock {
                $0.map { [TerminalSessionHostSession(surfaceID: $0, processID: 1)] } ?? []
              }
              : []
          }
        }
      )
    )
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let surfaceID = try #require(host.selectedSurfaceView?.id)
    listedSurfaceID.withLock { $0 = surfaceID }

    host.requestCloseSurfaceAfterProcessExit(
      surfaceID,
      usesSessionHost: true,
      source: .ghosttyChildExit
    )

    for _ in 0..<100 {
      if listedSessions.withLock({ $0 }) == 2, !host.pendingEvents.isEmpty {
        break
      }
      try await Task.sleep(for: .milliseconds(10))
    }
    let event = try #require(host.pendingEvents.first)
    #expect(event == .windowCloseRequested(needsConfirmation: false))
    #expect(listedSessions.withLock { $0 } == 2)
  }

  @Test
  func childExitReattachesWhenZmxSessionRemainsAfterRetry() async throws {
    initializeGhosttyForTests()
    let listedSessions = Mutex(0)
    let listedSurfaceID = Mutex<UUID?>(nil)
    let host = TerminalHostState(
      sessionHostClient: TerminalSessionHostClient(
        isAvailable: { false },
        canManageSessions: { true },
        sessionID: { $0.uuidString.lowercased() },
        commandWrapper: { _, _ in nil },
        killSession: { _ in },
        listSessions: {
          listedSessions.withLock { $0 += 1 }
          return listedSurfaceID.withLock {
            $0.map { [TerminalSessionHostSession(surfaceID: $0, processID: 1)] } ?? []
          }
        }
      )
    )
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let originalSurface = try #require(host.selectedSurfaceView)
    listedSurfaceID.withLock { $0 = originalSurface.id }

    host.requestCloseSurfaceAfterProcessExit(
      originalSurface.id,
      usesSessionHost: true,
      source: .ghosttyChildExit
    )

    for _ in 0..<100 {
      if listedSessions.withLock({ $0 }) >= 2,
        host.selectedSurfaceView !== originalSurface
      {
        break
      }
      try await Task.sleep(for: .milliseconds(10))
    }
    #expect(listedSessions.withLock { $0 } == 2)
    #expect(host.selectedSurfaceView?.id == originalSurface.id)
    #expect(host.selectedSurfaceView !== originalSurface)
  }
}
