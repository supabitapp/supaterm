import ComposableArchitecture
import Foundation
import Sharing
import SupatermTerminalCore
import Testing

@testable import supaterm

@MainActor
struct TerminalProjectDomainTests {
  @Test
  func rejectsInvalidAndUnavailableDirectories() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let host = TerminalHostState(managesTerminalSurfaces: false)

      #expect(throws: TerminalControlError.invalidProjectDirectory) {
        _ = try host.createProject(directoryURL: URL(string: "https://example.com")!)
      }
      #expect(throws: TerminalControlError.projectDirectoryUnavailable) {
        _ = try host.createProject(
          directoryURL: FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        )
      }
    }
  }

  @Test
  func rejectsDuplicateCanonicalDirectoryInSpace() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let root = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      let directoryURL = root.appendingPathComponent("Workspace", isDirectory: true)
      try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: root) }

      let project = TerminalProjectItem(directoryURL: directoryURL)
      let space = PersistedTerminalSpace(name: "A", projects: [project])
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
      }
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let duplicateURL = URL(
        fileURLWithPath: directoryURL.path(percentEncoded: false),
        isDirectory: false
      )

      #expect(throws: TerminalControlError.projectAlreadyExists) {
        _ = try host.createProject(directoryURL: duplicateURL, in: space.id)
      }
    }
  }

  @Test
  func projectBatchCreationIsAllOrNothing() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let root = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      let validDirectoryURL = root.appendingPathComponent("Valid", isDirectory: true)
      let unavailableDirectoryURL = root.appendingPathComponent("Unavailable", isDirectory: true)
      try FileManager.default.createDirectory(at: validDirectoryURL, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: root) }

      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let projectCount = catalog.spaces[0].projects.count

      #expect(throws: TerminalControlError.projectDirectoryUnavailable) {
        _ = try host.createProjects(
          directoryURLs: [validDirectoryURL, unavailableDirectoryURL]
        )
      }
      #expect(catalog.spaces[0].projects.count == projectCount)
    }
  }

  @Test
  func projectBatchCreationRejectsCanonicalDuplicates() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let root = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      let directoryURL = root.appendingPathComponent("Workspace", isDirectory: true)
      try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: root) }

      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let projectCount = catalog.spaces[0].projects.count
      let duplicateURL =
        directoryURL
        .appendingPathComponent("..", isDirectory: true)
        .appendingPathComponent("Workspace", isDirectory: true)

      #expect(throws: TerminalControlError.projectAlreadyExists) {
        _ = try host.createProjects(directoryURLs: [directoryURL, duplicateURL])
      }
      #expect(catalog.spaces[0].projects.count == projectCount)
    }
  }

  @Test
  func focusedProjectBatchSelectsTargetSpaceAndLastProject() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let root = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      let firstDirectoryURL = root.appendingPathComponent("First", isDirectory: true)
      let secondDirectoryURL = root.appendingPathComponent("Second", isDirectory: true)
      try FileManager.default.createDirectory(at: firstDirectoryURL, withIntermediateDirectories: true)
      try FileManager.default.createDirectory(at: secondDirectoryURL, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: root) }

      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      let host = TerminalHostState()
      let originalSpaceID = try #require(host.selectedSpaceID)
      let targetSpaceID = try host.createSpace(named: "Target")
      host.selectSpace(originalSpaceID)

      let projectIDs = try host.createProjects(
        directoryURLs: [firstDirectoryURL, secondDirectoryURL],
        in: targetSpaceID,
        focusing: true
      )

      #expect(host.selectedSpaceID == targetSpaceID)
      #expect(host.selectedProjectID == projectIDs.last)
      #expect(catalog.defaultSelectedSpaceID == targetSpaceID)
    }
  }

  @Test
  func deletingFinalProjectLeavesSpaceEmpty() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let spaceID = host.spaces[0].id
      let projectID = host.projects[0].id

      host.deleteProject(projectID)

      #expect(host.spaceManager.projects(in: spaceID).isEmpty)
      #expect(catalog.spaces[0].projects.isEmpty)
    }
  }
}
