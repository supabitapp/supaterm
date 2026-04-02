import AppKit
import ComposableArchitecture
import Foundation
import UserNotifications

private final class ForegroundDesktopNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    await Task.yield()
    return [.badge, .sound, .banner]
  }
}

@MainActor
private let foregroundDesktopNotificationDelegate = ForegroundDesktopNotificationDelegate()

@MainActor
private func configuredNotificationCenter() -> UNUserNotificationCenter {
  let center = UNUserNotificationCenter.current()
  if center.delegate !== foregroundDesktopNotificationDelegate {
    center.delegate = foregroundDesktopNotificationDelegate
  }
  return center
}

struct DesktopNotificationRequest: Equatable, Sendable {
  let body: String
  let subtitle: String
  let title: String
}

struct DesktopNotificationClient: Sendable {
  struct AuthorizationRequestResult: Equatable, Sendable {
    let granted: Bool
    let errorMessage: String?
  }

  enum AuthorizationStatus: Equatable, Sendable {
    case authorized
    case denied
    case notDetermined
  }

  var authorizationStatus: @MainActor @Sendable () async -> AuthorizationStatus
  var requestAuthorization: @MainActor @Sendable () async -> AuthorizationRequestResult
  var openSettings: @MainActor @Sendable () async -> Void
  var deliver: @MainActor @Sendable (DesktopNotificationRequest) async -> Void
}

extension DesktopNotificationClient: DependencyKey {
  static let liveValue = Self(
    authorizationStatus: {
      let center = configuredNotificationCenter()
      let settings = await center.notificationSettings()
      switch settings.authorizationStatus {
      case .authorized, .provisional, .ephemeral:
        return .authorized
      case .denied:
        return .denied
      case .notDetermined:
        return .notDetermined
      @unknown default:
        return .denied
      }
    },
    requestAuthorization: {
      let center = configuredNotificationCenter()
      do {
        let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
        return .init(granted: granted, errorMessage: nil)
      } catch {
        return .init(granted: false, errorMessage: error.localizedDescription)
      }
    },
    openSettings: {
      guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.notifications") else {
        return
      }
      _ = NSWorkspace.shared.open(url)
    },
    deliver: { request in
      let center = configuredNotificationCenter()
      let content = UNMutableNotificationContent()
      content.body = request.body
      content.subtitle = request.subtitle
      content.title = request.title
      content.sound = .default
      let notificationRequest = UNNotificationRequest(
        identifier: UUID().uuidString,
        content: content,
        trigger: nil
      )
      try? await center.add(notificationRequest)
    }
  )

  static let testValue = Self(
    authorizationStatus: { .notDetermined },
    requestAuthorization: { .init(granted: false, errorMessage: nil) },
    openSettings: {},
    deliver: { _ in }
  )
}

extension DependencyValues {
  var desktopNotificationClient: DesktopNotificationClient {
    get { self[DesktopNotificationClient.self] }
    set { self[DesktopNotificationClient.self] = newValue }
  }
}
