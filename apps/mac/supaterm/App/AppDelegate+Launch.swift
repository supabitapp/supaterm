import Foundation
import SupatermCLIShared
import SupatermTerminalModels

extension AppDelegate {
  struct LaunchWindowRequest: Equatable {
    let session: TerminalWindowSession?
    let startupCommand: String?
  }

  private static var onboardingStartupCommand: String {
    SupatermShellCommand.interactiveStartupCommand(for: "sp onboard")
  }

  static func initialWindowSessions(
    from sessionCatalog: TerminalSessionCatalog,
    restoreTerminalLayoutEnabled: Bool
  ) -> [TerminalWindowSession?] {
    guard restoreTerminalLayoutEnabled else {
      return [nil]
    }
    if sessionCatalog.windows.isEmpty {
      return [nil]
    }
    return sessionCatalog.windows.map(Optional.some)
  }

  static func initialWindowRequests(
    from sessionCatalog: TerminalSessionCatalog,
    restoreTerminalLayoutEnabled: Bool,
    lastAppLaunchedDate: Date?
  ) -> [LaunchWindowRequest] {
    let sessions = initialWindowSessions(
      from: sessionCatalog,
      restoreTerminalLayoutEnabled: restoreTerminalLayoutEnabled
    )
    let onboardingWindowIndex: Int?
    if lastAppLaunchedDate == nil {
      onboardingWindowIndex = sessions.firstIndex(where: { $0 == nil })
    } else {
      onboardingWindowIndex = nil
    }

    return sessions.enumerated().map { index, session in
      LaunchWindowRequest(
        session: session,
        startupCommand: index == onboardingWindowIndex ? onboardingStartupCommand : nil
      )
    }
  }
}
