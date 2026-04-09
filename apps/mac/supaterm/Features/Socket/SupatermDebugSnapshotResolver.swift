import Foundation
import SupatermCLIShared

enum SupatermDebugSnapshotResolver {
  struct Resolution: Equatable {
    let currentTarget: SupatermAppDebugSnapshot.CurrentTarget?
    let problems: [String]
  }

  static func resolve(
    windows: [SupatermAppDebugSnapshot.Window],
    context: SupatermCLIContext?
  ) -> Resolution {
    guard let context else {
      return .init(currentTarget: nil, problems: [])
    }

    for window in windows {
      for space in window.spaces {
        for tab in space.tabs {
          guard let pane = tab.panes.first(where: { $0.id == context.surfaceID }) else { continue }
          var problems: [String] = []
          if tab.id != context.tabID {
            let problem =
              "Context tab \(context.tabID.uuidString) is stale. "
              + "Pane \(context.surfaceID.uuidString) now belongs to tab \(tab.id.uuidString)."
            problems.append(problem)
          }
          return .init(
            currentTarget: .init(
              windowIndex: window.index,
              spaceIndex: space.index,
              spaceID: space.id,
              spaceName: space.name,
              tabIndex: tab.index,
              tabID: tab.id,
              tabTitle: tab.title,
              paneIndex: pane.index,
              paneID: pane.id
            ),
            problems: problems
          )
        }
      }
    }

    return .init(
      currentTarget: nil,
      problems: ["Context pane \(context.surfaceID.uuidString) was not found."]
    )
  }
}
