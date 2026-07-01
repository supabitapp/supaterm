import Inject
import SwiftUI

struct SnapshotCatalogRootView: View {
  @ObserveInjection var inject
  @State private var query = ""
  @State private var selectedAppearance = SnapshotAppearance.light
  @State private var selectedGroupID = SnapshotCatalog.scenarios.first?.group

  private var filteredScenarios: [SnapshotScenario] {
    SnapshotCatalog.filteredScenarios(query: query)
  }

  private var filteredGroups: [SnapshotScenarioGroup] {
    SnapshotCatalog.groupedScenarios(filteredScenarios)
  }

  private var selectedGroup: SnapshotScenarioGroup {
    filteredGroups.first { $0.id == selectedGroupID }
      ?? filteredGroups.first
      ?? SnapshotCatalog.groupedScenarios(SnapshotCatalog.scenarios)[0]
  }

  var body: some View {
    NavigationSplitView(columnVisibility: .constant(.all)) {
      SnapshotCatalogSidebar(
        query: $query,
        selectedGroupID: $selectedGroupID,
        groups: filteredGroups
      )
    } detail: {
      SnapshotCatalogDetail(
        appearance: $selectedAppearance,
        group: selectedGroup
      )
    }
    .navigationSplitViewStyle(.balanced)
    .frame(minWidth: 960, minHeight: 680)
    .enableInjection()
  }
}

private struct SnapshotCatalogSidebar: View {
  @Binding var query: String
  @Binding var selectedGroupID: String?
  let groups: [SnapshotScenarioGroup]

  var body: some View {
    VStack(spacing: 0) {
      TextField("Search", text: $query)
        .textFieldStyle(.roundedBorder)
        .padding(12)

      List(selection: $selectedGroupID) {
        ForEach(groups) { group in
          Text(group.title)
            .lineLimit(1)
            .tag(Optional(group.id))
        }
      }
      .listStyle(.sidebar)
    }
    .frame(minWidth: 280, idealWidth: 320)
    .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 360)
    .toolbar(removing: .sidebarToggle)
  }
}

private struct SnapshotCatalogDetail: View {
  @Binding var appearance: SnapshotAppearance
  let group: SnapshotScenarioGroup

  private var scenarios: [SnapshotScenario] {
    group.scenarios
  }

  private var maxScenarioWidth: CGFloat {
    scenarios.map(\.size.width).max() ?? 0
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

  private var compactScenarioColumns: [SnapshotScenarioColumn] {
    let columnScenarios = scenarios.enumerated().reduce(into: Array(repeating: [SnapshotScenario](), count: 2)) {
      columns, element in
      columns[element.offset % columns.count].append(element.element)
    }
    return columnScenarios.enumerated().map { index, scenarios in
      SnapshotScenarioColumn(id: index, scenarios: scenarios)
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(countTitle)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.secondary)
          Text(group.title)
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
        ForEach(compactScenarioColumns) { column in
          VStack(alignment: .leading, spacing: 24) {
            ForEach(column.scenarios) { scenario in
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

private struct SnapshotScenarioColumn: Identifiable {
  let id: Int
  let scenarios: [SnapshotScenario]
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
