import Foundation

extension SocketControlFeature {
  func validateTargetPayload(
    windowIndex: Int?,
    spaceIndex: Int?,
    tabIndex: Int?,
    paneIndex: Int?
  ) throws {
    if let windowIndex, windowIndex < 1 {
      throw SocketRequestError.invalidIndex("window")
    }
    if let spaceIndex, spaceIndex < 1 {
      throw SocketRequestError.invalidIndex("space")
    }
    if let tabIndex, tabIndex < 1 {
      throw SocketRequestError.invalidIndex("tab")
    }
    if let paneIndex, paneIndex < 1 {
      throw SocketRequestError.invalidIndex("pane")
    }
    if paneIndex != nil && tabIndex == nil {
      throw SocketRequestError.paneRequiresTab
    }
    if tabIndex != nil && spaceIndex == nil {
      throw SocketRequestError.tabRequiresSpace
    }
    if spaceIndex != nil && tabIndex == nil {
      throw SocketRequestError.spaceRequiresTab
    }
    if windowIndex != nil && spaceIndex == nil {
      throw SocketRequestError.windowRequiresSpace
    }
  }
}
