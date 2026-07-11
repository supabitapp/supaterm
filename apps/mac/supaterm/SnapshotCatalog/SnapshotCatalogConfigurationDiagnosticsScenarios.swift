import SwiftUI

extension SnapshotCatalog {
  static let configurationDiagnosticsScenarios: [SnapshotScenario] = [
    scenario(
      "configuration-diagnostics",
      group: "Dialogs",
      title: "Configuration diagnostics",
      size: CGSize(width: 640, height: 400)
    ) { _ in
      AnyView(
        ConfigurationDiagnosticsView(
          messages: [
            "unknown field: window-theme",
            "font-size: invalid value \"large\"",
          ],
          onIgnore: {},
          onReload: {}
        )
        .background(Color(nsColor: .windowBackgroundColor))
      )
    }
  ]
}
