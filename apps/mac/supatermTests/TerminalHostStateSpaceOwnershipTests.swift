import ComposableArchitecture
import CoreGraphics
import Sharing
import SupaTheme
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateSpaceOwnershipTests {
  @Test
  func hostSeesEveryCatalogSpaceAndDisplaysTheRequestedOne() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[1].id, spaces: spaces)
      }

      let host = TerminalHostState(managesTerminalSurfaces: false, spaceID: spaces[0].id)

      #expect(host.spaces == spaces)
      #expect(host.displayedSpaceID == spaces[0].id)

      $catalog.withLock {
        $0.spaces[0].name = "Renamed"
      }
      for _ in 0..<5 {
        await Task.yield()
      }

      #expect(host.spaces.map(\.name) == ["Renamed", "B"])
      #expect(host.displayedSpaceID == spaces[0].id)
    }
  }

  @Test
  func hostAdoptsThePersistedSpaceColor() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let space = TerminalSpaceItem(name: "A", color: .green)
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
      }

      let host = TerminalHostState(managesTerminalSurfaces: false, spaceID: space.id)

      #expect(host.spaceManager.displayedSpace.color == .green)
    }
  }

  @Test
  func displayingASpaceSwitchesInPlaceAndRemembersTheLastOne() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }

      let host = TerminalHostState(managesTerminalSurfaces: false, spaceID: spaces[0].id)

      #expect(host.displaySpace(spaces[1].id))
      #expect(host.displayedSpaceID == spaces[1].id)
      #expect(host.spaceManager.lastDisplayedSpaceID == spaces[0].id)
      #expect(!host.displaySpace(TerminalSpaceID()))
    }
  }

  @Test
  func switchingCommitsBeforeItHandsTheSlideToTheMountedPager() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [
        TerminalSpaceItem(name: "A"),
        TerminalSpaceItem(name: "B"),
        TerminalSpaceItem(name: "C"),
      ]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }

      let host = TerminalHostState(managesTerminalSurfaces: false, spaceID: spaces[0].id)
      let pager = SpaceSwipeController()
      var slides: [[Int]] = []
      var displayedSpaceIDsAtSlide: [TerminalSpaceID] = []
      pager.slide = { origin, destination in
        slides.append([origin, destination])
        displayedSpaceIDsAtSlide.append(host.displayedSpaceID)
      }
      host.spacePager = pager

      #expect(host.switchSpace(to: spaces[2].id))
      #expect(host.displayedSpaceID == spaces[2].id)
      #expect(host.displayedSpaceIndex == 2)
      #expect(slides == [[0, 2]])
      #expect(displayedSpaceIDsAtSlide == [spaces[2].id])

      #expect(host.switchSpace(to: spaces[2].id))
      #expect(slides == [[0, 2]])
      #expect(host.displayedSpaceID == spaces[2].id)

      host.spacePager = nil
      #expect(host.switchSpace(to: spaces[1].id))
      #expect(host.displayedSpaceID == spaces[1].id)
      #expect(host.displayedSpaceIndex == 1)
      #expect(!host.switchSpace(to: TerminalSpaceID()))
    }
  }

  @Test
  func spaceCommandsLeaveOwnershipToTheWindowRegistry() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let otherSpaceID = TerminalSpaceID()
      var actions: [TerminalHostState.SpaceAction] = []
      host.onSpaceAction = { actions.append($0) }

      host.handleCommand(.createSpace(name: "Build", color: .blue))
      host.handleCommand(.selectSpace(otherSpaceID))
      host.handleCommand(.renameSpace(otherSpaceID, "Shell"))
      host.handleCommand(.nextSpace)
      host.handleCommand(.previousSpace)
      host.handleCommand(.setSpaceColor(otherSpaceID, .purple))
      host.handleCommand(.deleteSpace(otherSpaceID))

      #expect(
        actions == [
          .create("Build", .blue),
          .select(otherSpaceID),
          .rename(otherSpaceID, "Shell"),
          .next,
          .previous,
          .setColor(otherSpaceID, .purple),
          .delete(otherSpaceID),
        ]
      )
      #expect(host.displayedSpaceID != otherSpaceID)
    }
  }
}
