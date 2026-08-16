import ComposableArchitecture
import Foundation
import SupatermUpdateFeature

struct TerminalCommandPaletteClient: Sendable {
  var snapshot: @MainActor @Sendable (ObjectIdentifier?) -> TerminalCommandPaletteSnapshot
  var focusPane: @MainActor @Sendable (TerminalCommandPaletteFocusTarget) async -> Void
  var performUpdateAction: @MainActor @Sendable (ObjectIdentifier?, UpdateUserAction) async -> Void
}

extension TerminalCommandPaletteClient: DependencyKey {
  static let liveValue = Self(
    snapshot: { _ in .empty },
    focusPane: { _ in },
    performUpdateAction: { _, _ in }
  )

  static let testValue = Self(
    snapshot: unimplemented("TerminalCommandPaletteClient.snapshot", placeholder: .empty),
    focusPane: unimplemented("TerminalCommandPaletteClient.focusPane"),
    performUpdateAction: unimplemented("TerminalCommandPaletteClient.performUpdateAction")
  )
}

extension DependencyValues {
  var terminalCommandPaletteClient: TerminalCommandPaletteClient {
    get { self[TerminalCommandPaletteClient.self] }
    set { self[TerminalCommandPaletteClient.self] = newValue }
  }
}
