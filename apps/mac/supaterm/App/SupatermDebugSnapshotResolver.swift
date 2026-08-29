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
      return Resolution(currentTarget: nil, problems: [])
    }

    for window in windows {
      for space in window.spaces {
        for (tabOffset, tab) in space.flattenedTabs.enumerated() {
          guard let pane = tab.panes.first(where: { $0.id == context.surfaceID }) else { continue }
          return Resolution(
            currentTarget: SupatermAppDebugSnapshot.CurrentTarget(
              windowIndex: window.index,
              spaceIndex: space.index,
              spaceID: space.id,
              spaceName: space.name,
              tabIndex: tabOffset + 1,
              tabID: tab.id,
              tabTitle: tab.title,
              paneIndex: pane.index,
              paneID: pane.id
            ),
            problems: []
          )
        }
      }
    }

    return Resolution(
      currentTarget: nil,
      problems: ["Context pane \(context.surfaceID.uuidString) was not found."]
    )
  }
}
