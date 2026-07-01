import SwiftUI

struct SnapshotCatalogRootView: View {
  @State private var query = ""
  @State private var selectedAppearance = SnapshotAppearance.light
  @State private var selectedScenarioID = SnapshotCatalog.scenarios.first?.id

  private var filteredScenarios: [SnapshotScenario] {
    SnapshotCatalog.filteredScenarios(query: query)
  }

  private var selectedScenario: SnapshotScenario {
    filteredScenarios.first { $0.id == selectedScenarioID }
      ?? filteredScenarios.first
      ?? SnapshotCatalog.scenarios[0]
  }

  private var selectedScenarios: [SnapshotScenario] {
    let selectedScenario = selectedScenario
    let scenarios = filteredScenarios.filter { $0.group == selectedScenario.group }
    return scenarios.isEmpty ? [selectedScenario] : scenarios
  }

  var body: some View {
    NavigationSplitView {
      SnapshotCatalogSidebar(
        query: $query,
        selectedScenarioID: $selectedScenarioID,
        scenarios: filteredScenarios
      )
    } detail: {
      SnapshotCatalogDetail(
        appearance: $selectedAppearance,
        selectedScenario: selectedScenario,
        scenarios: selectedScenarios
      )
    }
    .navigationSplitViewStyle(.balanced)
    .frame(minWidth: 960, minHeight: 680)
  }
}

private struct SnapshotCatalogSidebar: View {
  @Binding var query: String
  @Binding var selectedScenarioID: String?
  let scenarios: [SnapshotScenario]

  private var groups: [(String, [SnapshotScenario])] {
    SnapshotCatalog.groupedScenarios(scenarios)
  }

  var body: some View {
    VStack(spacing: 0) {
      TextField("Search", text: $query)
        .textFieldStyle(.roundedBorder)
        .padding(12)

      List(selection: $selectedScenarioID) {
        ForEach(groups, id: \.0) { group, scenarios in
          Section(group) {
            ForEach(scenarios) { scenario in
              Text(scenario.title)
                .lineLimit(1)
                .tag(Optional(scenario.id))
            }
          }
        }
      }
      .listStyle(.sidebar)
    }
    .frame(minWidth: 280, idealWidth: 320)
  }
}

private struct SnapshotCatalogDetail: View {
  @Binding var appearance: SnapshotAppearance
  let selectedScenario: SnapshotScenario
  let scenarios: [SnapshotScenario]

  private var maxScenarioWidth: CGFloat {
    scenarios.map(\.size.width).max() ?? selectedScenario.size.width
  }

  private var countTitle: String {
    scenarios.count == 1 ? "1 snapshot" : "\(scenarios.count) snapshots"
  }

  private var availableAppearances: [SnapshotAppearance] {
    SnapshotAppearance.allCases.filter { appearance in
      scenarios.contains { scenario in
        scenario.appearances.contains(appearance)
      }
    }
  }

  private var compactScenarioColumns: [[SnapshotScenario]] {
    scenarios.enumerated().reduce(into: Array(repeating: [SnapshotScenario](), count: 2)) { columns, element in
      columns[element.offset % columns.count].append(element.element)
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(countTitle)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.secondary)
          Text(selectedScenario.group)
            .font(.system(size: 18, weight: .semibold))
        }
        Spacer()
        Picker("Appearance", selection: $appearance) {
          ForEach(availableAppearances) { appearance in
            Text(appearance.title).tag(appearance)
          }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(width: 132)
      }
      .padding(16)

      Divider()

      ScrollView {
        previewGrid
          .padding(32)
          .frame(maxWidth: .infinity, alignment: .top)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(nsColor: .windowBackgroundColor))
    }
  }

  @ViewBuilder
  private var previewGrid: some View {
    if maxScenarioWidth <= 420 {
      HStack(alignment: .top, spacing: 24) {
        ForEach(compactScenarioColumns.indices, id: \.self) { columnIndex in
          VStack(alignment: .leading, spacing: 24) {
            ForEach(compactScenarioColumns[columnIndex]) { scenario in
              SnapshotCatalogPreviewCard(
                appearance: appearance,
                scenario: scenario
              )
            }
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .center)
    } else {
      VStack(alignment: .leading, spacing: 24) {
        ForEach(scenarios) { scenario in
          SnapshotCatalogPreviewCard(
            appearance: appearance,
            scenario: scenario
          )
        }
      }
      .frame(maxWidth: .infinity, alignment: .center)
    }
  }
}

private struct SnapshotCatalogPreviewCard: View {
  let appearance: SnapshotAppearance
  let scenario: SnapshotScenario

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(scenario.title)
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.secondary)
        .lineLimit(1)

      SnapshotCatalogPreviewSurface(
        appearance: appearance,
        scenario: scenario
      )
    }
  }
}

struct SnapshotCatalogPreviewSurface: View {
  let appearance: SnapshotAppearance
  let scenario: SnapshotScenario

  var body: some View {
    SnapshotCatalogScenarioRender(
      appearance: appearance,
      scenario: scenario
    )
    .clipShape(.rect(cornerRadius: 10))
    .overlay {
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .stroke(Color(nsColor: .separatorColor), lineWidth: 0.5)
    }
    .shadow(color: .black.opacity(0.08), radius: 18, y: 10)
  }
}
