import Foundation
import SupatermCLIShared

func e2eRootTab(
  withID tabID: UUID,
  in space: SupatermAppDebugSnapshot.Space
) -> SupatermAppDebugSnapshot.RootTab? {
  space.rootItems.lazy.compactMap { item in
    guard case .tab(let rootTab) = item, rootTab.tab.id == tabID else { return nil }
    return rootTab
  }.first
}
