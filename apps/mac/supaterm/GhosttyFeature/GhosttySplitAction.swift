public enum GhosttySplitAction {
  public enum NewDirection {
    case left
    case right
    case up
    case down
  }

  public enum FocusDirection {
    case previous
    case next
    case left
    case right
    case up
    case down
  }

  public enum ResizeDirection {
    case left
    case right
    case up
    case down
  }

  case newSplit(direction: NewDirection)
  case gotoSplit(direction: FocusDirection)
  case resizeSplit(direction: ResizeDirection, amount: UInt16)
  case equalizeSplits
  case toggleSplitZoom
}
