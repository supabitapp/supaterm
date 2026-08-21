import AppKit
import ComposableArchitecture
import Foundation
import Sharing
import Testing

@testable import SupatermSupport
@testable import SupatermTerminalCore
@testable import supaterm

@MainActor
struct LicenseTabGateTests {
  @Test
  func freeModeWithFourOpenTabsAllowsAnotherTab() throws {
    try withGateHarness { harness in
      for _ in 0..<4 {
        _ = try harness.host.createTab(in: harness.space.id, reason: .restore)
      }

      let tabID = try harness.host.createTab(in: harness.space.id, reason: .user)

      #expect(tabID != nil)
      #expect(harness.host.spaceManager.allTabs.count == 5)
    }
  }

  @Test
  func freeModeWithFiveOpenTabsRefusesAnotherTab() throws {
    try withGateHarness { harness in
      for _ in 0..<5 {
        _ = try harness.host.createTab(in: harness.space.id, reason: .restore)
      }

      #expect(throws: TerminalCreateTabError.tabLimitReached(limit: 5, openTabs: 5)) {
        _ = try harness.host.createTab(in: harness.space.id, reason: .user)
      }
      #expect(harness.host.showsLicenseTabLimitRefusal)
      #expect(harness.host.spaceManager.allTabs.count == 5)
    }
  }

  @Test
  func countSpansLiveHostsWarmSpacesAndColdSessions() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [
        TerminalSpaceItem(name: "First"),
        TerminalSpaceItem(name: "Second"),
        TerminalSpaceItem(name: "Cold"),
      ]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      let gate = freeGate(registry: registry)
      let first = registerHost(
        in: registry,
        gate: gate,
        spaceID: spaces[0].id,
        managesTerminalSurfaces: false
      )
      let second = registerHost(
        in: registry,
        gate: gate,
        spaceID: spaces[0].id,
        managesTerminalSurfaces: false
      )
      _ = first.host.spaceManager.displayedInstance.tabCollection.createTab(title: "First")
      _ = first.host.spaceManager.instance(warming: spaces[1].id).tabCollection.createTab(
        title: "Second"
      )
      first.host.spaceManager.registerColdInstance(
        terminalSpaceSession(spaceID: spaces[2].id, tabCount: 2)
      )
      _ = second.host.spaceManager.displayedInstance.tabCollection.createTab(title: "Other window")

      #expect(gate.refusal(for: .user) == LicenseTabGate.Refusal(limit: 5, openTabs: 5))
      withExtendedLifetime([first.window, second.window]) {}
    }
  }

  @Test
  func pinnedTabsCountAndPanesDoNot() throws {
    try withGateHarness { harness in
      var tabIDs: [TerminalTabID] = []
      for _ in 0..<4 {
        let tabID = try harness.host.createTab(in: harness.space.id, reason: .restore)
        tabIDs.append(try #require(tabID))
      }
      harness.host.togglePinned(tabIDs[0])
      for _ in 0..<3 {
        let paneID = try #require(harness.host.selectedSurfaceView?.id)
        _ = try harness.host.createPane(
          TerminalCreatePaneRequest(
            startupCommand: nil,
            direction: .right,
            focus: true,
            equalize: false,
            target: .pane(paneID)
          )
        )
      }

      _ = try harness.host.createTab(in: harness.space.id, reason: .user)

      #expect(harness.host.spaceManager.allTabs.count == 5)
      #expect(harness.host.paneCount(inSpace: harness.space.id) == 8)
      #expect(throws: TerminalCreateTabError.tabLimitReached(limit: 5, openTabs: 5)) {
        _ = try harness.host.createTab(in: harness.space.id, reason: .user)
      }
    }
  }

  @Test
  func restoringSevenTabsKeepsThemUsableAndCreationResumesBelowTheLimit() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let space = TerminalSpaceItem(name: "Main")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
      }
      let registry = TerminalWindowRegistry()
      let gate = freeGate(registry: registry)
      let registered = registerHost(in: registry, gate: gate, spaceID: space.id)
      let session = TerminalWindowSession(
        displayedSpaceID: space.id,
        spaces: [terminalSpaceSession(spaceID: space.id, tabCount: 7)]
      )

      #expect(registered.host.restore(from: session))
      #expect(registered.host.spaceManager.allTabs.count == 7)
      #expect(throws: TerminalCreateTabError.tabLimitReached(limit: 5, openTabs: 7)) {
        _ = try registered.host.createTab(in: space.id, reason: .user)
      }
      for tabID in registered.host.spaceManager.allTabs.prefix(3).map(\.id) {
        registered.host.closeTab(tabID)
      }
      #expect(registered.host.spaceManager.allTabs.count == 4)
      let tabID = try registered.host.createTab(in: space.id, reason: .user)
      #expect(tabID != nil)
      #expect(!registered.host.showsLicenseTabLimitRefusal)
      withExtendedLifetime(registered.window) {}
    }
  }

  @Test
  func restoreFallbackAlwaysCreatesItsTab() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "Main"), TerminalSpaceItem(name: "Cold")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      let gate = freeGate(registry: registry)
      let registered = registerHost(in: registry, gate: gate, spaceID: spaces[0].id)
      let emptyDisplayedSpace = TerminalSpaceSession(
        spaceID: spaces[0].id,
        selectedTabID: nil,
        nodes: [],
        groups: [],
        collapsedGroupIDs: [],
        tabs: []
      )
      let session = TerminalWindowSession(
        displayedSpaceID: spaces[0].id,
        spaces: [
          emptyDisplayedSpace,
          terminalSpaceSession(spaceID: spaces[1].id, tabCount: 5),
        ]
      )

      #expect(registered.host.restore(from: session))
      #expect(registered.host.spaceManager.tabs(in: spaces[0].id).count == 1)
      #expect(registered.host.spaceManager.instance(for: spaces[1].id)?.pendingSession?.tabs.count == 5)
      withExtendedLifetime(registered.window) {}
    }
  }

  @Test
  func warmingAnEmptyRestoredSpaceAlwaysCreatesItsFallbackTab() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "Main"), TerminalSpaceItem(name: "Cold")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      let gate = freeGate(registry: registry)
      let registered = registerHost(in: registry, gate: gate, spaceID: spaces[0].id)
      for _ in 0..<5 {
        _ = try registered.host.createTab(in: spaces[0].id, reason: .restore)
      }
      registered.host.spaceManager.registerColdInstance(
        terminalSpaceSession(spaceID: spaces[1].id, tabCount: 0)
      )

      #expect(registered.host.displaySpace(spaces[1].id))
      #expect(registered.host.spaceManager.tabs(in: spaces[1].id).count == 1)
      withExtendedLifetime(registered.window) {}
    }
  }

  @Test
  func paidAndOwnedReleaseModesAreUngated() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let space = TerminalSpaceItem(name: "Main")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
      }
      let registry = TerminalWindowRegistry()
      let host = registerHost(
        in: registry,
        gate: LicenseTabGate(),
        spaceID: space.id,
        managesTerminalSurfaces: false
      )
      for index in 0..<5 {
        _ = host.host.spaceManager.displayedInstance.tabCollection.createTab(title: "Tab \(index)")
      }
      let paid = LicenseTabGate(
        registry: registry,
        licenseMode: { .paid },
        enforcementEnabled: true
      )
      let updatesThrough = try #require(LicenseDay("2025-01-01"))
      let releaseDay = try #require(LicenseDay("2024-12-31"))
      let entitlement = LicenseEntitlement(
        licenseID: "license",
        deviceID: "device",
        status: .active,
        updatesThrough: updatesThrough,
        revision: 1,
        issuedAt: 1,
        revocationReason: nil,
        signedToken: "signed-token"
      )
      let ownedRelease = LicenseMode(entitlement: entitlement, releaseDay: releaseDay)
      let owned = LicenseTabGate(
        registry: registry,
        licenseMode: { ownedRelease },
        enforcementEnabled: true
      )

      #expect(paid.refusal(for: .user) == nil)
      #expect(ownedRelease == .paid)
      #expect(owned.refusal(for: .user) == nil)
      withExtendedLifetime(host.window) {}
    }
  }

  #if DEBUG
    @Test
    func debugDefaultsToPaidAndOnlyLicenseModeFreeOptsIn() {
      #expect(LicenseTabGate.debugLicenseMode(environment: [:]) == .paid)
      #expect(
        LicenseTabGate.debugLicenseMode(environment: ["SUPATERM_LICENSE_MODE": "free"])
          == .free
      )
      #expect(
        LicenseTabGate.debugLicenseMode(environment: ["SUPATERM_TEST_MODE": "1"])
          == .paid
      )
    }
  #endif

  @Test
  func registryWiresBothRefusalActions() {
    var actions: [LicenseTabLimitAction] = []
    let registry = TerminalWindowRegistry {
      actions.append($0)
    }
    let host = registerHost(
      in: registry,
      gate: LicenseTabGate(),
      spaceID: TerminalSpaceItem(name: "Main").id,
      managesTerminalSurfaces: false
    )

    host.host.onLicenseTabLimitAction(.activate)
    host.host.onLicenseTabLimitAction(.buy)

    #expect(actions == [.activate, .buy])
    withExtendedLifetime(host.window) {}
  }

  private func withGateHarness(
    _ operation: (GateHarness) throws -> Void
  ) throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let space = TerminalSpaceItem(name: "Main")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
      }
      let registry = TerminalWindowRegistry()
      let gate = freeGate(registry: registry)
      let registered = registerHost(in: registry, gate: gate, spaceID: space.id)
      try operation(
        GateHarness(
          host: registered.host,
          space: space
        )
      )
      withExtendedLifetime(registered.window) {}
    }
  }

  private func freeGate(registry: TerminalWindowRegistry) -> LicenseTabGate {
    LicenseTabGate(
      registry: registry,
      licenseMode: { .free },
      enforcementEnabled: true
    )
  }

  private func registerHost(
    in registry: TerminalWindowRegistry,
    gate: LicenseTabGate,
    spaceID: TerminalSpaceID,
    managesTerminalSurfaces: Bool = true
  ) -> RegisteredHost {
    let host = TerminalHostState(
      managesTerminalSurfaces: managesTerminalSurfaces,
      spaceID: spaceID,
      zmxSessionsEnabled: false,
      licenseTabGate: gate
    )
    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
    let windowControllerID = UUID()
    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: windowControllerID,
      store: store,
      terminal: host,
      requestConfirmedWindowClose: {}
    )
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)
    return RegisteredHost(host: host, window: window)
  }
}

@MainActor
private struct GateHarness {
  let host: TerminalHostState
  let space: TerminalSpaceItem
}

@MainActor
private struct RegisteredHost {
  let host: TerminalHostState
  let window: NSWindow
}
