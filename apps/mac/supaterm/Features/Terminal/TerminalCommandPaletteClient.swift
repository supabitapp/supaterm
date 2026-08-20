import ComposableArchitecture
import Foundation
import SupatermUpdateFeature

struct TerminalCommandPaletteClient: Sendable {
  var snapshot: @MainActor @Sendable (ObjectIdentifier?) -> TerminalCommandPaletteSnapshot
  var focusPane: @MainActor @Sendable (TerminalCommandPaletteFocusTarget) async -> Void
  var performAppAction: @MainActor @Sendable (ObjectIdentifier?, TerminalCommandPaletteAppAction) async -> Void
  var performUpdateAction: @MainActor @Sendable (ObjectIdentifier?, UpdateUserAction) async -> Void
}

extension TerminalCommandPaletteClient: DependencyKey {
  static let liveValue = unimplementedValue()

  static let testValue = unimplementedValue()

  private static func unimplementedValue() -> Self {
    Self(
      snapshot: unimplemented("TerminalCommandPaletteClient.snapshot", placeholder: .empty),
      focusPane: unimplemented("TerminalCommandPaletteClient.focusPane"),
      performAppAction: unimplemented("TerminalCommandPaletteClient.performAppAction"),
      performUpdateAction: unimplemented("TerminalCommandPaletteClient.performUpdateAction")
    )
  }
}

extension DependencyValues {
  var terminalCommandPaletteClient: TerminalCommandPaletteClient {
    get { self[TerminalCommandPaletteClient.self] }
    set { self[TerminalCommandPaletteClient.self] = newValue }
  }
}
