import AppKit
import ComposableArchitecture
import Foundation
import Sharing
import SupatermLicenseFeature
import Testing

@testable import supaterm

extension TerminalTabTransferTests {
  @Test
  func transferAtTheFreeLimitRemainsAllowed() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "Source"), TerminalSpaceItem(name: "Cold")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry.test(zmxClient: .noop)
      let gate = LicenseTabGate(
        licenseAccess: { .free },
        enforcementEnabled: true
      )
      let runtime = GhosttyRuntime()
      let source = TerminalHostState.test(
        runtime: runtime,
        spaceID: spaces[0].id,
        zmxClient: .noop,
        zmxSessionsEnabled: false,
        licenseTabGate: gate
      )
      let destination = TerminalHostState.test(
        runtime: runtime,
        spaceID: spaces[0].id,
        zmxClient: .noop,
        zmxSessionsEnabled: false,
        licenseTabGate: gate
      )
      let tabIDs = try (0..<5).map { _ in
        try #require(source.createTab(focusing: false))
      }
      destination.spaceManager.registerColdInstance(
        terminalSpaceSession(spaceID: spaces[1].id, tabCount: 0)
      )
      let sourceWindowID = UUID()
      let destinationWindowID = UUID()
      let sourceWindow = register(source, id: sourceWindowID, in: registry)
      let destinationWindow = register(destination, id: destinationWindowID, in: registry)
      let payload = try #require(
        TerminalTabDragPayload(
          operationID: TerminalTabMoveOperationID(),
          sourceWindowID: sourceWindowID,
          sourceSpaceID: spaces[0].id,
          sourceTopologyRevision: source.spaceManager.tabCollection.topologyRevision,
          orderedProjectIDs: [],
          itemIDs: [.tab(tabIDs[0])]
        )
      )

      let result = registry.transferTab(
        payload,
        to: TerminalTabDragRegistry.Destination(
          windowControllerID: destinationWindowID,
          spaceID: spaces[1].id,
          expectedTopologyRevision: try #require(
            destination.spaceManager.tabCollection(for: spaces[1].id)?.topologyRevision
          ),
          destination: .move(
            TerminalTabPlacement(projectID: nil, isPinned: false, index: 0)
          )
        )
      )

      #expect(result?.tabIDs == [tabIDs[0]])
      #expect(source.spaceManager.allTabs.count == 4)
      #expect(destination.spaceManager.tabs(in: spaces[1].id).map(\.id) == [tabIDs[0]])
      #expect(destination.spaceManager.instance(for: spaces[1].id)?.pendingSession == nil)
      #expect(
        gate.refusal(for: .user, openTabs: 5)
          == LicenseTabGate.Refusal(limit: 5, openTabs: 5)
      )
      withExtendedLifetime([sourceWindow, destinationWindow]) {}
    }
  }

  private func register(
    _ host: TerminalHostState,
    id: UUID,
    in registry: TerminalWindowRegistry
  ) -> NSWindow {
    let store = Store(initialState: AppFeature.State()) { AppFeature() }
    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: id,
      store: store,
      terminal: host,
      requestConfirmedWindowClose: {}
    )
    let window = NSWindow()
    registry.updateWindow(window, for: id)
    return window
  }
}
