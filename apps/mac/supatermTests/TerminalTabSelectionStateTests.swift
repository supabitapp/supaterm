import AppKit
import Testing

@testable import supaterm

@MainActor
struct TerminalTabSelectionStateTests {
  @Test
  func commandTogglesSecondarySelection() {
    let primary = TerminalTabID()
    let secondary = TerminalTabID()
    let visibleTabIDs = [primary, secondary]
    let state = TerminalTabSelectionState()
    var selectedPrimary: TerminalTabID?

    let selected = TerminalTabSelectionInteraction.press(
      tabID: secondary,
      modifiers: .command,
      context: context(primary: primary, visibleTabIDs: visibleTabIDs, state: state),
      selectPrimary: { selectedPrimary = $0 }
    )

    #expect(
      selected == TerminalTabSelectionPress(selectedTabIDs: visibleTabIDs, defersSelection: false))
    #expect(state.secondaryTabIDs == [secondary])
    #expect(selectedPrimary == nil)

    _ = TerminalTabSelectionInteraction.press(
      tabID: secondary,
      modifiers: .command,
      context: context(primary: primary, visibleTabIDs: visibleTabIDs, state: state),
      selectPrimary: { selectedPrimary = $0 }
    )

    #expect(state.secondaryTabIDs.isEmpty)
    #expect(selectedPrimary == nil)
  }

  @Test
  func shiftReplacesAndCommandShiftAddsRanges() {
    let primary = TerminalTabID()
    let first = TerminalTabID()
    let second = TerminalTabID()
    let trailing = TerminalTabID()
    let visibleTabIDs = [primary, first, second, trailing]
    let state = TerminalTabSelectionState()
    state.toggle(trailing, primaryTabID: primary)

    _ = TerminalTabSelectionInteraction.press(
      tabID: second,
      modifiers: .shift,
      context: context(primary: primary, visibleTabIDs: visibleTabIDs, state: state),
      selectPrimary: { _ in }
    )

    #expect(state.secondaryTabIDs == [first, second])

    state.clear()
    state.toggle(trailing, primaryTabID: primary)
    _ = TerminalTabSelectionInteraction.press(
      tabID: second,
      modifiers: [.command, .shift],
      context: context(primary: primary, visibleTabIDs: visibleTabIDs, state: state),
      selectPrimary: { _ in }
    )

    #expect(state.secondaryTabIDs == [first, second, trailing])
  }

  @Test
  func plainPressOnMultiSelectionDefersReplacementUntilRelease() {
    let primary = TerminalTabID()
    let secondary = TerminalTabID()
    let visibleTabIDs = [primary, secondary]
    let state = TerminalTabSelectionState()
    state.toggle(secondary, primaryTabID: primary)
    var selectedPrimary: TerminalTabID?

    let press = TerminalTabSelectionInteraction.press(
      tabID: secondary,
      modifiers: [],
      context: context(primary: primary, visibleTabIDs: visibleTabIDs, state: state),
      selectPrimary: { selectedPrimary = $0 }
    )

    #expect(
      press == TerminalTabSelectionPress(selectedTabIDs: visibleTabIDs, defersSelection: true))
    #expect(state.secondaryTabIDs == [secondary])
    #expect(selectedPrimary == nil)

    TerminalTabSelectionInteraction.resolveDeferred(
      tabID: secondary,
      selectionState: state,
      selectPrimary: { selectedPrimary = $0 }
    )

    #expect(state.secondaryTabIDs.isEmpty)
    #expect(selectedPrimary == secondary)
  }

  @Test
  func ordinaryPrimarySelectionClearsSecondariesOnReselection() {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let collection = terminal.spaceManager.tabCollection
    let primary = collection.createTab(title: "Primary")
    let secondary = collection.createTab(title: "Secondary")
    collection.selectTab(primary)
    let state = terminal.spaceManager.displayedInstance.tabSelectionState
    state.toggle(secondary, primaryTabID: primary)

    terminal.selectTab(primary)

    #expect(terminal.selectedTabID == primary)
    #expect(state.secondaryTabIDs.isEmpty)
  }

  @Test
  func selectionIsOwnedAndRetainedPerSpace() {
    let firstSpace = TerminalSpaceItem(name: "First")
    let secondSpace = TerminalSpaceItem(name: "Second")
    let manager = TerminalSpaceManager(
      catalog: TerminalSpaceCatalog(
        defaultSelectedSpaceID: firstSpace.id,
        spaces: [firstSpace, secondSpace]
      ),
      displayedSpaceID: firstSpace.id
    )
    let firstInstance = manager.displayedInstance
    let secondInstance = manager.instance(warming: secondSpace.id)
    let firstPrimary = firstInstance.tabCollection.createTab(title: "First Primary")
    let firstSecondary = firstInstance.tabCollection.createTab(title: "First Secondary")
    let secondPrimary = secondInstance.tabCollection.createTab(title: "Second Primary")
    let secondSecondary = secondInstance.tabCollection.createTab(title: "Second Secondary")
    firstInstance.tabCollection.selectTab(firstPrimary)
    secondInstance.tabCollection.selectTab(secondPrimary)

    firstInstance.tabSelectionState.toggle(firstSecondary, primaryTabID: firstPrimary)
    secondInstance.tabSelectionState.toggle(secondSecondary, primaryTabID: secondPrimary)
    _ = manager.display(secondSpace.id)
    _ = manager.display(firstSpace.id)

    #expect(firstInstance.tabSelectionState.secondaryTabIDs == [firstSecondary])
    #expect(secondInstance.tabSelectionState.secondaryTabIDs == [secondSecondary])
  }

  private func context(
    primary: TerminalTabID?,
    visibleTabIDs: [TerminalTabID],
    state: TerminalTabSelectionState
  ) -> TerminalTabSelectionContext {
    TerminalTabSelectionContext(
      primaryTabID: primary,
      visibleTabIDs: visibleTabIDs,
      state: state
    )
  }
}
