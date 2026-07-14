import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalProjectDirectoryMonitorTests {
  @Test
  func refreshTracksDirectoryAvailabilityTransitions() async throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let directoryURL = root.appendingPathComponent("Project", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let monitor = TerminalProjectDirectoryMonitor(
      notificationCenter: NotificationCenter(),
      workspaceNotificationCenter: NotificationCenter()
    )

    monitor.update(urls: [directoryURL])

    #expect(await waitUntil { !monitor.isAvailable(directoryURL) })

    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    monitor.refreshAll()

    #expect(await waitUntil { monitor.isAvailable(directoryURL) })

    try FileManager.default.removeItem(at: directoryURL)
    monitor.refreshAll()

    #expect(await waitUntil { !monitor.isAvailable(directoryURL) })
  }
}
