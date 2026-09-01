import AppKit
import ComposableArchitecture
import Foundation

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
  case supatermClassic = "supaterm"
  case tink

  enum Source: Equatable, Sendable {
    case bundled(resource: String, fileExtension: String)
    case system(name: String)
  }

  public static let systemCases = allCases.filter {
    if case .system? = $0.source { return true }
    return false
  }

  public var id: String {
    rawValue
  }

  public var title: String {
    switch self {
    case .never:
      return "Never"
    case .supatermClassic:
      return "Supaterm Classic"
    default:
      return rawValue.capitalized
    }
  }

  var source: Source? {
    switch self {
    case .never:
      return nil
    case .supatermClassic:
      return .bundled(resource: "notification", fileExtension: "wav")
    default:
      return .system(name: title)
    }
  }
}

@MainActor
private final class NotificationSoundPlayer {
  private var sounds: [NotificationSound: NSSound] = [:]

  func play(_ sound: NotificationSound) {
    guard let source = sound.source else { return }
    guard let nativeSound = sounds[sound] ?? load(source) else {
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

  private func load(_ source: NotificationSound.Source) -> NSSound? {
    switch source {
    case .bundled(let resource, let fileExtension):
      guard let url = Bundle.main.url(forResource: resource, withExtension: fileExtension) else {
        return nil
      }
      return NSSound(contentsOf: url, byReference: true)
    case .system(let name):
      return NSSound(named: NSSound.Name(name))
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
