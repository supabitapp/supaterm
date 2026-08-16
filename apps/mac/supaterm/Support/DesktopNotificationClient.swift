import AppKit
import ComposableArchitecture
import Foundation
import UserNotifications

@MainActor
private func configuredNotificationCenter() -> UNUserNotificationCenter {
  UNUserNotificationCenter.current()
}

public struct DesktopNotificationRequest: Equatable, Sendable {
  public nonisolated static let sourceSurfaceIDUserInfoKey = "supatermSourceSurfaceID"

  public let body: String
  public let sourceSurfaceID: UUID?
  public let subtitle: String
  public let title: String

  public init(
    body: String,
    subtitle: String,
    title: String,
    sourceSurfaceID: UUID? = nil
  ) {
    self.body = body
    self.sourceSurfaceID = sourceSurfaceID
    self.subtitle = subtitle
    self.title = title
  }

  public nonisolated var userInfo: [AnyHashable: Any] {
    guard let sourceSurfaceID else { return [:] }
    return [Self.sourceSurfaceIDUserInfoKey: sourceSurfaceID.uuidString]
  }

  public nonisolated static func sourceSurfaceID(from userInfo: [AnyHashable: Any]) -> UUID? {
    guard let value = userInfo[sourceSurfaceIDUserInfoKey] as? String else {
      return nil
    }
    return UUID(uuidString: value)
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
        return AuthorizationRequestResult(granted: granted, errorMessage: nil)
      } catch {
        return AuthorizationRequestResult(granted: false, errorMessage: error.localizedDescription)
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
      content.userInfo = request.userInfo
      let notificationRequest = UNNotificationRequest(
        identifier: UUID().uuidString,
        content: content,
        trigger: nil
      )
      try? await center.add(notificationRequest)
    }
  )

  public static let testValue = Self(
    authorizationStatus: unimplemented(
      "DesktopNotificationClient.authorizationStatus",
      placeholder: .notDetermined
    ),
    requestAuthorization: unimplemented(
      "DesktopNotificationClient.requestAuthorization",
      placeholder: AuthorizationRequestResult(granted: false, errorMessage: nil)
    ),
    openSettings: unimplemented("DesktopNotificationClient.openSettings"),
    deliver: unimplemented("DesktopNotificationClient.deliver")
  )
}

extension DependencyValues {
  public var desktopNotificationClient: DesktopNotificationClient {
    get { self[DesktopNotificationClient.self] }
    set { self[DesktopNotificationClient.self] = newValue }
  }
}
