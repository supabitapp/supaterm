#if SUPATERM_DEMO
  import Foundation
  import Sharing
  import SupatermCLIShared
  import SupatermSupport

  @MainActor
  enum DemoSeed {
    private enum PaneSeed {
      case leaf(UUID)
      case split(UUID, UUID)
    }

    private struct TabSeed {
      let id: TerminalTabID
      let title: String
      let directory: String
      let pane: PaneSeed

      var session: TerminalTabSession {
        let root: TerminalPaneNodeSession
        switch pane {
        case .leaf(let surfaceID):
          root = .leaf(leaf(surfaceID, title: title))
        case .split(let primarySurfaceID, let secondarySurfaceID):
          root = .split(
            TerminalPaneSplitSession(
              direction: .horizontal,
              ratio: 0.58,
              left: .leaf(leaf(primarySurfaceID, title: title)),
              right: .leaf(leaf(secondarySurfaceID, title: "shell"))
            )
          )
        }
        return TerminalTabSession(
          id: id,
          lockedTitle: title,
          focusedPaneIndex: 0,
          root: root
        )
      }

      private func leaf(_ surfaceID: UUID, title: String) -> TerminalPaneLeafSession {
        TerminalPaneLeafSession(
          id: surfaceID,
          workingDirectoryPath: workingDirectoryPath(directory),
          titleOverride: title
        )
      }
    }

    private struct GroupSeed {
      let id: TerminalTabGroupID
      let title: String
      let color: TerminalTabGroupColor
      let tabs: [TabSeed]
    }

    private enum RootSeed {
      case tab(TabSeed, isPinned: Bool)
      case group(GroupSeed, isPinned: Bool)

      var isPinned: Bool {
        switch self {
        case .tab(_, let isPinned), .group(_, let isPinned): isPinned
        }
      }

      var tabs: [TabSeed] {
        switch self {
        case .tab(let tab, _): [tab]
        case .group(let group, _): group.tabs
        }
      }

      func nodes(rootOrder: Int) -> [TerminalTabNodeSession] {
        switch self {
        case .tab(let tab, let isPinned):
          return [
            TerminalTabNodeSession(
              item: .tab(tab.id),
              parent: .root(isPinned: isPinned),
              order: rootOrder
            )
          ]
        case .group(let group, let isPinned):
          return [
            TerminalTabNodeSession(
              item: .group(group.id),
              parent: .root(isPinned: isPinned),
              order: rootOrder
            )
          ]
            + group.tabs.enumerated().map { order, tab in
              TerminalTabNodeSession(
                item: .tab(tab.id),
                parent: .group(group.id),
                order: order
              )
            }
        }
      }
    }

    static func seedCatalogs() {
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      @Shared(.terminalSessionCatalog) var sessionCatalog = TerminalSessionCatalog.default
      @Shared(.supatermSettings) var settings = SupatermSettings.default

      prepareWorkspaceDirectories()
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(
          defaultSelectedSpaceID: IDs.space,
          spaces: [PersistedTerminalSpace(id: IDs.space, name: "Supaterm")]
        )
      }
      $sessionCatalog.withLock {
        $0 = TerminalSessionCatalog(
          windows: [
            TerminalWindowSession(
              selectedSpaceID: IDs.space,
              spaces: [
                TerminalWindowSpaceSession(
                  id: IDs.space,
                  selectedTabID: IDs.deployTab,
                  nodes: nodes,
                  groups: groups,
                  collapsedGroupIDs: [IDs.researchGroup],
                  tabs: tabSessions
                )
              ]
            )
          ]
        )
      }
      $settings.withLock {
        $0.restoreTerminalLayoutEnabled = true
        $0.codingAgentsShowPanel = true
      }
      ReleaseAnnouncementStorage.save(
        ReleaseAnnouncementStorageState(acknowledgedVersion: AppBuild.version)
      )
    }

    static func decorate(_ terminals: [TerminalHostState]) {
      for terminal in terminals {
        terminal.demoInjectRunningAgent(
          kind: .codex,
          surfaceID: IDs.webAgentSurface,
          detail: "Reviewing tab restore",
          sessionID: "019b1fd8-49f5-7b72-a4e4-62f59f9c7d21"
        )
        terminal.demoInjectRunningAgent(
          kind: .claude,
          surfaceID: IDs.webShellSurface,
          detail: "Refining sidebar states",
          sessionID: "demo-web-shell"
        )
        terminal.demoInjectRichPanel(surfaceID: IDs.webAgentSurface)
        terminal.demoInjectRunningAgent(
          kind: .codex,
          surfaceID: IDs.apiSurface,
          detail: "Refreshing API routes",
          sessionID: "demo-api"
        )
        terminal.demoInjectNeedsInputAgent(
          kind: .pi,
          surfaceID: IDs.deploySurface,
          detail: "Waiting for approval",
          sessionID: "demo-deploy"
        )
        terminal.demoInjectNotification(surfaceID: IDs.deploySurface)
      }
    }

    static func preservesSeededAgentState(_ surfaceID: UUID) -> Bool {
      seededAgentSurfaceIDs.contains(surfaceID)
    }

    private static let seededAgentSurfaceIDs: Set<UUID> = [
      IDs.webAgentSurface,
      IDs.webShellSurface,
      IDs.apiSurface,
      IDs.deploySurface,
    ]

    private static var nodes: [TerminalTabNodeSession] {
      var laneOrders = [true: 0, false: 0]
      return roots.flatMap { root in
        let order = laneOrders[root.isPinned, default: 0]
        laneOrders[root.isPinned] = order + 1
        return root.nodes(rootOrder: order)
      }
    }

    private static var groups: [TerminalTabGroupSession] {
      roots.compactMap { root in
        guard case .group(let group, _) = root else { return nil }
        return TerminalTabGroupSession(
          id: group.id,
          title: group.title,
          color: group.color,
          lifetime: .automatic
        )
      }
    }

    private static var tabSessions: [TerminalTabSession] {
      roots.flatMap(\.tabs).map(\.session)
    }

    private static let roots: [RootSeed] = [
      .group(
        GroupSeed(
          id: IDs.developmentGroup,
          title: "Development",
          color: .blue,
          tabs: [
            TabSeed(id: IDs.macTab, title: "supaterm/mac", directory: "mac", pane: .leaf(IDs.macSurface)),
            TabSeed(
              id: IDs.webTab,
              title: "supaterm/web",
              directory: "web",
              pane: .split(IDs.webAgentSurface, IDs.webShellSurface)
            ),
            TabSeed(id: IDs.apiTab, title: "supaterm/api", directory: "api", pane: .leaf(IDs.apiSurface)),
          ]
        ),
        isPinned: true
      ),
      .tab(TabSeed(id: IDs.docsTab, title: "docs", directory: "docs", pane: .leaf(IDs.docsSurface)), isPinned: false),
      .group(
        GroupSeed(
          id: IDs.productGroup,
          title: "Product",
          color: .pink,
          tabs: [
            TabSeed(id: IDs.roadmapTab, title: "roadmap", directory: "roadmap", pane: .leaf(IDs.roadmapSurface)),
            TabSeed(id: IDs.designTab, title: "design system", directory: "design", pane: .leaf(IDs.designSurface)),
          ]
        ),
        isPinned: false
      ),
      .tab(
        TabSeed(id: IDs.scratchTab, title: "scratch", directory: "scratch", pane: .leaf(IDs.scratchSurface)),
        isPinned: false),
      .group(
        GroupSeed(
          id: IDs.operationsGroup,
          title: "Operations",
          color: .orange,
          tabs: [
            TabSeed(id: IDs.deployTab, title: "supaterm/deploy", directory: "deploy", pane: .leaf(IDs.deploySurface)),
            TabSeed(
              id: IDs.monitoringTab, title: "observability", directory: "monitoring", pane: .leaf(IDs.monitoringSurface)
            ),
            TabSeed(id: IDs.databaseTab, title: "database", directory: "database", pane: .leaf(IDs.databaseSurface)),
          ]
        ),
        isPinned: false
      ),
      .group(
        GroupSeed(
          id: IDs.researchGroup,
          title: "Research",
          color: .green,
          tabs: [
            TabSeed(
              id: IDs.prototypeTab, title: "prototypes", directory: "prototypes", pane: .leaf(IDs.prototypeSurface)),
            TabSeed(
              id: IDs.benchmarksTab, title: "benchmarks", directory: "benchmarks", pane: .leaf(IDs.benchmarksSurface)),
          ]
        ),
        isPinned: false
      ),
      .tab(
        TabSeed(
          id: IDs.playgroundTab, title: "playground", directory: "playground", pane: .leaf(IDs.playgroundSurface)),
        isPinned: false),
    ]

    private static func prepareWorkspaceDirectories() {
      for directory in Set(roots.flatMap(\.tabs).map(\.directory)) {
        try? FileManager.default.createDirectory(
          at: workspaceRoot.appendingPathComponent(directory, isDirectory: true),
          withIntermediateDirectories: true
        )
      }
    }

    private static func workingDirectoryPath(_ name: String) -> String {
      workspaceRoot.appendingPathComponent(name, isDirectory: true).path
    }

    private static let workspaceRoot =
      FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("dev", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)

    private enum IDs {
      static let space = TerminalSpaceID(rawValue: uuid(1))

      static let developmentGroup = TerminalTabGroupID(rawValue: uuid(10))
      static let productGroup = TerminalTabGroupID(rawValue: uuid(11))
      static let operationsGroup = TerminalTabGroupID(rawValue: uuid(12))
      static let researchGroup = TerminalTabGroupID(rawValue: uuid(13))

      static let macTab = TerminalTabID(rawValue: uuid(20))
      static let webTab = TerminalTabID(rawValue: uuid(21))
      static let apiTab = TerminalTabID(rawValue: uuid(22))
      static let docsTab = TerminalTabID(rawValue: uuid(23))
      static let roadmapTab = TerminalTabID(rawValue: uuid(24))
      static let designTab = TerminalTabID(rawValue: uuid(25))
      static let scratchTab = TerminalTabID(rawValue: uuid(26))
      static let deployTab = TerminalTabID(rawValue: uuid(27))
      static let monitoringTab = TerminalTabID(rawValue: uuid(28))
      static let databaseTab = TerminalTabID(rawValue: uuid(29))
      static let prototypeTab = TerminalTabID(rawValue: uuid(30))
      static let benchmarksTab = TerminalTabID(rawValue: uuid(31))
      static let playgroundTab = TerminalTabID(rawValue: uuid(32))

      static let macSurface = uuid(40)
      static let webAgentSurface = uuid(41)
      static let webShellSurface = uuid(42)
      static let apiSurface = uuid(43)
      static let docsSurface = uuid(44)
      static let roadmapSurface = uuid(45)
      static let designSurface = uuid(46)
      static let scratchSurface = uuid(47)
      static let deploySurface = uuid(48)
      static let monitoringSurface = uuid(49)
      static let databaseSurface = uuid(50)
      static let prototypeSurface = uuid(51)
      static let benchmarksSurface = uuid(52)
      static let playgroundSurface = uuid(53)

      private static func uuid(_ value: Int) -> UUID {
        let suffix = String(value, radix: 16)
        let padding = String(repeating: "0", count: 12 - suffix.count)
        return UUID(uuidString: "00000000-0000-4000-8000-\(padding)\(suffix)")!
      }
    }
  }
#endif
