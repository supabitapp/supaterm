import SupatermCLIShared
import Testing

struct SupatermProjectLayoutTests {
  @Test
  func layoutUsesCatalogSectionsThenUnassignedWithPinnedTabsFirst() {
    let layout = SupatermProjectLayout.make(
      orderedProjectIDs: ["pinned", "regular", "empty"],
      pinnedTabs: [
        SupatermProjectTabRecord(id: "p1", projectID: "pinned"),
        SupatermProjectTabRecord(id: "dangling-p", projectID: "missing"),
        SupatermProjectTabRecord(id: "r1", projectID: "regular"),
      ],
      regularTabs: [
        SupatermProjectTabRecord(id: "p2", projectID: "pinned"),
        SupatermProjectTabRecord(id: "unassigned", projectID: nil),
        SupatermProjectTabRecord(id: "r2", projectID: "regular"),
      ]
    )

    #expect(layout.sections.map(\.projectID) == ["pinned", "regular", nil])
    #expect(layout.sections.map(\.pinnedTabIDs) == [["p1"], ["r1"], ["dangling-p"]])
    #expect(layout.sections.map(\.regularTabIDs) == [["p2"], ["r2"], ["unassigned"]])
    #expect(layout.semanticTabIDs == ["p1", "p2", "r1", "r2", "dangling-p", "unassigned"])
  }

  @Test
  func moveUsesCurrentSemanticOrderAndASectionLocalDestination() throws {
    let result = try SupatermProjectLayout.move(
      orderedProjectIDs: ["one", "two"],
      pinnedTabs: [
        SupatermProjectTabRecord(id: "a", projectID: "one"),
        SupatermProjectTabRecord(id: "b", projectID: "two"),
        SupatermProjectTabRecord(id: "c", projectID: "one"),
      ],
      regularTabs: [
        SupatermProjectTabRecord(id: "d", projectID: "one"),
        SupatermProjectTabRecord(id: "e", projectID: "two"),
        SupatermProjectTabRecord(id: "f", projectID: nil),
      ],
      movingTabIDs: ["d", "a"],
      destination: SupatermProjectTabPlacement(projectID: "two", isPinned: false, index: 1)
    )

    #expect(result.pinnedTabs.map(\.id) == ["b", "c"])
    #expect(result.regularTabs.map(\.id) == ["e", "a", "d", "f"])
    #expect(result.regularTabs.map(\.projectID) == ["two", "two", "two", nil])
  }
}
