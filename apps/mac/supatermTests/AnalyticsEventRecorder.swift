import Foundation

@testable import supaterm

final class AnalyticsEventRecorder: @unchecked Sendable {
  nonisolated(unsafe) private var events: [String] = []
  private let lock = NSLock()

  nonisolated func recorded() -> [String] {
    lock.withLock {
      events
    }
  }

  nonisolated func record(_ event: String) {
    lock.withLock {
      events.append(event)
    }
  }
}
