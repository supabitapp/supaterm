#if SUPATERM_DEMO
  import Foundation
  import Sharing
  import SupatermCLIShared
  import SupatermSupport

  @MainActor
  enum DemoSeed {
    static func seedCatalogs() {
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      @Shared(.terminalSessionCatalog) var sessionCatalog = TerminalSessionCatalog.default
      @Shared(.supatermSettings) var settings = SupatermSettings.default

      prepareWorkspaceDirectories()
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(
          defaultSelectedSpaceID: IDs.space,
          spaces: [
            PersistedTerminalSpace(id: IDs.space, name: "Supaterm")
          ]
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
        ReleaseAnnouncementStorageState(
          acknowledgedVersion: AppBuild.version
        )
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

    private static let nodes = [
      groupNode(IDs.developmentGroup, isPinned: true, order: 0),
      groupedTabNode(IDs.macTab, groupID: IDs.developmentGroup, order: 0),
      groupedTabNode(IDs.webTab, groupID: IDs.developmentGroup, order: 1),
      groupedTabNode(IDs.apiTab, groupID: IDs.developmentGroup, order: 2),
      rootTabNode(IDs.docsTab, isPinned: false, order: 0),
      groupNode(IDs.productGroup, isPinned: false, order: 1),
      groupedTabNode(IDs.roadmapTab, groupID: IDs.productGroup, order: 0),
      groupedTabNode(IDs.designTab, groupID: IDs.productGroup, order: 1),
      rootTabNode(IDs.scratchTab, isPinned: false, order: 2),
      groupNode(IDs.operationsGroup, isPinned: false, order: 3),
      groupedTabNode(IDs.deployTab, groupID: IDs.operationsGroup, order: 0),
      groupedTabNode(IDs.monitoringTab, groupID: IDs.operationsGroup, order: 1),
      groupedTabNode(IDs.databaseTab, groupID: IDs.operationsGroup, order: 2),
      groupNode(IDs.researchGroup, isPinned: false, order: 4),
      groupedTabNode(IDs.prototypeTab, groupID: IDs.researchGroup, order: 0),
      groupedTabNode(IDs.benchmarksTab, groupID: IDs.researchGroup, order: 1),
      rootTabNode(IDs.playgroundTab, isPinned: false, order: 5),
    ]

    private static let groups = [
      TerminalTabGroupSession(
        id: IDs.developmentGroup,
        title: "Development",
        color: .blue,
        lifetime: .automatic
      ),
      TerminalTabGroupSession(
        id: IDs.productGroup,
        title: "Product",
        color: .pink,
        lifetime: .automatic
      ),
      TerminalTabGroupSession(
        id: IDs.operationsGroup,
        title: "Operations",
        color: .orange,
        lifetime: .automatic
      ),
      TerminalTabGroupSession(
        id: IDs.researchGroup,
        title: "Research",
        color: .green,
        lifetime: .automatic
      ),
    ]

    private static let tabSessions = [
      macSession,
      webSession,
      apiSession,
      docsSession,
      roadmapSession,
      designSession,
      scratchSession,
      deploySession,
      monitoringSession,
      databaseSession,
      prototypeSession,
      benchmarksSession,
      playgroundSession,
    ]

    private static let macSession = leafSession(
      id: IDs.macTab,
      title: "supaterm/mac",
      directory: "mac",
      surfaceID: IDs.macSurface
    )

    private static let webSession = TerminalTabSession(
      id: IDs.webTab,
      lockedTitle: "supaterm/web",
      focusedPaneIndex: 0,
      root: .split(
        TerminalPaneSplitSession(
          direction: .horizontal,
          ratio: 0.58,
          left: .leaf(
            TerminalPaneLeafSession(
              id: IDs.webAgentSurface,
              workingDirectoryPath: workingDirectoryPath("web"),
              titleOverride: "supaterm/web"
            )
          ),
          right: .leaf(
            TerminalPaneLeafSession(
              id: IDs.webShellSurface,
              workingDirectoryPath: workingDirectoryPath("web"),
              titleOverride: "shell"
            )
          )
        )
      )
    )

    private static let apiSession = leafSession(
      id: IDs.apiTab,
      title: "supaterm/api",
      directory: "api",
      surfaceID: IDs.apiSurface
    )

    private static let docsSession = leafSession(
      id: IDs.docsTab,
      title: "docs",
      directory: "docs",
      surfaceID: IDs.docsSurface
    )

    private static let roadmapSession = leafSession(
      id: IDs.roadmapTab,
      title: "roadmap",
      directory: "roadmap",
      surfaceID: IDs.roadmapSurface
    )

    private static let designSession = leafSession(
      id: IDs.designTab,
      title: "design system",
      directory: "design",
      surfaceID: IDs.designSurface
    )

    private static let scratchSession = leafSession(
      id: IDs.scratchTab,
      title: "scratch",
      directory: "scratch",
      surfaceID: IDs.scratchSurface
    )

    private static let deploySession = leafSession(
      id: IDs.deployTab,
      title: "supaterm/deploy",
      directory: "deploy",
      surfaceID: IDs.deploySurface
    )

    private static let monitoringSession = leafSession(
      id: IDs.monitoringTab,
      title: "observability",
      directory: "monitoring",
      surfaceID: IDs.monitoringSurface
    )

    private static let databaseSession = leafSession(
      id: IDs.databaseTab,
      title: "database",
      directory: "database",
      surfaceID: IDs.databaseSurface
    )

    private static let prototypeSession = leafSession(
      id: IDs.prototypeTab,
      title: "prototypes",
      directory: "prototypes",
      surfaceID: IDs.prototypeSurface
    )

    private static let benchmarksSession = leafSession(
      id: IDs.benchmarksTab,
      title: "benchmarks",
      directory: "benchmarks",
      surfaceID: IDs.benchmarksSurface
    )

    private static let playgroundSession = leafSession(
      id: IDs.playgroundTab,
      title: "playground",
      directory: "playground",
      surfaceID: IDs.playgroundSurface
    )

    private static func groupNode(
      _ groupID: TerminalTabGroupID,
      isPinned: Bool,
      order: Int
    ) -> TerminalTabNodeSession {
      TerminalTabNodeSession(
        item: .group(groupID),
        parent: .root(isPinned: isPinned),
        order: order
      )
    }

    private static func groupedTabNode(
      _ tabID: TerminalTabID,
      groupID: TerminalTabGroupID,
      order: Int
    ) -> TerminalTabNodeSession {
      TerminalTabNodeSession(
        item: .tab(tabID),
        parent: .group(groupID),
        order: order
      )
    }

    private static func rootTabNode(
      _ tabID: TerminalTabID,
      isPinned: Bool,
      order: Int
    ) -> TerminalTabNodeSession {
      TerminalTabNodeSession(
        item: .tab(tabID),
        parent: .root(isPinned: isPinned),
        order: order
      )
    }

    private static func leafSession(
      id: TerminalTabID,
      title: String,
      directory: String,
      surfaceID: UUID
    ) -> TerminalTabSession {
      TerminalTabSession(
        id: id,
        lockedTitle: title,
        focusedPaneIndex: 0,
        root: .leaf(
          TerminalPaneLeafSession(
            id: surfaceID,
            workingDirectoryPath: workingDirectoryPath(directory),
            titleOverride: title
          )
        )
      )
    }

    private static func prepareWorkspaceDirectories() {
      for directory in workspaceDirectoryNames {
        try? FileManager.default.createDirectory(
          at: workspaceRoot.appendingPathComponent(directory, isDirectory: true),
          withIntermediateDirectories: true
        )
      }
    }

    private static func workingDirectoryPath(_ name: String) -> String {
      workspaceRoot.appendingPathComponent(name, isDirectory: true).path
    }

    private static let workspaceDirectoryNames = [
      "api",
      "benchmarks",
      "database",
      "deploy",
      "design",
      "docs",
      "mac",
      "monitoring",
      "playground",
      "prototypes",
      "roadmap",
      "scratch",
      "web",
    ]

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
