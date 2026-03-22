import ComposableArchitecture
import Foundation
import UserNotifications

struct DesktopNotificationRequest: Equatable, Sendable {
  let body: String
  let subtitle: String
  let title: String
}

struct DesktopNotificationClient: Sendable {
  var deliver: @Sendable (DesktopNotificationRequest) async -> Void
}

extension DesktopNotificationClient: DependencyKey {
  static let liveValue = Self(
    deliver: { request in
      await DesktopNotificationCenter.shared.deliver(request)
    }
  )

  static let testValue = Self(
    deliver: { _ in }
  )
}

extension DependencyValues {
  var desktopNotificationClient: DesktopNotificationClient {
    get { self[DesktopNotificationClient.self] }
    set { self[DesktopNotificationClient.self] = newValue }
  }
}

private actor DesktopNotificationCenter {
  private enum AuthorizationStatus: Sendable {
    case authorized
    case denied
    case notDetermined
  }

  static let shared = DesktopNotificationCenter()

  private let center = UNUserNotificationCenter.current()

  func deliver(_ request: DesktopNotificationRequest) async {
    switch await authorizationStatus() {
    case .authorized:
      await enqueue(request)
    case .notDetermined:
      guard await requestAuthorization() else { return }
      await enqueue(request)
    case .denied:
      return
    }
  }

  private func authorizationStatus() async -> AuthorizationStatus {
    await withCheckedContinuation { continuation in
      center.getNotificationSettings { settings in
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
          continuation.resume(returning: .authorized)
        case .notDetermined:
          continuation.resume(returning: .notDetermined)
        case .denied:
          continuation.resume(returning: .denied)
        @unknown default:
          continuation.resume(returning: .denied)
        }
      }
    }
  }

  private func requestAuthorization() async -> Bool {
    await withCheckedContinuation { continuation in
      center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
        continuation.resume(returning: granted)
      }
    }
  }

  private func enqueue(_ request: DesktopNotificationRequest) async {
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

    await withCheckedContinuation { continuation in
      center.add(notificationRequest) { _ in
        continuation.resume()
      }
    }
  }
}
