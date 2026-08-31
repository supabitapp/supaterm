import Observation

@MainActor
@Observable
final class TerminalTabSelectionState {
  private(set) var secondaryTabIDs: Set<TerminalTabID> = []

  func style(
    for tabID: TerminalTabID,
    primaryTabID: TerminalTabID?
  ) -> SelectableRowSelection {
    if tabID == primaryTabID { return .primary }
    return secondaryTabIDs.contains(tabID) ? .secondary : .none
  }

  func orderedTabIDs(
    primaryTabID: TerminalTabID?,
    visibleTabIDs: [TerminalTabID]
  ) -> [TerminalTabID] {
    let selectedTabIDs = secondaryTabIDs.union(primaryTabID.map { [$0] } ?? [])
    return visibleTabIDs.filter(selectedTabIDs.contains)
  }

  func contextualTabIDs(
    for tabID: TerminalTabID,
    primaryTabID: TerminalTabID?,
    visibleTabIDs: [TerminalTabID]
  ) -> [TerminalTabID] {
    guard style(for: tabID, primaryTabID: primaryTabID) != .none else { return [tabID] }
    return orderedTabIDs(primaryTabID: primaryTabID, visibleTabIDs: visibleTabIDs)
  }

  func toggle(_ tabID: TerminalTabID, primaryTabID: TerminalTabID?) {
    guard tabID != primaryTabID else { return }
    if !secondaryTabIDs.insert(tabID).inserted {
      secondaryTabIDs.remove(tabID)
    }
  }

  func selectRange(
    to tabID: TerminalTabID,
    primaryTabID: TerminalTabID?,
    visibleTabIDs: [TerminalTabID],
    additive: Bool
  ) {
    guard let primaryTabID else { return }
    guard
      let primaryIndex = visibleTabIDs.firstIndex(of: primaryTabID),
      let targetIndex = visibleTabIDs.firstIndex(of: tabID)
    else { return }
    let bounds = min(primaryIndex, targetIndex)...max(primaryIndex, targetIndex)
    let range = Set(visibleTabIDs[bounds]).subtracting([primaryTabID])
    if additive {
      secondaryTabIDs.formUnion(range)
    } else {
      secondaryTabIDs = range
    }
  }

  func clear() {
    guard !secondaryTabIDs.isEmpty else { return }
    secondaryTabIDs = []
  }

  func retainVisible(
    in visibleTabIDs: [TerminalTabID],
    primaryTabID: TerminalTabID?
  ) {
    var retained = secondaryTabIDs.intersection(visibleTabIDs)
    if let primaryTabID { retained.remove(primaryTabID) }
    guard retained != secondaryTabIDs else { return }
    secondaryTabIDs = retained
  }
}
