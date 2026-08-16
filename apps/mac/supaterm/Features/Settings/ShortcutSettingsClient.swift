import ComposableArchitecture
import Foundation

public nonisolated struct ShortcutSettingsClient: Sendable {
  public var terminalReservedDisplays: @MainActor @Sendable () -> Set<String>
  public var shortcutsDidChange: @MainActor @Sendable () -> Void

  public init(
    terminalReservedDisplays: @escaping @MainActor @Sendable () -> Set<String>,
    shortcutsDidChange: @escaping @MainActor @Sendable () -> Void
  ) {
    self.terminalReservedDisplays = terminalReservedDisplays
    self.shortcutsDidChange = shortcutsDidChange
  }
}

extension ShortcutSettingsClient: DependencyKey {
  public nonisolated static let liveValue = Self(
    terminalReservedDisplays: { [] },
    shortcutsDidChange: {}
  )

  public nonisolated static let testValue = Self(
    terminalReservedDisplays: unimplemented(
      "ShortcutSettingsClient.terminalReservedDisplays",
      placeholder: []
    ),
    shortcutsDidChange: unimplemented("ShortcutSettingsClient.shortcutsDidChange")
  )
}

extension DependencyValues {
  public var shortcutSettingsClient: ShortcutSettingsClient {
    get { self[ShortcutSettingsClient.self] }
    set { self[ShortcutSettingsClient.self] = newValue }
  }
}
