import Foundation

public final class AnalyticsEventRecorder: @unchecked Sendable {
  nonisolated(unsafe) private var events: [String] = []
  private let lock = NSLock()

  public init() {}

  public nonisolated func recorded() -> [String] {
    lock.withLock {
      events
    }
  }

  public nonisolated func record(_ event: String) {
    lock.withLock {
      events.append(event)
    }
  }
}
