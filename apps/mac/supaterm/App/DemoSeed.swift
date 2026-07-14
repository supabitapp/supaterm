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
      @Shared(.terminalPinnedTabCatalog) var pinnedTabCatalog = TerminalPinnedTabCatalog.default
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
                  selectedTabIndex: 1,
                  selectedPinnedTabID: nil,
                  tabs: [
                    deploySession,
                    scratchSession,
                  ]
                )
              ]
            )
          ]
        )
      }
      $pinnedTabCatalog.withLock {
        $0 = TerminalPinnedTabCatalog(
          spaces: [
            PersistedPinnedTerminalTabsForSpace(
              id: IDs.space,
              tabs: [
                PersistedPinnedTerminalTab(id: IDs.webTab, session: webSession),
                PersistedPinnedTerminalTab(id: IDs.apiTab, session: apiSession),
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

    private static let webSession = TerminalTabSession(
      isPinned: true,
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

    private static let apiSession = TerminalTabSession(
      isPinned: true,
      lockedTitle: "supaterm/api",
      focusedPaneIndex: 0,
      root: .leaf(
        TerminalPaneLeafSession(
          id: IDs.apiSurface,
          workingDirectoryPath: workingDirectoryPath("api"),
          titleOverride: "supaterm/api"
        )
      )
    )

    private static let deploySession = TerminalTabSession(
      isPinned: false,
      lockedTitle: "supaterm/deploy",
      focusedPaneIndex: 0,
      root: .leaf(
        TerminalPaneLeafSession(
          id: IDs.deploySurface,
          workingDirectoryPath: workingDirectoryPath("deploy"),
          titleOverride: "supaterm/deploy"
        )
      )
    )

    private static let scratchSession = TerminalTabSession(
      isPinned: false,
      lockedTitle: "scratch",
      focusedPaneIndex: 0,
      root: .leaf(
        TerminalPaneLeafSession(
          id: IDs.scratchSurface,
          workingDirectoryPath: workingDirectoryPath("scratch"),
          titleOverride: "scratch"
        )
      )
    )

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
      "web",
      "api",
      "deploy",
      "scratch",
    ]

    private static let workspaceRoot =
      FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("dev", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)

    private enum IDs {
      static let space = TerminalSpaceID(rawValue: UUID(uuidString: "4F9DA8C0-7B80-42C4-A828-B7A7E4E1D3A1")!)
      static let webTab = TerminalTabID(rawValue: UUID(uuidString: "F4218391-DB8F-43DD-830C-B63D6F877D81")!)
      static let apiTab = TerminalTabID(rawValue: UUID(uuidString: "85F58292-F7C3-47DB-89D7-B96DCC6A2771")!)
      static let webAgentSurface = UUID(uuidString: "8F02B7F2-4F60-465B-90DF-14C03BF6D482")!
      static let webShellSurface = UUID(uuidString: "F6D8226D-0C92-40D4-B5E8-52B3E850D675")!
      static let apiSurface = UUID(uuidString: "C095C9A1-7E44-4BD2-A9F5-7F322221B495")!
      static let deploySurface = UUID(uuidString: "E6BD77C4-835A-4F9B-9953-8B5A44A124B5")!
      static let scratchSurface = UUID(uuidString: "0AF060BC-0F4B-4D18-86DF-C74F268040C8")!
    }
  }
#endif
