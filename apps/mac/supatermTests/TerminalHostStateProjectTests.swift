import ComposableArchitecture
import Foundation
import SupatermSupport
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateProjectTests {
  @Test
  func projectOperationsPreserveSectionOrderAndHome() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let spaceID = try #require(host.selectedSpaceID)
      let homeProjectID = try #require(host.spaceManager.homeProjectID(in: spaceID))
      let firstProjectID = try #require(host.createProject(folderPath: "/work/first", in: spaceID))
      let secondProjectID = try #require(host.createProject(folderPath: "/work/second", in: spaceID))

      #expect(host.projectDisplayName(homeProjectID, in: spaceID) == "Home")
      #expect(host.projectDisplayName(firstProjectID, in: spaceID) == "first")

      host.toggleProjectPinned(secondProjectID, in: spaceID)
      host.setProjectOrder(
        [secondProjectID, firstProjectID, homeProjectID],
        in: spaceID
      )

      #expect(
        host.orderedProjects(in: spaceID).map(\.id)
          == [secondProjectID, firstProjectID, homeProjectID]
      )

      host.toggleProjectPinned(secondProjectID, in: spaceID)
      host.deleteProject(homeProjectID, in: spaceID)

      #expect(
        host.orderedProjects(in: spaceID).map(\.id)
          == [firstProjectID, homeProjectID, secondProjectID]
      )
      #expect(host.orderedProjects(in: spaceID).filter(\.isHome).count == 1)
    }
  }

  @Test
  func projectOrderCanTogglePinStateAtomically() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let spaceID = try #require(host.selectedSpaceID)
      let homeProjectID = try #require(host.spaceManager.homeProjectID(in: spaceID))
      let firstProjectID = try #require(host.createProject(folderPath: "/work/first", in: spaceID))
      let secondProjectID = try #require(host.createProject(folderPath: "/work/second", in: spaceID))

      host.setProjectOrder(
        [secondProjectID, homeProjectID, firstProjectID],
        settingPinned: secondProjectID,
        to: true,
        in: spaceID
      )

      let projects = host.orderedProjects(in: spaceID)
      #expect(projects.map(\.id) == [secondProjectID, homeProjectID, firstProjectID])
      #expect(projects.first?.isPinned == true)

      host.setProjectOrder(
        [homeProjectID, firstProjectID, secondProjectID],
        settingPinned: secondProjectID,
        to: false,
        in: spaceID
      )

      #expect(
        host.orderedProjects(in: spaceID).map(\.id)
          == [homeProjectID, firstProjectID, secondProjectID]
      )
      #expect(host.orderedProjects(in: spaceID).last?.isPinned == false)
    }
  }

  @Test
  func tabCreationUsesExplicitProjectThenAnchorThenHome() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let runtime = try makeGhosttyRuntime("confirm-close-surface = false")
      let host = TerminalHostState(runtime: runtime, zmxSessionsEnabled: false)
      let spaceID = try #require(host.selectedSpaceID)
      let homeProjectID = try #require(host.spaceManager.homeProjectID(in: spaceID))

      let homeTabID = try #require(host.createTab(focusing: false))
      let projectID = try #require(host.createProject(folderPath: "/work/project", in: spaceID))
      let explicitTabID = try #require(
        host.createTab(projectID: projectID, focusing: false)
      )
      let anchorSurfaceID = try #require(host.contextSurfaceID(for: explicitTabID))
      let inheritedTabID = try #require(
        host.createTab(focusing: false, inheritingFromSurfaceID: anchorSurfaceID)
      )

      #expect(host.spaceManager.tab(for: homeTabID)?.projectID == homeProjectID)
      #expect(host.spaceManager.tab(for: explicitTabID)?.projectID == projectID)
      #expect(host.spaceManager.tab(for: inheritedTabID)?.projectID == projectID)
      #expect(host.tabs(in: projectID, spaceID: spaceID).map(\.id) == [explicitTabID, inheritedTabID])

      host.setRegularTabOrder(
        [inheritedTabID, explicitTabID],
        in: projectID,
        spaceID: spaceID
      )
      #expect(host.tabs(in: projectID, spaceID: spaceID).map(\.id) == [inheritedTabID, explicitTabID])

      host.setProjectCollapsed(true, projectID: projectID, in: spaceID)
      let snapshot = host.restorationSnapshot()
      #expect(snapshot.spaces[0].collapsedProjectIDs == [projectID])

      let restored = TerminalHostState(runtime: runtime, zmxSessionsEnabled: false)
      #expect(restored.restore(from: snapshot))
      #expect(restored.isProjectCollapsed(projectID, in: spaceID))
    }
  }

  @Test
  func deletingProjectClosesItsTabsAcrossWindows() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)
      let spaceID = try #require(firstHost.selectedSpaceID)
      let projectID = try #require(firstHost.createProject(folderPath: "/work/project", in: spaceID))
      await flushSpaceCatalogObservation()

      let firstTabID = firstHost.spaceManager.tabManager(for: spaceID)?.createTab(
        projectID: projectID,
        title: "First"
      )
      let secondTabID = secondHost.spaceManager.tabManager(for: spaceID)?.createTab(
        projectID: projectID,
        title: "Second"
      )

      firstHost.deleteProject(projectID, in: spaceID)
      await flushSpaceCatalogObservation()

      #expect(firstTabID.flatMap(firstHost.spaceManager.tab(for:)) == nil)
      #expect(secondTabID.flatMap(secondHost.spaceManager.tab(for:)) == nil)
      #expect(!firstHost.orderedProjects(in: spaceID).contains(where: { $0.id == projectID }))
      #expect(!secondHost.orderedProjects(in: spaceID).contains(where: { $0.id == projectID }))
    }
  }

  @Test
  func deletingProjectKillsItsZmxSessions() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let killedSurfaceIDs = LockIsolated<Set<UUID>>([])
      let runtime = try makeGhosttyRuntime("confirm-close-surface = false")
      let host = TerminalHostState(
        runtime: runtime,
        zmxClient: ZmxClient(
          executableURL: { nil },
          isBundled: { true },
          killSession: { surfaceID in
            killedSurfaceIDs.withValue { _ = $0.insert(surfaceID) }
          },
          listSessions: { [] }
        )
      )
      let spaceID = try #require(host.selectedSpaceID)
      let projectID = try #require(host.createProject(folderPath: "/work/project", in: spaceID))
      let tabID = try #require(
        host.createTab(projectID: projectID, focusing: false)
      )
      let surfaceID = try #require(host.contextSurfaceID(for: tabID))

      host.deleteProject(projectID, in: spaceID)
      for _ in 0..<20 where !killedSurfaceIDs.value.contains(surfaceID) {
        await Task.yield()
      }

      #expect(host.spaceManager.tab(for: tabID) == nil)
      #expect(host.trees[tabID] == nil)
      #expect(killedSurfaceIDs.value.contains(surfaceID))
    }
  }

  private func flushSpaceCatalogObservation() async {
    for _ in 0..<10 {
      await Task.yield()
    }
  }
}
