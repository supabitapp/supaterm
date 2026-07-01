import SwiftUI

enum SnapshotAppearance: String, CaseIterable, Identifiable {
  case light
  case dark

  var id: String {
    rawValue
  }

  var title: String {
    switch self {
    case .light:
      return "Light"
    case .dark:
      return "Dark"
    }
  }

  var colorScheme: ColorScheme {
    switch self {
    case .light:
      return .light
    case .dark:
      return .dark
    }
  }
}

struct SnapshotScenario: Identifiable {
  let id: String
  let group: String
  let title: String
  let size: CGSize
  let appearances: [SnapshotAppearance]
  let makeView: @MainActor (SnapshotAppearance) -> AnyView

  var snapshotBaseName: String {
    "\(slug(group))-\(slug(id))"
  }

  func snapshotName(appearance: SnapshotAppearance) -> String {
    "\(snapshotBaseName)-\(appearance.rawValue)"
  }

  private func slug(_ value: String) -> String {
    var result = ""
    var previousDash = false

    for scalar in value.lowercased().unicodeScalars {
      if CharacterSet.alphanumerics.contains(scalar) {
        result.unicodeScalars.append(scalar)
        previousDash = false
      } else if !previousDash {
        result.append("-")
        previousDash = true
      }
    }

    return result.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  }
}

struct SnapshotCatalogScenarioRender: View {
  let appearance: SnapshotAppearance
  let scenario: SnapshotScenario

  var body: some View {
    scenario.makeView(appearance)
      .frame(width: scenario.size.width, height: scenario.size.height)
      .environment(\.colorScheme, appearance.colorScheme)
      .transaction { transaction in
        transaction.animation = nil
      }
  }
}

enum SnapshotCatalog {
  static let scenarios: [SnapshotScenario] =
    sidebarScenarios
    + agentPanelScenarios
    + updateScenarios
    + commandPaletteScenarios
    + dialogScenarios
    + settingsScenarios

  static func filteredScenarios(query: String) -> [SnapshotScenario] {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !query.isEmpty else { return scenarios }
    return scenarios.filter { scenario in
      scenario.title.lowercased().contains(query)
        || scenario.group.lowercased().contains(query)
        || scenario.id.lowercased().contains(query)
    }
  }

  static func groupedScenarios(_ scenarios: [SnapshotScenario]) -> [(String, [SnapshotScenario])] {
    let groups = Dictionary(grouping: scenarios, by: \.group)
    let order = Self.scenarios.map(\.group).uniqued()
    return order.compactMap { group in
      guard let scenarios = groups[group], !scenarios.isEmpty else { return nil }
      return (group, scenarios)
    }
  }

  static func scenario(
    _ id: String,
    group: String,
    title: String,
    size: CGSize,
    appearances: [SnapshotAppearance] = SnapshotAppearance.allCases,
    makeView: @escaping @MainActor (SnapshotAppearance) -> AnyView
  ) -> SnapshotScenario {
    SnapshotScenario(
      id: id,
      group: group,
      title: title,
      size: size,
      appearances: appearances,
      makeView: makeView
    )
  }
}

extension Sequence where Element: Hashable {
  fileprivate func uniqued() -> [Element] {
    var seen: Set<Element> = []
    var result: [Element] = []
    for element in self {
      guard seen.insert(element).inserted else { continue }
      result.append(element)
    }
    return result
  }
}
