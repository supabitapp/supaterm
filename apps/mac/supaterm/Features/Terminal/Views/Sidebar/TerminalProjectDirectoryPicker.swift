import AppKit
import SupatermTerminalCore

@MainActor
enum TerminalProjectDirectoryPicker {
  static func chooseDirectories(
    for window: NSWindow?,
    completion: @escaping ([URL]) -> Void
  ) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = true
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.canCreateDirectories = false
    panel.prompt = "Add"
    panel.message = "Choose folders to add as projects."
    panel.directoryURL = FileManager.default.homeDirectoryForCurrentUser
    if let window {
      panel.beginSheetModal(for: window) { response in
        completion(response == .OK ? panel.urls : [])
      }
      return
    }
    completion(panel.runModal() == .OK ? panel.urls : [])
  }

  static func present(_ error: Error, for window: NSWindow?) {
    let alert = NSAlert()
    alert.messageText = "Couldn’t Add Project"
    alert.informativeText = message(for: error)
    if let window {
      alert.beginSheetModal(for: window)
    } else {
      alert.runModal()
    }
  }

  private static func message(for error: Error) -> String {
    guard let error = error as? TerminalControlError else {
      return error.localizedDescription
    }
    switch error {
    case .invalidProjectDirectory:
      return "Choose a folder."
    case .projectAlreadyExists:
      return "That folder is already a project in this space."
    case .projectDirectoryUnavailable:
      return "The folder is unavailable."
    default:
      return error.localizedDescription
    }
  }
}
