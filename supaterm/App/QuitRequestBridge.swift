import AppKit

@MainActor
final class QuitRequestBridge {
  static let shared = QuitRequestBridge()

  var onQuitRequested: ((ObjectIdentifier) -> Void)?

  private init() {}

  func requestQuit(for window: NSWindow) {
    onQuitRequested?(ObjectIdentifier(window))
  }
}
