import AppKit
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

  @Test
  func pasteboardRoundTripPreservesStableSourceIdentity() throws {
    let payload = try #require(makePayload())
    let pasteboard = NSPasteboard(name: NSPasteboard.Name(UUID().uuidString))
    let item = NSPasteboardItem()

    #expect(TerminalTabDragPasteboard.write(payload, to: item))
    pasteboard.clearContents()
    #expect(pasteboard.writeObjects([item]))
    #expect(TerminalTabDragPasteboard.read(from: pasteboard) == payload)
  }

  @Test @MainActor
  func registryResolvesOnlyItsActivePasteboardPayload() throws {
    let active = try #require(makePayload())
    let other = try #require(makePayload())
    let registry = TerminalTabDragRegistry()
    let pasteboard = NSPasteboard(name: NSPasteboard.Name(UUID().uuidString))

    #expect(registry.begin(active))
    let item = NSPasteboardItem()
    #expect(TerminalTabDragPasteboard.write(other, to: item))
    pasteboard.clearContents()
    #expect(pasteboard.writeObjects([item]))
    #expect(registry.resolve(pasteboard) == nil)

    let activeItem = NSPasteboardItem()
    #expect(TerminalTabDragPasteboard.write(active, to: activeItem))
    pasteboard.clearContents()
    #expect(pasteboard.writeObjects([activeItem]))
    #expect(registry.resolve(pasteboard) == active)
  }

  @Test @MainActor
  func splitDestinationEntryConsumesItsHandoffOnce() throws {
    let payload = try #require(makePayload())
    let registry = TerminalTabDragRegistry()
    var count = 0
    #expect(registry.begin(payload, splitDestinationEntryAction: { count += 1 }))

    registry.consumeSplitDestinationEntryAction(for: payload)
    registry.consumeSplitDestinationEntryAction(for: payload)

    #expect(count == 1)
  }

  @Test @MainActor
  func splitDispositionRetainsOnlyTheExactSourceTab() throws {
    let payload = try #require(makePayload())
    let tabID = try #require(payload.singleTabID)
    let destination = TerminalTabDragRegistry.SplitDestination(
      windowControllerID: payload.sourceWindowID,
      spaceID: payload.sourceSpaceID,
      tabID: tabID,
      zone: .right
    )

    #expect(destination.sourceDisposition(for: payload) == .retained)
    #expect(
      TerminalTabDragRegistry.SplitDestination(
        windowControllerID: payload.sourceWindowID,
        spaceID: payload.sourceSpaceID,
        tabID: TerminalTabID(),
        zone: .right
      ).sourceDisposition(for: payload) == .removed
    )
  }

  private func makePayload() -> TerminalTabDragPayload? {
    TerminalTabDragPayload(
      operationID: TerminalTabMoveOperationID(),
      sourceWindowID: UUID(),
      sourceSpaceID: TerminalSpaceID(),
      sourceTopologyRevision: 7,
      orderedProjectIDs: [],
      itemIDs: [.tab(TerminalTabID())]
    )
  }
}
