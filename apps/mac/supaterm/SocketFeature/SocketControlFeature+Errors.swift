import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension SocketControlFeature {
  func createTabErrorResponse(
    _ error: TerminalCreateTabError,
    requestID: String
  ) -> SupatermSocketResponse {
    switch error {
    case .contextPaneNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "The current pane could not be resolved."
      )

    case .creationFailed:
      return .error(
        id: requestID,
        code: "internal_error",
        message: "Failed to create a new tab."
      )

    case .projectSelectorAmbiguous(let selector, let spaceName, let projects):
      return .error(
        id: requestID,
        code: "ambiguous_target",
        message: projectSelectorErrorMessage(
          "Project selector \"\(selector)\" is ambiguous in space \"\(spaceName)\".",
          projects: projects
        )
      )

    case .projectSelectorNotFound(let selector, let spaceName, let projects):
      return .error(
        id: requestID,
        code: "not_found",
        message: projectSelectorErrorMessage(
          "No project matches \"\(selector)\" in space \"\(spaceName)\".",
          projects: projects
        )
      )

    case .spaceNotFound(let windowIndex, let spaceIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Space \(spaceIndex) was not found in window \(windowIndex)."
      )

    case .windowNotFound(let windowIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Window \(windowIndex) was not found."
      )
    }
  }

  private func projectSelectorErrorMessage(
    _ message: String,
    projects: [TerminalProjectDescriptor]
  ) -> String {
    let rows = projects.map {
      "- \($0.name) | \($0.id.uuidString.lowercased()) | \($0.path)"
    }
    return ([message, "Available projects:"] + rows).joined(separator: "\n")
  }

  func terminalErrorResponse(
    _ error: TerminalCreatePaneError,
    requestID: String
  ) -> SupatermSocketResponse {
    switch error {
    case .contextPaneNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "The current pane could not be resolved."
      )

    case .creationFailed:
      return .error(
        id: requestID,
        code: "internal_error",
        message: "Failed to create a new pane."
      )

    case .paneNotFound(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message:
          "Pane \(paneIndex) was not found in tab \(tabIndex) of space \(spaceIndex) of window \(windowIndex)."
      )

    case .spaceNotFound(let windowIndex, let spaceIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Space \(spaceIndex) was not found in window \(windowIndex)."
      )

    case .tabNotFound(let windowIndex, let spaceIndex, let tabIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Tab \(tabIndex) was not found in space \(spaceIndex) of window \(windowIndex)."
      )

    case .windowNotFound(let windowIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Window \(windowIndex) was not found."
      )
    }
  }

  func controlErrorResponse(
    _ error: TerminalControlError,
    requestID: String
  ) -> SupatermSocketResponse {
    switch error {
    case .captureFailed:
      return .error(
        id: requestID,
        code: "internal_error",
        message: "Failed to capture pane text."
      )

    case .contextPaneNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "The current pane could not be resolved."
      )

    case .invalidSpaceName:
      return .error(
        id: requestID,
        code: "invalid_request",
        message: "Space name must not be empty."
      )

    case .lastPaneNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "No previously focused pane was found."
      )

    case .lastSpaceNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "No previously selected space was found."
      )

    case .lastTabNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "No previously selected tab was found."
      )

    case .onlyRemainingSpace:
      return .error(
        id: requestID,
        code: "invalid_request",
        message: "Cannot close the only remaining space."
      )

    case .paneNotFound(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message:
          "Pane \(paneIndex) was not found in tab \(tabIndex) of space \(spaceIndex) of window \(windowIndex)."
      )

    case .resizeFailed:
      return .error(
        id: requestID,
        code: "internal_error",
        message: "Failed to resize the pane."
      )

    case .spaceNameUnavailable:
      return .error(
        id: requestID,
        code: "invalid_request",
        message: "Space name is already in use."
      )

    case .spaceNotFound(let windowIndex, let spaceIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Space \(spaceIndex) was not found in window \(windowIndex)."
      )

    case .tabNotFound(let windowIndex, let spaceIndex, let tabIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Tab \(tabIndex) was not found in space \(spaceIndex) of window \(windowIndex)."
      )

    case .windowNotFound(let windowIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Window \(windowIndex) was not found."
      )
    }
  }
}
