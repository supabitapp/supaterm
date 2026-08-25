import Foundation

nonisolated struct TerminalTabItem: Identifiable, Equatable, Sendable {
  let id: TerminalTabID
  let defaultTitle: String
  var title: String
  var projectID: TerminalProjectID?
  var isPinned: Bool
  var isDirty: Bool
  var isTitleLocked: Bool

  init(
    id: TerminalTabID = TerminalTabID(),
    title: String,
    projectID: TerminalProjectID? = nil,
    isPinned: Bool = false,
    isDirty: Bool = false,
    isTitleLocked: Bool = false
  ) {
    self.id = id
    self.defaultTitle = title
    self.title = title
    self.projectID = projectID
    self.isPinned = isPinned
    self.isDirty = isDirty
    self.isTitleLocked = isTitleLocked
  }
}
