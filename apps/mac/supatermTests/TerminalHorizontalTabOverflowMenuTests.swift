import AppKit
import Testing

@testable import supaterm

@MainActor
struct TerminalHorizontalTabOverflowMenuTests {
  @Test
  func partialGroupOverflowKeepsItsHierarchy() throws {
    let fixture = try Fixture()
    let model = TerminalHorizontalTabOverflowModel(
      snapshot: fixture.snapshot,
      hiddenEntryIDs: [.tab(fixture.secondGroupTabID)],
      presentations: [:]
    )
    let group = try #require(model.items.first)

    guard case .group(let group) = group else {
      Issue.record("Expected a group overflow item")
      return
    }
    #expect(group.id == fixture.groupID)
    #expect(group.headerIsHidden == false)
    #expect(group.tabs.map(\.id) == [fixture.secondGroupTabID])
  }

  @Test
  func hiddenCollapsedGroupOffersExpansionAndAllChildren() throws {
    let fixture = try Fixture(collapsed: true)
    let model = TerminalHorizontalTabOverflowModel(
      snapshot: fixture.snapshot,
      hiddenEntryIDs: [.group(fixture.groupID)],
      presentations: [:]
    )
    let menu = TerminalHorizontalTabOverflowMenu.make(
      model: model,
      selectTab: { _ in },
      toggleGroup: { _ in }
    )
    let groupItem = try #require(menu.item(withTitle: "Work"))

    #expect(groupItem.submenu?.items.map(\.title) == ["Expand Group", "", "First", "Second"])
  }

  @Test
  func menuPreservesPinnedSectionAndSelectedState() throws {
    let fixture = try Fixture()
    let model = TerminalHorizontalTabOverflowModel(
      snapshot: fixture.snapshot,
      hiddenEntryIDs: [
        .tab(fixture.pinnedTabID),
        .tab(fixture.trailingTabID),
      ],
      presentations: [:]
    )
    let menu = TerminalHorizontalTabOverflowMenu.make(
      model: model,
      selectTab: { _ in },
      toggleGroup: { _ in }
    )

    #expect(menu.items.map(\.title) == ["Pinned", "", "Trailing"])
    #expect(menu.item(withTitle: "Trailing")?.state == .on)
  }

  @Test
  func secondarySelectionUsesTheMixedMenuState() throws {
    let fixture = try Fixture()
    fixture.selectionState.toggle(
      fixture.secondGroupTabID,
      primaryTabID: fixture.trailingTabID
    )
    let model = TerminalHorizontalTabOverflowModel(
      snapshot: fixture.snapshot,
      hiddenEntryIDs: [
        .tab(fixture.secondGroupTabID),
        .tab(fixture.trailingTabID),
      ],
      presentations: [:],
      selectionState: fixture.selectionState
    )
    let menu = TerminalHorizontalTabOverflowMenu.make(
      model: model,
      selectTab: { _ in },
      toggleGroup: { _ in }
    )
    let groupMenu = try #require(menu.item(withTitle: "Work")?.submenu)

    #expect(groupMenu.item(withTitle: "Second")?.state == .mixed)
    #expect(menu.item(withTitle: "Trailing")?.state == .on)
  }

  @Test
  func retainedOverflowActionsSelectTabsAndToggleGroups() throws {
    let fixture = try Fixture(collapsed: true)
    let model = TerminalHorizontalTabOverflowModel(
      snapshot: fixture.snapshot,
      hiddenEntryIDs: [
        .group(fixture.groupID),
        .tab(fixture.trailingTabID),
      ],
      presentations: [:]
    )
    var selected: TerminalTabID?
    var toggled: TerminalTabGroupID?
    let menu = TerminalHorizontalTabOverflowMenu.make(
      model: model,
      selectTab: { selected = $0 },
      toggleGroup: { toggled = $0 }
    )
    let groupMenu = try #require(menu.item(withTitle: "Work")?.submenu)

    #expect(try perform(groupMenu, title: "Expand Group"))
    #expect(toggled == fixture.groupID)
    #expect(try perform(groupMenu, title: "Second"))
    #expect(selected == fixture.secondGroupTabID)
  }

  private func perform(_ menu: NSMenu, title: String) throws -> Bool {
    let item = try #require(menu.item(withTitle: title))
    return NSApplication.shared.sendAction(
      try #require(item.action),
      to: item.target,
      from: item
    )
  }

  private struct Fixture {
    let pinnedTabID: TerminalTabID
    let secondGroupTabID: TerminalTabID
    let trailingTabID: TerminalTabID
    let groupID: TerminalTabGroupID
    let snapshot: TerminalTabSurfaceSnapshot
    let selectionState: TerminalTabSelectionState

    init(collapsed: Bool = false) throws {
      let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
      let collection = terminal.spaceManager.tabCollection
      let pinnedTabID = collection.createTab(title: "Pinned")
      terminal.togglePinned(pinnedTabID)
      let firstGroupTabID = collection.createTab(title: "First")
      let secondGroupTabID = collection.createTab(title: "Second")
      let groupID = try #require(
        terminal.createGroup(
          title: "Work",
          containing: [firstGroupTabID, secondGroupTabID]
        )
      ).groupID
      let trailingTabID = collection.createTab(title: "Trailing")
      terminal.selectTab(trailingTabID)
      if collapsed {
        _ = terminal.toggleGroupCollapsed(groupID)
      }
      self.pinnedTabID = pinnedTabID
      self.secondGroupTabID = secondGroupTabID
      self.trailingTabID = trailingTabID
      self.groupID = groupID
      snapshot = terminal.spaceManager.displayedInstance.tabSurfaceSnapshot
      selectionState = terminal.spaceManager.displayedInstance.tabSelectionState
    }
  }
}
