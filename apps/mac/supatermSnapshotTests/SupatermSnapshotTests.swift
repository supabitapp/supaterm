import AppKit
import SnapshotTesting
import SwiftUI
import Testing

@testable import supatermSnapshotCatalog

@MainActor
@Suite
struct SupatermSnapshotTests {
  @Test func catalogScenarios() {
    for scenario in SnapshotCatalog.scenarios {
      for appearance in scenario.appearances {
        assertSnapshot(
          of: hostingView(scenario: scenario, appearance: appearance),
          as: .image(
            precision: 0.99,
            perceptualPrecision: 0.99,
            size: scenario.size
          ),
          named: scenario.snapshotName(appearance: appearance)
        )
      }
    }
  }

  private func hostingView(
    scenario: SnapshotScenario,
    appearance: SnapshotAppearance
  ) -> NSHostingView<SnapshotCatalogScenarioRender> {
    let view = NSHostingView(
      rootView: SnapshotCatalogScenarioRender(
        appearance: appearance,
        scenario: scenario
      )
    )
    view.frame = CGRect(origin: .zero, size: scenario.size)
    view.layoutSubtreeIfNeeded()
    view.displayIfNeeded()
    return view
  }
}
