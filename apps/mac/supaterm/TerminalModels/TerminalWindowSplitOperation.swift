import Foundation

public enum TerminalSplitDropZone: String, Equatable, Sendable {
  case up
  case bottom
  case left
  case right
}

public enum TerminalWindowSplitOperation: Equatable, Sendable {
  case resize(leafIDs: [UUID], ratio: Double)
  case drop(payloadID: UUID, destinationID: UUID, zone: TerminalSplitDropZone)
  case equalize
}
