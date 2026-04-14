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
        .init(
          title: "Not Now",
          action: .declineAutomaticChecks,
          isProminent: false
        ),
        .init(
          title: "Allow",
          action: .allowAutomaticChecks,
          isProminent: true
        ),
      ]

    case .updateAvailable:
      return [
        .init(
          title: "Skip",
          action: .skipVersion,
          isProminent: false
        ),
        .init(
          title: "Later",
          action: .dismiss,
          isProminent: false
        ),
        .init(
          title: "Install and Relaunch",
          action: .install,
          isProminent: true
        ),
      ]

    case .downloading:
      return [
        .init(
          title: "Cancel",
          action: .cancel,
          isProminent: false
        )
      ]

    case .installing(let installing):
      guard installing.showsPrompt else { return [] }
      return [
        .init(
          title: "Restart Later",
          action: .restartLater,
          isProminent: false
        ),
        .init(
          title: "Restart Now",
          action: .restartNow,
          isProminent: true
        ),
      ]

    case .error:
      return [
        .init(
          title: "OK",
          action: .dismiss,
          isProminent: false
        ),
        .init(
          title: "Retry",
          action: .retry,
          isProminent: true
        ),
      ]
    }
  }
}
