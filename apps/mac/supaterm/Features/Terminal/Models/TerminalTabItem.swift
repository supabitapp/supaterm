import Foundation

nonisolated struct TerminalTabItem: Identifiable, Equatable, Sendable {
  let id: TerminalTabID
  let defaultTitle: String
  var title: String
  var isDirty: Bool
  var isTitleLocked: Bool

  init(
    id: TerminalTabID = TerminalTabID(),
    title: String,
    isDirty: Bool = false,
    isTitleLocked: Bool = false
  ) {
    self.id = id
    self.defaultTitle = title
    self.title = title
    self.isDirty = isDirty
    self.isTitleLocked = isTitleLocked
  }
}
