import AppKit
import SupatermCLIShared
import Testing

@testable import SupatermSupport

@MainActor
struct NotificationOutputClientTests {
  @Test
  func bundledSoundLoadsFromSupportResources() throws {
    guard
      case .bundled(let resource, let fileExtension)? = NotificationSound.supatermClassic.source
    else {
      Issue.record("Expected bundled notification sound")
      return
    }
    let url = try #require(
      SupatermSupportResources.bundle.url(
        forResource: resource,
        withExtension: fileExtension
      )
    )

    #expect(NSSound(contentsOf: url, byReference: true) != nil)
  }

  @Test
  func systemSoundNameDoesNotDependOnDisplayTitle() {
    #expect(NotificationSound.glass.source == .system(name: "Glass"))
  }

  @Test
  func settingsSelectOneOutput() {
    var settings = SupatermSettings.default

    #expect(settings.notificationOutput == .none)

    settings.notificationSound = .glass
    #expect(settings.notificationOutput == .sound(.glass))

    settings.systemNotificationsEnabled = true
    #expect(settings.notificationOutput == .system)
  }

  @Test
  func deliversOnlyTheSelectedOutputWhenAllowed() async {
    let recorder = NotificationOutputRecorder()
    var desktopNotificationClient = DesktopNotificationClient.testValue
    desktopNotificationClient.deliver = { recorder.outputs.append(.system($0)) }
    var notificationSoundClient = NotificationSoundClient.testValue
    notificationSoundClient.play = { recorder.outputs.append(.sound($0)) }
    let client = NotificationOutputClient(
      desktopNotificationClient: desktopNotificationClient,
      notificationSoundClient: notificationSoundClient
    )
    let request = NotificationRequest(
      body: "Build finished",
      disposition: .deliver,
      subtitle: "CI",
      title: "Deploy complete"
    )
    let suppressedRequest = NotificationRequest(
      body: request.body,
      disposition: .suppressFocused,
      subtitle: request.subtitle,
      title: request.title
    )

    await client.deliver(request, .system)
    await client.deliver(request, .sound(.glass))
    await client.deliver(request, .none)
    await client.deliver(suppressedRequest, .sound(.hero))

    #expect(recorder.outputs == [.system(request), .sound(.glass)])
  }
}

@MainActor
private final class NotificationOutputRecorder {
  enum Output: Equatable {
    case sound(NotificationSound)
    case system(NotificationRequest)
  }

  var outputs: [Output] = []
}
