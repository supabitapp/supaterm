import ComposableArchitecture
import Foundation
import SupatermCLIShared

public struct NotificationRequest: Equatable, Sendable {
  public let body: String
  public let disposition: SupatermNotificationDisposition
  public let sourceSurfaceID: UUID?
  public let subtitle: String
  public let title: String

  public init(
    body: String,
    disposition: SupatermNotificationDisposition,
    subtitle: String,
    title: String,
    sourceSurfaceID: UUID? = nil
  ) {
    self.body = body
    self.disposition = disposition
    self.sourceSurfaceID = sourceSurfaceID
    self.subtitle = subtitle
    self.title = title
  }

}

public enum NotificationOutput: Equatable, Sendable {
  case none
  case sound(NotificationSound)
  case system
}

extension SupatermSettings {
  public var notificationOutput: NotificationOutput {
    if systemNotificationsEnabled {
      return .system
    }
    if notificationSound == .never {
      return .none
    }
    return .sound(notificationSound)
  }
}

public struct NotificationOutputClient: Sendable {
  public var deliver: @MainActor @Sendable (NotificationRequest, NotificationOutput) async -> Void

  init(
    desktopNotificationClient: DesktopNotificationClient,
    notificationSoundClient: NotificationSoundClient
  ) {
    deliver = { request, output in
      guard request.disposition.shouldDeliver else { return }
      switch output {
      case .none:
        return
      case .sound(let sound):
        notificationSoundClient.play(sound)
      case .system:
        await desktopNotificationClient.deliver(request)
      }
    }
  }

  init(
    deliver: @escaping @MainActor @Sendable (NotificationRequest, NotificationOutput) async -> Void
  ) {
    self.deliver = deliver
  }
}

extension NotificationOutputClient: DependencyKey {
  public static let liveValue = Self(
    desktopNotificationClient: .liveValue,
    notificationSoundClient: .liveValue
  )

  public static let testValue = Self(
    deliver: unimplemented("NotificationOutputClient.deliver")
  )
}

extension DependencyValues {
  public var notificationOutputClient: NotificationOutputClient {
    get { self[NotificationOutputClient.self] }
    set { self[NotificationOutputClient.self] = newValue }
  }
}
