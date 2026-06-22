import ComposableArchitecture
import Foundation
import SupatermUpdateFeature

public struct TerminalCommandPaletteClient: Sendable {
  public var snapshot: @MainActor @Sendable (ObjectIdentifier?) -> TerminalCommandPaletteSnapshot
  public var focusPane: @MainActor @Sendable (TerminalCommandPaletteFocusTarget) async -> Void
  public var performUpdateAction: @MainActor @Sendable (ObjectIdentifier?, UpdateUserAction) async -> Void

  public init(
    snapshot: @escaping @MainActor @Sendable (ObjectIdentifier?) -> TerminalCommandPaletteSnapshot,
    focusPane: @escaping @MainActor @Sendable (TerminalCommandPaletteFocusTarget) async -> Void,
    performUpdateAction: @escaping @MainActor @Sendable (ObjectIdentifier?, UpdateUserAction) async -> Void
  ) {
    self.snapshot = snapshot
    self.focusPane = focusPane
    self.performUpdateAction = performUpdateAction
  }
}

extension TerminalCommandPaletteClient: DependencyKey {
  public static let liveValue = Self(
    snapshot: { _ in .empty },
    focusPane: { _ in },
    performUpdateAction: { _, _ in }
  )

  public static let testValue = liveValue
}

extension DependencyValues {
  public var terminalCommandPaletteClient: TerminalCommandPaletteClient {
    get { self[TerminalCommandPaletteClient.self] }
    set { self[TerminalCommandPaletteClient.self] = newValue }
  }
}
