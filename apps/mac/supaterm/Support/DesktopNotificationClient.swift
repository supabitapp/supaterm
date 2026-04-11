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

public struct DesktopNotificationRequest: Equatable, Sendable {
  public let body: String
  public let subtitle: String
  public let title: String

  public init(
    body: String,
    subtitle: String,
    title: String
  ) {
    self.body = body
    self.subtitle = subtitle
    self.title = title
  }
}

public struct DesktopNotificationClient: Sendable {
  public struct AuthorizationRequestResult: Equatable, Sendable {
    public let granted: Bool
    public let errorMessage: String?

    public init(
      granted: Bool,
      errorMessage: String?
    ) {
      self.granted = granted
      self.errorMessage = errorMessage
    }
  }

  public enum AuthorizationStatus: Equatable, Sendable {
    case authorized
    case denied
    case notDetermined
  }

  public var authorizationStatus: @MainActor @Sendable () async -> AuthorizationStatus
  public var requestAuthorization: @MainActor @Sendable () async -> AuthorizationRequestResult
  public var openSettings: @MainActor @Sendable () async -> Void
  public var deliver: @MainActor @Sendable (DesktopNotificationRequest) async -> Void

  public init(
    authorizationStatus: @escaping @MainActor @Sendable () async -> AuthorizationStatus,
    requestAuthorization: @escaping @MainActor @Sendable () async -> AuthorizationRequestResult,
    openSettings: @escaping @MainActor @Sendable () async -> Void,
    deliver: @escaping @MainActor @Sendable (DesktopNotificationRequest) async -> Void
  ) {
    self.authorizationStatus = authorizationStatus
    self.requestAuthorization = requestAuthorization
    self.openSettings = openSettings
    self.deliver = deliver
  }
}

extension DesktopNotificationClient: DependencyKey {
  public static let liveValue = Self(
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

  public static let testValue = Self(
    authorizationStatus: { .notDetermined },
    requestAuthorization: { .init(granted: false, errorMessage: nil) },
    openSettings: {},
    deliver: { _ in }
  )
}

extension DependencyValues {
  public var desktopNotificationClient: DesktopNotificationClient {
    get { self[DesktopNotificationClient.self] }
    set { self[DesktopNotificationClient.self] = newValue }
  }
}
