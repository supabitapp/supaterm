import AppKit
import ComposableArchitecture

public struct ClipboardClient: Sendable {
  public var copyString: @MainActor @Sendable (String) -> Void

  public init(copyString: @escaping @MainActor @Sendable (String) -> Void) {
    self.copyString = copyString
  }
}

extension ClipboardClient: DependencyKey {
  public static let liveValue = Self(
    copyString: { value in
      let pasteboard = NSPasteboard.general
      pasteboard.clearContents()
      pasteboard.setString(value, forType: .string)
    }
  )

  public static let testValue = Self(
    copyString: unimplemented("ClipboardClient.copyString")
  )
}

extension DependencyValues {
  public var clipboardClient: ClipboardClient {
    get { self[ClipboardClient.self] }
    set { self[ClipboardClient.self] = newValue }
  }
}
