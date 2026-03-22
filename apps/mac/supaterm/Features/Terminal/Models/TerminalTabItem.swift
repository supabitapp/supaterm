import Foundation

struct TerminalTabItem: Identifiable, Equatable, Sendable {
  let id: TerminalTabID
  let defaultTitle: String
  var title: String
  var icon: String?
  var isDirty: Bool
  var isPinned: Bool
  var isTitleLocked: Bool

  var symbol: String {
    icon ?? "terminal"
  }

  var tone: TerminalTone {
    let uuid = id.rawValue.uuid
    let seed =
      Int(uuid.0) ^ Int(uuid.1) ^ Int(uuid.2) ^ Int(uuid.3)
      ^ Int(uuid.4) ^ Int(uuid.5) ^ Int(uuid.6) ^ Int(uuid.7)
      ^ Int(uuid.8) ^ Int(uuid.9) ^ Int(uuid.10) ^ Int(uuid.11)
      ^ Int(uuid.12) ^ Int(uuid.13) ^ Int(uuid.14) ^ Int(uuid.15)
    return TerminalTone.allCases[seed % TerminalTone.allCases.count]
  }

  init(
    id: TerminalTabID = TerminalTabID(),
    title: String,
    icon: String?,
    isDirty: Bool = false,
    isPinned: Bool = false,
    isTitleLocked: Bool = false
  ) {
    self.id = id
    self.defaultTitle = title
    self.title = title
    self.icon = icon
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
