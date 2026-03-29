import Foundation
import Testing

@testable import supaterm

struct PersistedTerminalSessionStateTests {
  @Test
  func terminalTabIDRoundTripsThroughJSON() throws {
    let id = TerminalTabID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!)

    let data = try JSONEncoder().encode(id)
    let decoded = try JSONDecoder().decode(TerminalTabID.self, from: data)

    #expect(decoded == id)
  }

  @Test
  func persistedTerminalTabRoundTripsPaneSessionMetadata() throws {
    let paneID = UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!
    let tab = PersistedTerminalTab(
      title: "Build",
      icon: "hammer",
      isPinned: true,
      isTitleLocked: true,
      selectedPaneID: paneID,
      panes: [
        PersistedTerminalPane(
          id: paneID,
          sessionName: "ws-a/tab-build/pane-1",
          title: "shell",
          workingDirectoryPath: "/tmp/project",
          lastKnownRunning: true
        )
      ],
      splitTree: PersistedTerminalSplitTree(
        root: .leaf(paneID)
      )
    )

    let data = try JSONEncoder().encode(tab)
    let decoded = try JSONDecoder().decode(PersistedTerminalTab.self, from: data)

    #expect(decoded == tab)
  }

  @Test
  func workspaceStateCanProjectBackToCatalogWorkspace() {
    let workspaceID = TerminalWorkspaceID(rawValue: UUID(uuidString: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC")!)
    let workspace = PersistedTerminalWorkspaceState(
      id: workspaceID,
      name: "A"
    )

    #expect(workspace.catalogWorkspace == PersistedTerminalWorkspace(id: workspaceID, name: "A"))
  }

  @Test
  func sessionCatalogSanitizesWorkspaceNamesAndSelection() {
    let firstTabID = TerminalTabID(rawValue: UUID(uuidString: "DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD")!)
    let validWorkspace = PersistedTerminalWorkspaceState(
      id: TerminalWorkspaceID(rawValue: UUID(uuidString: "EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE")!),
      name: "  Build  ",
      tabs: [
        PersistedTerminalTab(
          id: firstTabID,
          title: "Build",
          selectedPaneID: UUID(uuidString: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF")!,
          panes: [
            PersistedTerminalPane(
              id: UUID(uuidString: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF")!,
              sessionName: "supaterm.build"
            )
          ],
          splitTree: .init(root: .leaf(UUID(uuidString: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF")!))
        )
      ],
      selectedTabID: TerminalTabID(rawValue: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!)
    )
    let catalog = PersistedTerminalSessionCatalog(
      defaultSelectedWorkspaceID: TerminalWorkspaceID(rawValue: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!),
      selectionUpdatedAt: 1,
      workspaces: [
        .init(name: "   "),
        validWorkspace,
      ]
    )

    let sanitized = PersistedTerminalSessionCatalog.sanitized(catalog)

    #expect(sanitized.workspaces.count == 1)
    #expect(sanitized.workspaces[0].name == "Build")
    #expect(sanitized.defaultSelectedWorkspaceID == sanitized.workspaces[0].id)
    #expect(sanitized.workspaces[0].selectedTabID == nil)
  }

  @Test
  func sessionCatalogMergePrefersNewerSelectionAndPreservesOlderWorkspace() {
    let baseWorkspaceID = TerminalWorkspaceID(
      rawValue: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!
    )
    let incomingWorkspaceID = TerminalWorkspaceID(
      rawValue: UUID(uuidString: "44444444-4444-4444-4444-444444444444")!
    )

    let merged = PersistedTerminalSessionCatalog.merged(
      base: PersistedTerminalSessionCatalog(
        defaultSelectedWorkspaceID: baseWorkspaceID,
        selectionUpdatedAt: 1,
        workspaces: [
          PersistedTerminalWorkspaceState(
            id: baseWorkspaceID,
            updatedAt: 10,
            name: "Base"
          )
        ]
      ),
      incoming: PersistedTerminalSessionCatalog(
        defaultSelectedWorkspaceID: incomingWorkspaceID,
        selectionUpdatedAt: 2,
        workspaces: [
          PersistedTerminalWorkspaceState(
            id: incomingWorkspaceID,
            updatedAt: 20,
            name: "Incoming"
          )
        ]
      )
    )

    #expect(merged.defaultSelectedWorkspaceID == incomingWorkspaceID)
    #expect(merged.workspaces.map(\.name) == ["Incoming", "Base"])
  }

  @Test
  func sessionCatalogMergeKeepsConcurrentPaneAdditionsAndNewestPaneFields() {
    let workspaceID = TerminalWorkspaceID(
      rawValue: UUID(uuidString: "55555555-5555-5555-5555-555555555555")!
    )
    let tabID = TerminalTabID(
      rawValue: UUID(uuidString: "66666666-6666-6666-6666-666666666666")!
    )
    let sharedPaneID = UUID(uuidString: "77777777-7777-7777-7777-777777777777")!
    let baseOnlyPaneID = UUID(uuidString: "88888888-8888-8888-8888-888888888888")!

    let merged = PersistedTerminalSessionCatalog.merged(
      base: PersistedTerminalSessionCatalog(
        defaultSelectedWorkspaceID: workspaceID,
        selectionUpdatedAt: 1,
        workspaces: [
          PersistedTerminalWorkspaceState(
            id: workspaceID,
            updatedAt: 10,
            name: "A",
            tabs: [
              PersistedTerminalTab(
                id: tabID,
                updatedAt: 10,
                title: "Build",
                selectedPaneID: sharedPaneID,
                panes: [
                  PersistedTerminalPane(
                    id: sharedPaneID,
                    sessionName: "supaterm.shared",
                    updatedAt: 10,
                    title: "old"
                  ),
                  PersistedTerminalPane(
                    id: baseOnlyPaneID,
                    sessionName: "supaterm.base-only",
                    updatedAt: 11,
                    title: "base"
                  ),
                ],
                splitTree: PersistedTerminalSplitTree(root: .leaf(sharedPaneID))
              )
            ],
            selectedTabID: tabID
          )
        ]
      ),
      incoming: PersistedTerminalSessionCatalog(
        defaultSelectedWorkspaceID: workspaceID,
        selectionUpdatedAt: 1,
        workspaces: [
          PersistedTerminalWorkspaceState(
            id: workspaceID,
            updatedAt: 12,
            name: "A",
            tabs: [
              PersistedTerminalTab(
                id: tabID,
                updatedAt: 12,
                title: "Build",
                selectedPaneID: sharedPaneID,
                panes: [
                  PersistedTerminalPane(
                    id: sharedPaneID,
                    sessionName: "supaterm.shared",
                    updatedAt: 12,
                    title: "new"
                  )
                ],
                splitTree: PersistedTerminalSplitTree(root: .leaf(sharedPaneID))
              )
            ],
            selectedTabID: tabID
          )
        ]
      )
    )

    let mergedTab = try! #require(merged.workspaces.first?.tabs.first)
    #expect(mergedTab.panes.map(\.id) == [sharedPaneID, baseOnlyPaneID])
    #expect(mergedTab.panes.first(where: { $0.id == sharedPaneID })?.title == "new")
  }

  @Test
  func sessionCatalogSanitizationDropsPaneWhenTombstoneIsNewerThanPane() {
    let workspaceID = TerminalWorkspaceID(
      rawValue: UUID(uuidString: "99999999-9999-9999-9999-999999999999")!
    )
    let tabID = TerminalTabID(
      rawValue: UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!
    )
    let paneID = UUID(uuidString: "12121212-3434-5656-7878-909090909090")!

    let sanitized = PersistedTerminalSessionCatalog.sanitized(
      PersistedTerminalSessionCatalog(
        defaultSelectedWorkspaceID: workspaceID,
        selectionUpdatedAt: 1,
        workspaces: [
          PersistedTerminalWorkspaceState(
            id: workspaceID,
            updatedAt: 1,
            name: "A",
            tabs: [
              PersistedTerminalTab(
                id: tabID,
                updatedAt: 1,
                title: "Build",
                selectedPaneID: paneID,
                panes: [
                  PersistedTerminalPane(
                    id: paneID,
                    sessionName: "supaterm.deleted",
                    updatedAt: 10
                  )
                ],
                splitTree: PersistedTerminalSplitTree(root: .leaf(paneID))
              )
            ],
            selectedTabID: tabID
          )
        ],
        paneTombstones: [
          PersistedTerminalPaneTombstone(id: paneID, deletedAt: 11)
        ]
      )
    )

    #expect(sanitized.workspaces.map(\.id) == [workspaceID])
    #expect(sanitized.workspaces[0].tabs.isEmpty)
  }
}
