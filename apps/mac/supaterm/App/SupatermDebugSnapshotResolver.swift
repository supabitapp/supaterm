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
        for tab in space.tabs where tab.id == context.tabID {
          let pane = tab.panes.first { $0.id == context.surfaceID }
          var problems: [String] = []
          if pane == nil {
            problems.append(
              "Context pane \(context.surfaceID.uuidString) was not found in tab \(context.tabID.uuidString).")
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
              paneIndex: pane?.index,
              paneID: pane?.id
            ),
            problems: problems
          )
        }
      }
    }

    return .init(
      currentTarget: nil,
      problems: ["Context tab \(context.tabID.uuidString) was not found."]
    )
  }
}
