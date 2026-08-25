import Dependencies
import Foundation
import Sharing
import SupatermTerminalCore
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalWindowRegistryProjectTests {
  @Test
  func projectRemovalConfirmsThenClosesTabsAcrossWindowsWithOneSave() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      var closedWindowIDs: Set<UUID> = []
      let first = registerWindow(
        in: registry,
        spaceID: TerminalSpaceID(),
        onClose: { closedWindowIDs.insert($0) }
      )
      let second = registerWindow(
        in: registry,
        spaceID: TerminalSpaceID(),
        onClose: { closedWindowIDs.insert($0) }
      )
      let unaffected = registerWindow(
        in: registry,
        spaceID: TerminalSpaceID(),
        onClose: { closedWindowIDs.insert($0) }
      )
      let firstTabID = first.terminal.spaceManager.tabCollection.createTab(title: "First")
      let secondTabID = second.terminal.spaceManager.tabCollection.createTab(title: "Second")
      let projectID = try #require(
        first.terminal.createProject(name: "Work", containing: [firstTabID])
      ).projectID
      #expect(second.terminal.assignTabs([secondTabID], to: projectID))
      #expect(first.terminal.setProjectCollapsed(projectID, isCollapsed: true))
      #expect(second.terminal.setProjectCollapsed(projectID, isCollapsed: true))
      #expect(unaffected.terminal.setProjectCollapsed(projectID, isCollapsed: true))
      var saveCount = 0
      first.terminal.onSessionChange = { saveCount += 1 }
      second.terminal.onSessionChange = { saveCount += 1 }

      #expect(throws: TerminalControlError.projectCloseConfirmationRequired) {
        try registry.removeProject(projectID, confirmed: false)
      }
      #expect(first.terminal.containsTab(firstTabID.rawValue))
      #expect(second.terminal.containsTab(secondTabID.rawValue))

      let result = try registry.removeProject(projectID, confirmed: true)

      #expect(Set(result.removedTabIDs) == Set([firstTabID.rawValue, secondTabID.rawValue]))
      #expect(!first.terminal.containsProject(projectID))
      #expect(!first.terminal.containsTab(firstTabID.rawValue))
      #expect(!second.terminal.containsTab(secondTabID.rawValue))
      #expect(!first.terminal.isProjectCollapsed(projectID, in: first.terminal.displayedSpaceID))
      #expect(!second.terminal.isProjectCollapsed(projectID, in: second.terminal.displayedSpaceID))
      #expect(
        !unaffected.terminal.isProjectCollapsed(
          projectID,
          in: unaffected.terminal.displayedSpaceID
        )
      )
      #expect(saveCount == 1)
      #expect(closedWindowIDs.count == 2)
      withExtendedLifetime([first.window, second.window, unaffected.window]) {}
    }
  }

  @Test
  func projectRemovalKeepsAWindowWithAnUnrelatedColdTabOpen() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "Warm"), TerminalSpaceItem(name: "Cold")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      var closeCount = 0
      let window = registerWindow(
        in: registry,
        spaceID: spaces[0].id,
        onClose: { _ in closeCount += 1 }
      )
      let projectTabID = window.terminal.spaceManager.tabCollection.createTab(title: "Project")
      let projectID = try #require(
        window.terminal.createProject(name: "Work", containing: [projectTabID])
      ).projectID
      let coldTabID = TerminalTabID()
      window.terminal.spaceManager.registerColdInstance(
        TerminalSpaceSession(
          spaceID: spaces[1].id,
          selectedTabID: coldTabID,
          tabs: [
            TerminalTabSession(
              id: coldTabID,
              lockedTitle: "Cold",
              focusedPaneIndex: 0,
              root: .leaf(
                TerminalPaneLeafSession(id: UUID(), workingDirectoryPath: nil)
              )
            )
          ]
        )
      )

      _ = try registry.removeProject(projectID, confirmed: true)

      #expect(closeCount == 0)
      #expect(window.terminal.containsTab(coldTabID.rawValue))
      withExtendedLifetime(window.window) {}
    }
  }

  @Test
  func unassignedCollapseWorksWithoutProjects() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let window = registerWindow(in: registry, spaceID: TerminalSpaceID())
      let request = SupatermSetProjectCollapsedRequest(
        isCollapsed: true,
        projectID: nil,
        spaceID: window.terminal.displayedSpaceID.rawValue
      )

      let result = try registry.execute(.setCollapsed(request))

      #expect(
        result
          == .collapsed(
            SupatermSetProjectCollapsedResult(
              isCollapsed: true,
              projectID: nil,
              spaceID: request.spaceID
            )))
      #expect(window.terminal.isUnassignedCollapsed(in: window.terminal.displayedSpaceID))
      withExtendedLifetime(window.window) {}
    }
  }

  @Test
  func projectCommandsUseOneRegistryAuthority() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let window = registerWindow(in: registry, spaceID: TerminalSpaceID())
      guard
        case .project(let first) = try registry.execute(
          .add(SupatermAddProjectRequest(name: "First"))
        )
      else {
        Issue.record("Expected first Project")
        return
      }
      _ = try registry.execute(.add(SupatermAddProjectRequest(name: "Second")))
      let target = SupatermProjectTargetRequest(projectID: first.project.id)

      _ = try registry.execute(.unpin(target))
      _ = try registry.execute(.unpin(target))
      _ = try registry.execute(
        .reorder(SupatermReorderProjectRequest(index: 1, target: target))
      )

      #expect(registry.projectCatalog.projects.map(\.name) == ["First", "Second"])
      withExtendedLifetime(window.window) {}
    }
  }

  @Test
  func emptyProjectRemovalIsImmediate() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let window = registerWindow(in: registry, spaceID: TerminalSpaceID())
      guard
        case .project(let created) = try registry.execute(
          .add(SupatermAddProjectRequest(name: "Work"))
        )
      else {
        Issue.record("Expected Project")
        return
      }
      let target = SupatermProjectTargetRequest(projectID: created.project.id)
      #expect(
        window.terminal.setProjectCollapsed(
          TerminalProjectID(rawValue: created.project.id),
          isCollapsed: true
        )
      )

      let result = try registry.execute(
        .remove(SupatermRemoveProjectRequest(confirmed: false, target: target))
      )

      #expect(
        result
          == .removedProject(
            SupatermRemoveProjectResult(
              removedProjectID: created.project.id,
              removedTabIDs: []
            )))
      #expect(registry.projectCatalog.projects.isEmpty)
      #expect(
        !window.terminal.isProjectCollapsed(
          TerminalProjectID(rawValue: created.project.id),
          in: window.terminal.displayedSpaceID
        )
      )
      withExtendedLifetime(window.window) {}
    }
  }

  @Test
  func crossWindowTransferRejectsStaleProjectOrder() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let projects = [TerminalProject(name: "First"), TerminalProject(name: "Second")]
      @Shared(.terminalProjectCatalog) var catalog = TerminalProjectCatalog.default
      $catalog.withLock { $0 = TerminalProjectCatalog(projects: projects) }
      let registry = TerminalWindowRegistry()
      let source = registerWindow(in: registry, spaceID: TerminalSpaceID())
      let destination = registerWindow(in: registry, spaceID: TerminalSpaceID())
      let sourceTabID = source.terminal.spaceManager.tabCollection.createTab(title: "Source")
      let sourceEntry = try #require(
        registry.activeEntries().first { $0.terminal === source.terminal }
      )
      let destinationEntry = try #require(
        registry.activeEntries().first { $0.terminal === destination.terminal }
      )
      let payload = try #require(
        TerminalTabDragPayload(
          operationID: TerminalTabMoveOperationID(),
          sourceWindowID: sourceEntry.windowControllerID,
          sourceSpaceID: source.terminal.displayedSpaceID,
          sourceTopologyRevision: source.terminal.spaceManager.tabCollection.topologyRevision,
          orderedProjectIDs: projects.map(\.id),
          itemIDs: [.tab(sourceTabID)]
        )
      )
      $catalog.withLock { $0.projects.reverse() }

      let result = registry.transferTab(
        payload,
        to: TerminalTabDragRegistry.Destination(
          windowControllerID: destinationEntry.windowControllerID,
          spaceID: destination.terminal.displayedSpaceID,
          expectedTopologyRevision: destination.terminal.spaceManager.tabCollection.topologyRevision,
          destination: .move(
            TerminalTabPlacement(projectID: nil, isPinned: false, index: 0)
          )
        )
      )

      #expect(result == nil)
      #expect(source.terminal.containsTab(sourceTabID.rawValue))
      #expect(!destination.terminal.containsTab(sourceTabID.rawValue))
      withExtendedLifetime([source.window, destination.window]) {}
    }
  }
}
