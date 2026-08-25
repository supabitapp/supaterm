import Foundation
import Testing

@testable import supaterm

struct TerminalTabDragPayloadTests {
  @Test
  func payloadRoundTripsProjectsTabsAndCatalogOrder() throws {
    let firstProjectID = TerminalProjectID()
    let secondProjectID = TerminalProjectID()
    let tabID = TerminalTabID()
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 42,
        orderedProjectIDs: [firstProjectID, secondProjectID],
        itemIDs: [.project(firstProjectID), .tab(tabID)]
      )
    )

    let decoded = try JSONDecoder().decode(
      TerminalTabDragPayload.self,
      from: JSONEncoder().encode(payload)
    )

    #expect(decoded == payload)
    #expect(decoded.version == TerminalTabDragPayload.schemaVersion)
    #expect(decoded.orderedProjectIDs == [firstProjectID, secondProjectID])
    #expect(decoded.itemIDs == [.project(firstProjectID), .tab(tabID)])
    #expect(decoded.tabIDs == [tabID])
  }

  @Test
  func payloadRejectsEmptyAndDuplicateItems() {
    let tabID = TerminalTabID()

    #expect(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        orderedProjectIDs: [],
        itemIDs: []
      ) == nil
    )
    #expect(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        orderedProjectIDs: [],
        itemIDs: [.tab(tabID), .tab(tabID)]
      ) == nil
    )
  }

  @Test
  func olderPayloadSchemaIsRejected() throws {
    let data = Data(
      """
      {"version":1,
      "operationID":"00000000-0000-0000-0000-000000000001",
      "sourceWindowID":"00000000-0000-0000-0000-000000000002",
      "sourceSpaceID":{"rawValue":"00000000-0000-0000-0000-000000000003"},
      "sourceTopologyRevision":0,
      "orderedProjectIDs":[],
      "items":[]}
      """.utf8
    )

    #expect(!((try JSONDecoder().decode(TerminalTabDragPayload.self, from: data)).isValid))
  }
}
