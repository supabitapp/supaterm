import AppKit
import ComposableArchitecture
import Foundation
import Sharing
import Testing

@testable import SupatermLicenseFeature
@testable import SupatermSupport
@testable import SupatermTerminalCore
@testable import supaterm

@MainActor
struct LicenseTabGateTests {
  @Test
  func defaultGateEnforcesTheFreeLimit() {
    let gate = LicenseTabGate(licenseAccess: { .free })

    #expect(
      gate.refusal(for: .user, openTabs: 5)
        == LicenseTabGate.Refusal(limit: 5, openTabs: 5)
    )
  }

  #if DEBUG
    @Test
    func e2eHarnessOnlyEnforcesWhenTestingTheFreeLimit() {
      #expect(LicenseTabGate.enforcementEnabled(environment: [:]))
      #expect(
        !LicenseTabGate.enforcementEnabled(environment: ["SUPATERM_TEST_MODE": "1"])
      )
      #expect(
        LicenseTabGate.enforcementEnabled(
          environment: [
            "SUPATERM_LICENSE_MODE": "free",
            "SUPATERM_TEST_MODE": "1",
          ]
        )
      )
    }
  #endif

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
  func dismissesTabLimitRefusal() throws {
    try withGateHarness { harness in
      for _ in 0..<5 {
        _ = try harness.host.createTab(in: harness.space.id, reason: .restore)
      }
      #expect(throws: TerminalCreateTabError.tabLimitReached(limit: 5, openTabs: 5)) {
        _ = try harness.host.createTab(in: harness.space.id, reason: .user)
      }

      harness.host.dismissLicenseTabLimitRefusal()

      #expect(!harness.host.showsLicenseTabLimitRefusal)
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
      let registry = TerminalWindowRegistry.test()
      let gate = freeGate()
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

      #expect(
        gate.refusal(for: .user, openTabs: registry.licenseTabCount)
          == LicenseTabGate.Refusal(limit: 5, openTabs: 5)
      )
      withExtendedLifetime([first.window, second.window]) {}
    }
  }

  @Test
  func countIncludesRegisteredHostsBeforeTheirWindowsConnect() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let space = TerminalSpaceItem(name: "Main")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
      }
      let registry = TerminalWindowRegistry.test()
      let gate = freeGate()
      let registered = registerHost(
        in: registry,
        gate: gate,
        spaceID: space.id,
        managesTerminalSurfaces: false,
        connectsWindow: false
      )
      for index in 0..<5 {
        _ = registered.host.spaceManager.displayedInstance.tabCollection.createTab(
          title: "Tab \(index)"
        )
      }

      #expect(
        gate.refusal(for: .user, openTabs: registry.licenseTabCount)
          == LicenseTabGate.Refusal(limit: 5, openTabs: 5)
      )
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
      let registry = TerminalWindowRegistry.test()
      let gate = freeGate()
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
      let registry = TerminalWindowRegistry.test()
      let gate = freeGate()
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
      let registry = TerminalWindowRegistry.test()
      let gate = freeGate()
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
      let registry = TerminalWindowRegistry.test()
      let host = registerHost(
        in: registry,
        gate: .unrestricted,
        spaceID: space.id,
        managesTerminalSurfaces: false
      )
      for index in 0..<5 {
        _ = host.host.spaceManager.displayedInstance.tabCollection.createTab(title: "Tab \(index)")
      }
      let updatesThrough = try #require(LicenseDay("2025-01-01"))
      let paid = LicenseTabGate(
        licenseAccess: {
          .paid(LicenseOwnership(licenseID: "license", updatesThrough: updatesThrough))
        },
        enforcementEnabled: true
      )
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
      let ownedRelease = LicenseAccess(entitlement: entitlement, releaseDay: releaseDay)
      let owned = LicenseTabGate(
        licenseAccess: { ownedRelease },
        enforcementEnabled: true
      )

      #expect(paid.refusal(for: .user, openTabs: registry.licenseTabCount) == nil)
      #expect(ownedRelease.permitsPaidUse)
      #expect(owned.refusal(for: .user, openTabs: registry.licenseTabCount) == nil)
      withExtendedLifetime(host.window) {}
    }
  }

  @Test
  func registryWiresBothRefusalActions() {
    var actions: [LicenseTabLimitAction] = []
    let registry = TerminalWindowRegistry.test {
      actions.append($0)
    }
    let host = registerHost(
      in: registry,
      gate: .unrestricted,
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
      let registry = TerminalWindowRegistry.test()
      let gate = freeGate()
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

  private func freeGate() -> LicenseTabGate {
    LicenseTabGate(
      licenseAccess: { .free },
      enforcementEnabled: true
    )
  }

  private func registerHost(
    in registry: TerminalWindowRegistry,
    gate: LicenseTabGate,
    spaceID: TerminalSpaceID,
    managesTerminalSurfaces: Bool = true,
    connectsWindow: Bool = true
  ) -> RegisteredHost {
    let host = TerminalHostState.test(
      managesTerminalSurfaces: managesTerminalSurfaces,
      spaceID: spaceID,
      zmxSessionsEnabled: false,
      licenseTabGate: gate,
      licenseOpenTabCount: { [weak registry] in
        registry?.licenseTabCount ?? LicenseTabGate.tabLimit
      }
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
    let window = connectsWindow ? makeWindow() : nil
    if let window {
      registry.updateWindow(window, for: windowControllerID)
    }
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
  let window: NSWindow?
}
