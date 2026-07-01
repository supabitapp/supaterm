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
        scenario: selectedScenario
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
  let scenario: SnapshotScenario

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(scenario.group)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.secondary)
          Text(scenario.title)
            .font(.system(size: 18, weight: .semibold))
        }
        Spacer()
        Picker("Appearance", selection: $appearance) {
          ForEach(SnapshotAppearance.allCases) { appearance in
            Text(appearance.title).tag(appearance)
          }
        }
        .pickerStyle(.segmented)
        .frame(width: 180)
      }
      .padding(16)

      Divider()

      ScrollView([.horizontal, .vertical]) {
        SnapshotCatalogPreviewSurface(
          appearance: appearance,
          scenario: scenario
        )
        .padding(32)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Color(nsColor: .windowBackgroundColor))
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
