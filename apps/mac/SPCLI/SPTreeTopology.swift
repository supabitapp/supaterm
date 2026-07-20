import SupatermCLIShared

func tabGroups(in space: SupatermTreeSnapshot.Space) -> [SupatermTreeSnapshot.Group] {
  space.rootItems.compactMap { item in
    guard case .group(let group) = item else { return nil }
    return group
  }
}
