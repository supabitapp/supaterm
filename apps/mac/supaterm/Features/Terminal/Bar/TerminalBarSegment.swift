import Foundation

nonisolated enum TerminalBarSegmentTone: Equatable, Sendable {
  case normal
  case muted
  case success
  case warning
  case error
  case accent
}

nonisolated struct TerminalBarSegment: Equatable, Identifiable, Sendable {
  let id: String
  let text: String
  let tooltip: String?
  let tone: TerminalBarSegmentTone

  init(
    id: String,
    text: String,
    tooltip: String? = nil,
    tone: TerminalBarSegmentTone = .normal
  ) {
    self.id = id
    self.text = text
    self.tooltip = tooltip
    self.tone = tone
  }
}

nonisolated struct TerminalBarPresentation: Equatable, Sendable {
  var left: [TerminalBarSegment]
  var center: [TerminalBarSegment]
  var right: [TerminalBarSegment]

  static let empty = Self(left: [], center: [], right: [])
}
