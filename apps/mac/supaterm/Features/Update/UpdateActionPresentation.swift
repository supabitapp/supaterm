import Foundation

public struct UpdateActionPresentation: Equatable, Sendable {
  public let title: String
  public let action: UpdateUserAction
  public let isProminent: Bool

  public init(
    title: String,
    action: UpdateUserAction,
    isProminent: Bool
  ) {
    self.title = title
    self.action = action
    self.isProminent = isProminent
  }
}

extension UpdatePhase {
  public var actionPresentations: [UpdateActionPresentation] {
    switch self {
    case .idle, .checking, .extracting, .notFound:
      return []

    case .permissionRequest:
      return [
        UpdateActionPresentation(
          title: "Not Now",
          action: .declineAutomaticChecks,
          isProminent: false
        ),
        UpdateActionPresentation(
          title: "Allow",
          action: .allowAutomaticChecks,
          isProminent: true
        ),
      ]

    case .updateAvailable:
      return [
        UpdateActionPresentation(
          title: "Skip",
          action: .skipVersion,
          isProminent: false
        ),
        UpdateActionPresentation(
          title: "Later",
          action: .dismiss,
          isProminent: false
        ),
        UpdateActionPresentation(
          title: "Install and Relaunch",
          action: .install,
          isProminent: true
        ),
      ]

    case .downloading:
      return [
        UpdateActionPresentation(
          title: "Cancel",
          action: .cancel,
          isProminent: false
        )
      ]

    case .installing(let installing):
      guard installing.showsPrompt else { return [] }
      return [
        UpdateActionPresentation(
          title: "Restart Later",
          action: .restartLater,
          isProminent: false
        ),
        UpdateActionPresentation(
          title: "Restart Now",
          action: .restartNow,
          isProminent: true
        ),
      ]

    case .error:
      return [
        UpdateActionPresentation(
          title: "OK",
          action: .dismiss,
          isProminent: false
        ),
        UpdateActionPresentation(
          title: "Retry",
          action: .retry,
          isProminent: true
        ),
      ]
    }
  }
}
