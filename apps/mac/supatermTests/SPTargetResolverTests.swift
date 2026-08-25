import ArgumentParser
import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPTargetResolverTests {
  @Test
  func resolvesProjectByTrimmedNameUUIDAndShortReference() throws {
    let snapshot = try fixture()
    let projectID = id("10000000-0000-4000-8000-000000000001")
    let target = SupatermProjectTargetRequest(projectID: projectID)

    #expect(try resolvePublicProjectTargetRequest(.name("  WORK  "), snapshot: snapshot) == target)
    #expect(try resolvePublicProjectTargetRequest(.id(projectID), snapshot: snapshot) == target)
    #expect(
      try resolvePublicProjectTargetRequest(
        .short(SPShortReference(kind: .project, prefix: "10000000000040008000000000000001")),
        snapshot: snapshot
      ) == target
    )
  }

  @Test
  func rejectsMissingProjectAndWrongShortReferenceKind() throws {
    let snapshot = try fixture()

    #expect(throws: ValidationError.self) {
      _ = try resolvePublicProjectTargetRequest(.name("Missing"), snapshot: snapshot)
    }
    #expect(throws: ValidationError.self) {
      _ = try parseProjectReference("g:10000000")
    }
    #expect(throws: ValidationError.self) {
      _ = try parseProjectReference("t:30000000")
    }
  }

  @Test
  func resolvesAmbientSpaceTabAndPane() throws {
    let snapshot = try fixture()

    #expect(
      try resolvePublicSpaceTarget(nil, context: nil, snapshot: snapshot).spaceID
        == id("20000000-0000-4000-8000-000000000001")
    )
    #expect(
      try resolvePublicTabTarget(nil, context: nil, snapshot: snapshot).tabID
        == id("30000000-0000-4000-8000-000000000001")
    )
    #expect(
      try resolvePublicPaneTarget(nil, context: nil, snapshot: snapshot).paneID
        == id("40000000-0000-4000-8000-000000000001")
    )
  }

  @Test
  func resolvesPathUUIDAndTypedReferences() throws {
    let snapshot = try fixture()
    let tabID = id("30000000-0000-4000-8000-000000000002")
    let paneID = id("40000000-0000-4000-8000-000000000002")

    #expect(
      try resolvePublicTabTarget(.path(spaceIndex: 1, tabIndex: 2), context: nil, snapshot: snapshot)
        .tabID == tabID
    )
    #expect(try resolvePublicTabTarget(.id(tabID), context: nil, snapshot: snapshot).tabID == tabID)
    #expect(
      try resolvePublicTabTarget(
        .short(SPShortReference(kind: .tab, prefix: "30000000000040008000000000000002")),
        context: nil,
        snapshot: snapshot
      ).tabID == tabID
    )
    #expect(
      try resolvePublicPaneTarget(
        .path(spaceIndex: 1, tabIndex: 2, paneIndex: 1),
        context: nil,
        snapshot: snapshot
      ).paneID == paneID
    )
  }

  @Test
  func ambientContextMustMatchOneTabAndPane() throws {
    let snapshot = try fixture()
    let context = SupatermCLIContext(
      surfaceID: id("40000000-0000-4000-8000-000000000002"),
      tabID: id("30000000-0000-4000-8000-000000000002")
    )

    #expect(try resolvePublicTabTarget(nil, context: context, snapshot: snapshot).tabID == context.tabID)
    #expect(
      try resolvePublicNewTabTarget(nil, context: context, snapshot: snapshot)
        == .pane(context.surfaceID)
    )
    #expect(
      try resolvePublicSplitTarget(nil, context: context, snapshot: snapshot)
        == .pane(context.surfaceID)
    )
    #expect(throws: ValidationError.self) {
      _ = try resolvePublicTabTarget(
        nil,
        context: SupatermCLIContext(
          surfaceID: id("40000000-0000-4000-8000-000000000003"),
          tabID: context.tabID
        ),
        snapshot: snapshot
      )
    }
  }

  @Test
  func explicitNewTabSpaceStaysSeparateFromProjectAssignment() throws {
    let snapshot = try fixture()

    #expect(
      try resolvePublicNewTabTarget(.index(1), context: nil, snapshot: snapshot)
        == .space(id("20000000-0000-4000-8000-000000000001"))
    )
  }

  @Test
  func staleAmbientContextDoesNotFallBackToTheKeyWindow() throws {
    let snapshot = try fixture()
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())

    #expect(throws: ValidationError.self) {
      _ = try resolvePublicSpaceTarget(nil, context: context, snapshot: snapshot)
    }
    #expect(throws: ValidationError.self) {
      _ = try resolvePublicTabTarget(nil, context: context, snapshot: snapshot)
    }
    #expect(throws: ValidationError.self) {
      _ = try resolvePublicPaneTarget(nil, context: context, snapshot: snapshot)
    }
  }

  @Test
  func duplicateTabAndPaneIDsAreRejected() throws {
    let snapshot = try fixture()
    let tabID = id("30000000-0000-4000-8000-000000000001")
    let paneID = id("40000000-0000-4000-8000-000000000001")
    let duplicateSpace = SupatermTreeSnapshot.Space(
      index: 1,
      id: UUID(),
      name: "Duplicate",
      color: .neutral,
      isWarm: true,
      collapsedProjectIDs: [],
      isUnassignedCollapsed: false,
      tabs: [
        SupatermTreeSnapshot.Tab(
          id: tabID,
          title: "Duplicate",
          projectID: nil,
          isPinned: false,
          isSelected: true,
          panes: [SupatermTreeSnapshot.Pane(index: 1, id: paneID, isFocused: true)]
        )
      ]
    )
    let duplicateSnapshot = SupatermTreeSnapshot(
      projects: snapshot.projects,
      windows: snapshot.windows + [
        SupatermTreeSnapshot.Window(
          index: 2,
          isKey: false,
          displayedSpaceID: duplicateSpace.id,
          spaces: [duplicateSpace]
        )
      ]
    )

    #expect(throws: ValidationError.self) {
      _ = try resolvePublicTabTarget(.id(tabID), context: nil, snapshot: duplicateSnapshot)
    }
    #expect(throws: ValidationError.self) {
      _ = try resolvePublicPaneTarget(.id(paneID), context: nil, snapshot: duplicateSnapshot)
    }
  }

  private func fixture() throws -> SupatermTreeSnapshot {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .appendingPathComponent("Fixtures/flat-tree-snapshot.json")
    return try JSONDecoder().decode(SupatermTreeSnapshot.self, from: Data(contentsOf: url))
  }

  private func id(_ value: String) -> UUID {
    UUID(uuidString: value)!
  }
}
