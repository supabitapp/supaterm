import AppKit

struct TerminalTabSelectionPress: Equatable {
  let selectedTabIDs: [TerminalTabID]
  let defersSelection: Bool

  static let empty = Self(selectedTabIDs: [], defersSelection: false)
}

@MainActor
struct TerminalTabSelectionContext {
  let primaryTabID: TerminalTabID?
  let visibleTabIDs: [TerminalTabID]
  let state: TerminalTabSelectionState
}

@MainActor
enum TerminalTabSelectionInteraction {
  static func press(
    tabID: TerminalTabID,
    modifiers: NSEvent.ModifierFlags,
    context: TerminalTabSelectionContext,
    selectPrimary: (TerminalTabID) -> Void
  ) -> TerminalTabSelectionPress {
    let selectedTabIDs = context.state.orderedTabIDs(
      primaryTabID: context.primaryTabID,
      visibleTabIDs: context.visibleTabIDs
    )
    if modifiers.isDisjoint(with: [.command, .shift]),
      selectedTabIDs.count > 1,
      selectedTabIDs.contains(tabID)
    {
      return TerminalTabSelectionPress(
        selectedTabIDs: selectedTabIDs,
        defersSelection: true
      )
    }
    select(
      tabID: tabID,
      modifiers: modifiers,
      context: context,
      selectPrimary: selectPrimary
    )
    let resolvedTabIDs =
      modifiers.isDisjoint(with: [.command, .shift])
      ? [tabID]
      : context.state.contextualTabIDs(
        for: tabID,
        primaryTabID: context.primaryTabID,
        visibleTabIDs: context.visibleTabIDs
      )
    return TerminalTabSelectionPress(
      selectedTabIDs: resolvedTabIDs,
      defersSelection: false
    )
  }

  static func select(
    tabID: TerminalTabID,
    modifiers: NSEvent.ModifierFlags,
    context: TerminalTabSelectionContext,
    selectPrimary: (TerminalTabID) -> Void
  ) {
    let modifiers = modifiers.intersection([.command, .shift])
    guard !modifiers.isEmpty, let primaryTabID = context.primaryTabID else {
      context.state.clear()
      selectPrimary(tabID)
      return
    }
    if modifiers.contains(.shift) {
      context.state.selectRange(
        to: tabID,
        primaryTabID: primaryTabID,
        visibleTabIDs: context.visibleTabIDs,
        additive: modifiers.contains(.command)
      )
    } else {
      context.state.toggle(tabID, primaryTabID: primaryTabID)
    }
  }

  static func resolveDeferred(
    tabID: TerminalTabID,
    selectionState: TerminalTabSelectionState,
    selectPrimary: (TerminalTabID) -> Void
  ) {
    selectionState.clear()
    selectPrimary(tabID)
  }
}
