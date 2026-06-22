import Foundation

public nonisolated struct TerminalTabID: Hashable, Identifiable, Codable, Sendable {
  public let rawValue: UUID

  public init() {
    rawValue = UUID()
  }

  public init(rawValue: UUID) {
    self.rawValue = rawValue
  }

  public var id: UUID { rawValue }
}
