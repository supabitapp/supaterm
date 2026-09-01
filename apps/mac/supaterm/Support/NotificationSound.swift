import AppKit
import ComposableArchitecture

public enum NotificationSound: String, CaseIterable, Codable, Equatable, Hashable, Identifiable, Sendable {
  case never
  case basso
  case blow
  case bottle
  case frog
  case funk
  case glass
  case hero
  case morse
  case ping
  case pop
  case purr
  case sosumi
  case submarine
  case tink

  public var id: String {
    rawValue
  }

  public var title: String {
    self == .never ? "Never" : rawValue.capitalized
  }

  var systemName: String? {
    self == .never ? nil : title
  }
}

@MainActor
private final class NotificationSoundPlayer {
  private var sounds: [NotificationSound: NSSound] = [:]

  func play(_ sound: NotificationSound) {
    guard let systemName = sound.systemName else { return }
    guard let nativeSound = sounds[sound] ?? NSSound(named: NSSound.Name(systemName)) else {
      SupatermLog.error(
        SupatermLog.notifications,
        "notification.sound.load.failed",
        fields: ["sound=\(sound.rawValue)"]
      )
      return
    }
    sounds[sound] = nativeSound
    guard nativeSound.play() else {
      SupatermLog.error(
        SupatermLog.notifications,
        "notification.sound.play.failed",
        fields: ["sound=\(sound.rawValue)"]
      )
      return
    }
  }
}

public struct NotificationSoundClient: Sendable {
  public var play: @MainActor @Sendable (NotificationSound) -> Void

  public init(play: @escaping @MainActor @Sendable (NotificationSound) -> Void) {
    self.play = play
  }
}

extension NotificationSoundClient: DependencyKey {
  public static let liveValue: Self = {
    let player = NotificationSoundPlayer()
    return Self(play: player.play)
  }()

  public static let testValue = Self(
    play: unimplemented("NotificationSoundClient.play")
  )
}

extension DependencyValues {
  public var notificationSoundClient: NotificationSoundClient {
    get { self[NotificationSoundClient.self] }
    set { self[NotificationSoundClient.self] = newValue }
  }
}

public struct NotificationPresenter: Sendable {
  private let desktopNotificationClient: DesktopNotificationClient
  private let notificationSoundClient: NotificationSoundClient

  public init(
    desktopNotificationClient: DesktopNotificationClient,
    notificationSoundClient: NotificationSoundClient
  ) {
    self.desktopNotificationClient = desktopNotificationClient
    self.notificationSoundClient = notificationSoundClient
  }

  @MainActor
  public func present(
    _ request: DesktopNotificationRequest,
    shouldDeliver: Bool,
    settings: SupatermSettings
  ) async {
    guard shouldDeliver else { return }
    if settings.systemNotificationsEnabled {
      await desktopNotificationClient.deliver(request)
    } else if settings.notificationSound != .never {
      notificationSoundClient.play(settings.notificationSound)
    }
  }
}
