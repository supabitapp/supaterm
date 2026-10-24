import Foundation
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
  private let lock = NSLock()
  private var handler: ((UNNotificationContent) -> Void)?
  private var fallback: UNNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    let placeholder = request.content.userInfo["supatermChallenge"] == nil ? PushPresentation.fallback : .challenge
    lock.lock()
    handler = contentHandler
    fallback = apply(placeholder, to: content)
    lock.unlock()

    let configuration = PushConfiguration.main
    let presentation = PushPresenter.present(
      userInfo: request.content.userInfo,
      store: configuration?.recipients,
      ledger: configuration?.ledger,
      hideContent: configuration?.preferences?.hideContent ?? false,
      now: Int64(Date().timeIntervalSince1970 * 1000)
    )
    finish(apply(presentation, to: content))
  }

  override func serviceExtensionTimeWillExpire() {
    lock.lock()
    let content = fallback
    lock.unlock()
    if let content { finish(content) }
  }

  private func apply(_ presentation: PushPresentation, to base: UNMutableNotificationContent) -> UNNotificationContent {
    guard let content = base.mutableCopy() as? UNMutableNotificationContent else { return base }
    content.title = presentation.title
    content.subtitle = presentation.subtitle
    content.body = presentation.body
    var userInfo = content.userInfo
    userInfo.removeValue(forKey: "supaterm")
    if let threadIdentifier = presentation.threadIdentifier { content.threadIdentifier = threadIdentifier }
    if let route = presentation.route { userInfo["body"] = route }
    content.userInfo = userInfo
    return content
  }

  private func finish(_ content: UNNotificationContent) {
    lock.lock()
    let completion = handler
    handler = nil
    fallback = nil
    lock.unlock()
    completion?(content)
  }
}
