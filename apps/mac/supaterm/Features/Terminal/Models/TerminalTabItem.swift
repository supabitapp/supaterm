import Foundation

struct TerminalTabItem: Identifiable, Equatable, Sendable {
  let id: TerminalTabID
  let defaultTitle: String
  var title: String
  var isDirty: Bool
  var isPinned: Bool
  var isTitleLocked: Bool

  init(
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
