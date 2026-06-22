import Foundation

public struct TerminalTabItem: Identifiable, Equatable, Sendable {
  public let id: TerminalTabID
  public let defaultTitle: String
  public var title: String
  public var isDirty: Bool
  public var isPinned: Bool
  public var isTitleLocked: Bool

  public init(
    id: TerminalTabID = TerminalTabID(),
    title: String,
    isDirty: Bool = false,
    isPinned: Bool = false,
    isTitleLocked: Bool = false
  ) {
    self.id = id
    self.defaultTitle = title
    self.title = title
    self.isDirty = isDirty
    self.isPinned = isPinned
    self.isTitleLocked = isTitleLocked
  }
}

enum TerminalTone: CaseIterable, Equatable, Sendable {
  case amber
  case coral
  case mint
  case sky
  case slate
  case violet
}
