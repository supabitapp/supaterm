import ComposableArchitecture
import SupaTheme

nonisolated enum TerminalSpaceThemeSelection {
  static func randomThemeID(
    usedThemeIDs: [String],
    randomIndex: (Int) -> Int
  ) -> String {
    let curatedThemeIDs = Theme.curated.map(\.id)
    let normalizedUsedThemeIDs = Set(usedThemeIDs.map { Theme.curated(id: $0).id })
    let unusedThemeIDs = curatedThemeIDs.filter { !normalizedUsedThemeIDs.contains($0) }
    let candidates = unusedThemeIDs.isEmpty ? curatedThemeIDs : unusedThemeIDs
    return candidates[randomIndex(candidates.count)]
  }
}

nonisolated struct TerminalSpaceThemeClient: Sendable {
  var randomCreateThemeID: @Sendable ([String]) -> String
}

extension TerminalSpaceThemeClient: DependencyKey {
  static let liveValue = Self { usedThemeIDs in
    TerminalSpaceThemeSelection.randomThemeID(
      usedThemeIDs: usedThemeIDs,
      randomIndex: { Int.random(in: 0..<$0) }
    )
  }

  static let testValue = Self { _ in
    Theme.default.id
  }
}

extension DependencyValues {
  var terminalSpaceThemeClient: TerminalSpaceThemeClient {
    get { self[TerminalSpaceThemeClient.self] }
    set { self[TerminalSpaceThemeClient.self] = newValue }
  }
}
