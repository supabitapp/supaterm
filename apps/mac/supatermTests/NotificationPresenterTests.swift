import Testing

@testable import SupatermSupport

@MainActor
struct NotificationPresenterTests {
  @Test
  func bundledSoundHasExpectedSource() {
    #expect(NotificationSound.supatermClassic.title == "Supaterm Classic")
    #expect(
      NotificationSound.supatermClassic.source
        == .bundled(resource: "notification", fileExtension: "wav")
    )
  }

  @Test
  func selectsOneOutputForEachDeliveryPolicy() async {
    let recorder = NotificationOutputRecorder()
    var desktopNotificationClient = DesktopNotificationClient.testValue
    desktopNotificationClient.deliver = { recorder.outputs.append(.system($0)) }
    var notificationSoundClient = NotificationSoundClient.testValue
    notificationSoundClient.play = { recorder.outputs.append(.sound($0)) }
    let presenter = NotificationPresenter(
      desktopNotificationClient: desktopNotificationClient,
      notificationSoundClient: notificationSoundClient
    )
    let request = DesktopNotificationRequest(
      body: "Build finished",
      subtitle: "CI",
      title: "Deploy complete"
    )
    var settings = SupatermSettings.default

    settings.systemNotificationsEnabled = true
    settings.notificationSound = .glass
    await presenter.present(request, shouldDeliver: true, settings: settings)

    settings.systemNotificationsEnabled = false
    await presenter.present(request, shouldDeliver: true, settings: settings)

    settings.notificationSound = .never
    await presenter.present(request, shouldDeliver: true, settings: settings)

    settings.notificationSound = .hero
    await presenter.present(request, shouldDeliver: false, settings: settings)

    #expect(recorder.outputs == [.system(request), .sound(.glass)])
  }
}

@MainActor
private final class NotificationOutputRecorder {
  enum Output: Equatable {
    case sound(NotificationSound)
    case system(DesktopNotificationRequest)
  }

  var outputs: [Output] = []
}
