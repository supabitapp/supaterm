import Foundation
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore

extension SocketControlFeature {
  func skillsErrorResponse(
    _ error: SupatermSkillsError,
    requestID: String
  ) -> SupatermSocketResponse {
    switch error {
    case .skillNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: error.localizedDescription
      )

    case .bundledSkillsUnavailable, .invalidSkill:
      return .error(
        id: requestID,
        code: "internal_error",
        message: error.localizedDescription
      )
    }
  }

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

    case .tabLimitReached(let limit, _):
      return .error(
        id: requestID,
        code: "license_required",
        message: TerminalCreateTabError.tabLimitMessage(limit: limit)
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
    if let response = captureErrorResponse(error, requestID: requestID) {
      return response
    }
    if let response = projectErrorResponse(error, requestID: requestID) {
      return response
    }

    switch error {
    case .contextPaneNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "The current pane could not be resolved."
      )

    case .captureFailed, .invalidCaptureLines, .invalidProjectIndex, .invalidProjectName,
      .projectCloseConfirmationRequired, .projectNotFound, .screenshotFailed:
      preconditionFailure()

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

  private func captureErrorResponse(
    _ error: TerminalControlError,
    requestID: String
  ) -> SupatermSocketResponse? {
    switch error {
    case .captureFailed:
      return .error(
        id: requestID,
        code: "internal_error",
        message: "Failed to capture pane text."
      )
    case .invalidCaptureLines(let lines):
      return .error(
        id: requestID,
        code: "invalid_request",
        message: "Capture lines must be between 1 and \(UInt32.max), not \(lines)."
      )
    case .screenshotFailed:
      return .error(
        id: requestID,
        code: "internal_error",
        message: "Failed to capture pane screenshot."
      )
    default:
      return nil
    }
  }

  private func projectErrorResponse(
    _ error: TerminalControlError,
    requestID: String
  ) -> SupatermSocketResponse? {
    switch error {
    case .projectNotFound(let projectID):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Project \(projectID.uuidString.lowercased()) was not found."
      )
    case .projectCloseConfirmationRequired:
      return .error(
        id: requestID,
        code: "confirmation_required",
        message: "Removing this Project will close its tabs. Confirm the removal first."
      )
    case .invalidProjectIndex(let index):
      return .error(
        id: requestID,
        code: "invalid_request",
        message: "Project index \(index + 1) is outside the destination lane."
      )
    case .invalidProjectName:
      return .error(
        id: requestID,
        code: "invalid_request",
        message: "Project name must not be empty or already used."
      )
    default:
      return nil
    }
  }
}
