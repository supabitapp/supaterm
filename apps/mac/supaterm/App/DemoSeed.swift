#if SUPATERM_DEMO
  import Foundation
  import Sharing
  import SupaTheme
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

      func session(
        projectID: TerminalProjectID?,
        isPinned: Bool
      ) -> TerminalTabSession {
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
          projectID: projectID,
          isPinned: isPinned,
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

    private struct ProjectSeed {
      let id: TerminalProjectID
      let name: String
      let color: ThemeTint
      let isPinned: Bool
      let tabs: [TabSeed]

      var project: TerminalProject {
        TerminalProject(id: id, name: name, color: color, isPinned: isPinned)
      }
    }

    private enum RootSeed {
      case tab(TabSeed, isPinned: Bool)
      case project(ProjectSeed)

      var tabs: [TabSeed] {
        switch self {
        case .tab(let tab, _): [tab]
        case .project(let project): project.tabs
        }
      }

      var sessions: [TerminalTabSession] {
        switch self {
        case .tab(let tab, let isPinned):
          [tab.session(projectID: nil, isPinned: isPinned)]
        case .project(let project):
          project.tabs.map { $0.session(projectID: project.id, isPinned: false) }
        }
      }

      var project: TerminalProject? {
        guard case .project(let project) = self else { return nil }
        return project.project
      }
    }

    private struct SpaceSeed {
      let id: TerminalSpaceID
      let name: String
      let color: ThemeTint
      let selectedTabID: TerminalTabID
      var collapsedProjectIDs: [TerminalProjectID] = []
      let roots: [RootSeed]

      var item: TerminalSpaceItem {
        TerminalSpaceItem(id: id, name: name, color: color)
      }

      var session: TerminalSpaceSession {
        TerminalSpaceSession(
          spaceID: id,
          selectedTabID: selectedTabID,
          collapsedProjectIDs: collapsedProjectIDs,
          tabs: roots.flatMap(\.sessions)
        )
      }

      var tabs: [TabSeed] {
        roots.flatMap(\.tabs)
      }
      var projects: [TerminalProject] {
        roots.compactMap(\.project)
      }
    }

    static func seedCatalogs() {
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      @Shared(.terminalProjectCatalog) var projectCatalog = TerminalProjectCatalog.default
      @Shared(.terminalSessionCatalog) var sessionCatalog = TerminalSessionCatalog.default
      @Shared(.supatermSettings) var settings = SupatermSettings.default

      prepareWorkspaceDirectories()
      guard
        let seededProjectCatalog = try? TerminalProjectCatalog(
          projects: spaces.flatMap(\.projects)
        ).validated()
      else {
        preconditionFailure("Invalid demo Project catalog")
      }
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(
          defaultSelectedSpaceID: IDs.supatermSpace,
          spaces: spaces.map(\.item)
        )
      }
      $projectCatalog.withLock {
        $0 = seededProjectCatalog
      }
      $sessionCatalog.withLock {
        $0 = TerminalSessionCatalog(
          windows: [
            TerminalWindowSession(
              displayedSpaceID: IDs.supatermSpace,
              spaces: spaces.map(\.session)
            )
          ]
        )
      }
      $settings.withLock {
        $0.restoreTerminalLayoutEnabled = true
        $0.codingAgentsShowPanel = true
        $0.zmxSessionsEnabled = false
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

    private static let spaces: [SpaceSeed] = [supatermSpace, infrastructureSpace, personalSpace]

    private static let supatermSpace = SpaceSeed(
      id: IDs.supatermSpace,
      name: "Supaterm",
      color: .blue,
      selectedTabID: IDs.deployTab,
      collapsedProjectIDs: [IDs.researchProject],
      roots: [
        .project(
          ProjectSeed(
            id: IDs.developmentProject,
            name: "Development",
            color: .blue,
            isPinned: true,
            tabs: [
              TabSeed(id: IDs.macTab, title: "Supaterm/mac", directory: "mac", pane: .leaf(IDs.macSurface)),
              TabSeed(
                id: IDs.webTab,
                title: "Supaterm/web",
                directory: "web",
                pane: .split(IDs.webAgentSurface, IDs.webShellSurface)
              ),
              TabSeed(id: IDs.apiTab, title: "Supaterm/api", directory: "api", pane: .leaf(IDs.apiSurface)),
            ]
          )
        ),
        .tab(TabSeed(id: IDs.docsTab, title: "docs", directory: "docs", pane: .leaf(IDs.docsSurface)), isPinned: false),
        .project(
          ProjectSeed(
            id: IDs.productProject,
            name: "Product",
            color: .pink,
            isPinned: false,
            tabs: [
              TabSeed(id: IDs.roadmapTab, title: "roadmap", directory: "roadmap", pane: .leaf(IDs.roadmapSurface)),
              TabSeed(id: IDs.designTab, title: "design system", directory: "design", pane: .leaf(IDs.designSurface)),
            ]
          )
        ),
        .tab(
          TabSeed(id: IDs.scratchTab, title: "scratch", directory: "scratch", pane: .leaf(IDs.scratchSurface)),
          isPinned: false),
        .project(
          ProjectSeed(
            id: IDs.operationsProject,
            name: "Operations",
            color: .orange,
            isPinned: false,
            tabs: [
              TabSeed(id: IDs.deployTab, title: "Supaterm/deploy", directory: "deploy", pane: .leaf(IDs.deploySurface)),
              TabSeed(
                id: IDs.monitoringTab,
                title: "observability",
                directory: "monitoring",
                pane: .leaf(IDs.monitoringSurface)
              ),
              TabSeed(id: IDs.databaseTab, title: "database", directory: "database", pane: .leaf(IDs.databaseSurface)),
            ]
          )
        ),
        .project(
          ProjectSeed(
            id: IDs.researchProject,
            name: "Research",
            color: .green,
            isPinned: false,
            tabs: [
              TabSeed(
                id: IDs.prototypeTab, title: "prototypes", directory: "prototypes", pane: .leaf(IDs.prototypeSurface)),
              TabSeed(
                id: IDs.benchmarksTab, title: "benchmarks", directory: "benchmarks", pane: .leaf(IDs.benchmarksSurface)
              ),
            ]
          )
        ),
        .tab(
          TabSeed(
            id: IDs.playgroundTab, title: "playground", directory: "playground", pane: .leaf(IDs.playgroundSurface)),
          isPinned: false),
      ]
    )

    private static let infrastructureSpace = SpaceSeed(
      id: IDs.infrastructureSpace,
      name: "Infrastructure",
      color: .orange,
      selectedTabID: IDs.stagingTab,
      roots: [
        .project(
          ProjectSeed(
            id: IDs.clustersProject,
            name: "Clusters",
            color: .green,
            isPinned: true,
            tabs: [
              TabSeed(id: IDs.stagingTab, title: "staging", directory: "staging", pane: .leaf(IDs.stagingSurface)),
              TabSeed(
                id: IDs.productionTab,
                title: "production",
                directory: "production",
                pane: .split(IDs.productionSurface, IDs.productionShellSurface)
              ),
            ]
          )
        ),
        .tab(
          TabSeed(id: IDs.terraformTab, title: "terraform", directory: "terraform", pane: .leaf(IDs.terraformSurface)),
          isPinned: false),
        .tab(
          TabSeed(id: IDs.runbooksTab, title: "runbooks", directory: "runbooks", pane: .leaf(IDs.runbooksSurface)),
          isPinned: false),
      ]
    )

    private static let personalSpace = SpaceSeed(
      id: IDs.personalSpace,
      name: "Personal",
      color: .purple,
      selectedTabID: IDs.notesTab,
      roots: [
        .tab(
          TabSeed(id: IDs.dotfilesTab, title: "dotfiles", directory: "dotfiles", pane: .leaf(IDs.dotfilesSurface)),
          isPinned: true),
        .tab(
          TabSeed(id: IDs.notesTab, title: "notes", directory: "notes", pane: .leaf(IDs.notesSurface)),
          isPinned: false),
        .tab(TabSeed(id: IDs.blogTab, title: "blog", directory: "blog", pane: .leaf(IDs.blogSurface)), isPinned: false),
      ]
    )

    private static func prepareWorkspaceDirectories() {
      for directory in Set(spaces.flatMap(\.tabs).map(\.directory)) {
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
      static let supatermSpace = TerminalSpaceID(rawValue: uuid(1))

      static let developmentProject = TerminalProjectID(rawValue: uuid(10))
      static let productProject = TerminalProjectID(rawValue: uuid(11))
      static let operationsProject = TerminalProjectID(rawValue: uuid(12))
      static let researchProject = TerminalProjectID(rawValue: uuid(13))

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

      static let infrastructureSpace = TerminalSpaceID(rawValue: uuid(101))

      static let clustersProject = TerminalProjectID(rawValue: uuid(110))

      static let stagingTab = TerminalTabID(rawValue: uuid(120))
      static let productionTab = TerminalTabID(rawValue: uuid(121))
      static let terraformTab = TerminalTabID(rawValue: uuid(122))
      static let runbooksTab = TerminalTabID(rawValue: uuid(123))

      static let stagingSurface = uuid(140)
      static let productionSurface = uuid(141)
      static let productionShellSurface = uuid(142)
      static let terraformSurface = uuid(143)
      static let runbooksSurface = uuid(144)

      static let personalSpace = TerminalSpaceID(rawValue: uuid(201))

      static let dotfilesTab = TerminalTabID(rawValue: uuid(220))
      static let notesTab = TerminalTabID(rawValue: uuid(221))
      static let blogTab = TerminalTabID(rawValue: uuid(222))

      static let dotfilesSurface = uuid(240)
      static let notesSurface = uuid(241)
      static let blogSurface = uuid(242)

      private static func uuid(_ value: Int) -> UUID {
        let suffix = String(value, radix: 16)
        let padding = String(repeating: "0", count: 12 - suffix.count)
        return UUID(uuidString: "00000000-0000-4000-8000-\(padding)\(suffix)")!
      }
    }
  }
#endif
