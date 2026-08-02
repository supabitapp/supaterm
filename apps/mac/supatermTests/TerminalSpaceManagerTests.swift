import Foundation
import SupaTheme
import Testing

@testable import supaterm

@MainActor
struct TerminalSpaceManagerTests {
  private func makeCatalog(_ spaces: [TerminalSpaceItem]) -> TerminalSpaceCatalog {
    TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
  }

  @Test
  func displaysTheRequestedSpaceAndWarmsInstancesOnDemand() {
    let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
    let manager = TerminalSpaceManager(
      catalog: makeCatalog(spaces),
      displayedSpaceID: spaces[0].id
    )

    #expect(manager.spaces == spaces)
    #expect(manager.displayedSpaceID == spaces[0].id)
    #expect(manager.lastDisplayedSpaceID == nil)
    #expect(manager.instance(for: spaces[1].id) == nil)

    #expect(manager.display(spaces[1].id))

    #expect(manager.displayedSpaceID == spaces[1].id)
    #expect(manager.lastDisplayedSpaceID == spaces[0].id)
    #expect(manager.instances.count == 2)
  }

  @Test
  func hiddenInstancesKeepTheirOwnTabs() throws {
    let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
    let manager = TerminalSpaceManager(
      catalog: makeCatalog(spaces),
      displayedSpaceID: spaces[0].id
    )
    let firstTabID = try #require(manager.tabManager.createTab(title: "Terminal 1"))
    manager.display(spaces[1].id)
    let secondTabID = try #require(manager.tabManager.createTab(title: "Terminal 2"))

    #expect(manager.tabs.map(\.id) == [secondTabID])
    #expect(manager.tabs(in: spaces[0].id).map(\.id) == [firstTabID])
    #expect(manager.allTabs.count == 2)
    #expect(manager.space(for: firstTabID)?.id == spaces[0].id)
  }

  @Test
  func refusesSpacesOutsideTheCatalog() {
    let space = TerminalSpaceItem(name: "A")
    let manager = TerminalSpaceManager(catalog: makeCatalog([space]), displayedSpaceID: space.id)
    let otherSpaceID = TerminalSpaceID()

    #expect(!manager.display(otherSpaceID))
    #expect(manager.tabManager(for: otherSpaceID) == nil)
    #expect(manager.tabs(in: otherSpaceID).isEmpty)
    #expect(manager.spaceIndex(for: space.id) == 1)
  }

  @Test
  func catalogUpdatesRenameWithoutChangingTabs() throws {
    let space = TerminalSpaceItem(name: "A")
    let manager = TerminalSpaceManager(catalog: makeCatalog([space]), displayedSpaceID: space.id)
    let tabID = try #require(manager.tabManager.createTab(title: "Terminal 1"))

    manager.applyCatalog(
      TerminalSpaceCatalog(
        defaultSelectedSpaceID: space.id,
        spaces: [TerminalSpaceItem(id: space.id, name: "Renamed", color: .blue)]
      )
    )

    #expect(manager.spaces.map(\.name) == ["Renamed"])
    #expect(manager.displayedSpace.color == .blue)
    #expect(manager.displayedSpaceID == space.id)
    #expect(manager.tabs.map(\.id) == [tabID])
  }

  @Test
  func deletedSpaceDiscardsItsInstanceAndDisplaysTheNeighbor() {
    let spaces = [
      TerminalSpaceItem(name: "A"),
      TerminalSpaceItem(name: "B"),
      TerminalSpaceItem(name: "C"),
    ]
    let manager = TerminalSpaceManager(
      catalog: makeCatalog(spaces),
      displayedSpaceID: spaces[1].id
    )
    manager.tabManager.createTab(title: "Terminal 1")

    let discarded = manager.applyCatalog(
      TerminalSpaceCatalog(
        defaultSelectedSpaceID: spaces[0].id,
        spaces: [spaces[0], spaces[2]]
      )
    )

    #expect(discarded.map(\.spaceID) == [spaces[1].id])
    #expect(manager.displayedSpaceID == spaces[0].id)
    #expect(manager.instance(for: spaces[1].id) == nil)
    #expect(manager.tabs.isEmpty)
  }
}
