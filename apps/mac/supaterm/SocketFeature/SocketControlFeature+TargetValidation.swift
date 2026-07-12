import Foundation

extension SocketControlFeature {
  func validateTargetPayload(
    windowIndex: Int?,
    spaceIndex: Int?,
    projectIndex: Int?,
    tabIndex: Int?,
    paneIndex: Int?
  ) throws {
    if let windowIndex, windowIndex < 1 {
      throw SocketRequestError.invalidIndex("window")
    }
    if let spaceIndex, spaceIndex < 1 {
      throw SocketRequestError.invalidIndex("space")
    }
    if let projectIndex, projectIndex < 1 {
      throw SocketRequestError.invalidIndex("project")
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
    if tabIndex != nil && projectIndex == nil {
      throw SocketRequestError.tabRequiresProject
    }
    if projectIndex != nil && spaceIndex == nil {
      throw SocketRequestError.projectRequiresSpace
    }
    if projectIndex != nil && tabIndex == nil {
      throw SocketRequestError.projectRequiresTab
    }
    if spaceIndex != nil && projectIndex == nil {
      throw SocketRequestError.spaceRequiresProject
    }
    if windowIndex != nil && spaceIndex == nil {
      throw SocketRequestError.windowRequiresSpace
    }
  }
}
