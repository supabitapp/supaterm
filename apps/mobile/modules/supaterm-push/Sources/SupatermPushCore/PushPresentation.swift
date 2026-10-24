import Foundation

public struct PushPresentation: Equatable {
  public let title: String
  public let subtitle: String
  public let body: String
  public let threadIdentifier: String?
  /// Written to `userInfo["body"]`, which expo-notifications surfaces as `content.data` for remote pushes.
  public let route: [String: String]?

  public static let fallback = PushPresentation(
    title: pushFallbackTitle, subtitle: "", body: "New activity", threadIdentifier: nil, route: nil
  )
  public static let challenge = PushPresentation(
    title: pushFallbackTitle, subtitle: "", body: "Open Supaterm to finish notification setup",
    threadIdentifier: nil, route: nil
  )
}

public enum PushPresenter {
  static let maxEnvelopeBytes = 4096

  public static func present(
    userInfo: [AnyHashable: Any],
    store: PushRecipientStore?,
    ledger: PushReplayLedger?,
    hideContent: Bool,
    now: Int64
  ) -> PushPresentation {
    if userInfo["supatermChallenge"] != nil { return .challenge }
    guard let store, let ledger, let raw = userInfo["supaterm"],
          JSONSerialization.isValidJSONObject(raw),
          let data = try? JSONSerialization.data(withJSONObject: raw),
          data.count <= maxEnvelopeBytes,
          let envelope = try? JSONDecoder().decode(PushEnvelope.self, from: data),
          let content = try? store.decrypt(envelope, now: now, ledger: ledger)
    else { return .fallback }
    return render(content, hideContent: hideContent)
  }

  public static func render(_ content: PushContent, hideContent: Bool) -> PushPresentation {
    let route = [
      "environmentId": content.environmentId,
      "threadId": content.threadId,
      "kind": content.kind.rawValue,
    ]
    let threadIdentifier = "\(content.environmentId):\(content.threadId)"
    if hideContent {
      return PushPresentation(
        title: pushFallbackTitle, subtitle: "", body: content.kind.label,
        threadIdentifier: threadIdentifier, route: route
      )
    }
    return PushPresentation(
      title: content.title, subtitle: content.subtitle ?? "", body: content.body,
      threadIdentifier: threadIdentifier, route: route
    )
  }
}
