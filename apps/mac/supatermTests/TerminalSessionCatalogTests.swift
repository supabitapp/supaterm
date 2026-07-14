import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

struct TerminalSessionCatalogTests {
  @Test
  func defaultURLUsesStateHomeWhenPresent() {
    #expect(
      TerminalSessionCatalog.defaultURL(
        homeDirectoryPath: "/tmp/ignored",
        environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
      ).path == "/tmp/supaterm-dev/session.json"
    )
  }

  @Test
  func catalogRejectsUnsupportedVersion() throws {
    let data = Data(#"{"version":999,"windows":[]}"#.utf8)

    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
    }
  }

  @Test
  func catalogRejectsPreviousVersion() {
    let data = Data(#"{"version":6,"windows":[]}"#.utf8)

    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
    }
  }

  @Test
  func windowSessionPrunesMissingSpacesAndFallsBackSelection() {
    let validSpace = TerminalSpaceID()
    let missingSpace = TerminalSpaceID()
    let session = TerminalWindowSession(
      selectedSpaceID: missingSpace,
      spaces: [
        TerminalWindowSpaceSession(
          id: missingSpace,
          selectedTabID: nil,
          projects: []
        ),
        TerminalWindowSpaceSession(
          id: validSpace,
          selectedTabID: nil,
          projects: []
        ),
      ]
    )

    let pruned = session.pruned(validSpaceIDs: [validSpace])

    #expect(pruned?.selectedSpaceID == validSpace)
    #expect(pruned?.spaces.map(\.id) == [validSpace])
  }

  @Test
  func pruningPreservesStableTabIDsAndValidCollapsedProjects() throws {
    let spaceID = TerminalSpaceID()
    let projectID = TerminalProjectID()
    let tabID = TerminalTabID()
    let removedProjectID = TerminalProjectID()
    let session = TerminalWindowSession(
      selectedSpaceID: spaceID,
      spaces: [
        TerminalWindowSpaceSession(
          id: spaceID,
          selectedTabID: tabID,
          projects: [
            TerminalWindowProjectSession(
              id: projectID,
              tabs: [
                PersistedTerminalTab(
                  id: tabID,
                  session: TerminalTabSession(
                    lockedTitle: "shell",
                    focusedPaneIndex: 0,
                    root: .leaf(TerminalPaneLeafSession(id: UUID(), workingDirectoryPath: nil))
                  )
                )
              ]
            )
          ]
        )
      ],
      collapsedProjectIDs: [projectID, removedProjectID]
    )

    let pruned = try #require(session.pruned(validSpaceIDs: [spaceID]))

    #expect(pruned.spaces[0].projects[0].tabs.map(\.id) == [tabID])
    #expect(pruned.spaces[0].selectedTabID == tabID)
    #expect(pruned.collapsedProjectIDs == [projectID])
  }

  @Test
  func tabSessionSanitizesSplitRatioAndFallsBackFocusedPaneIndex() throws {
    let session = TerminalTabSession(
      lockedTitle: "  ",
      focusedPaneIndex: 99,
      root: .split(
        TerminalPaneSplitSession(
          direction: .horizontal,
          ratio: 0,
          left: .leaf(TerminalPaneLeafSession(workingDirectoryPath: "/tmp", titleOverride: "  ")),
          right: .leaf(TerminalPaneLeafSession(workingDirectoryPath: "/var"))
        )
      )
    )

    let pruned = try #require(session.pruned())
    guard case .split(let split) = pruned.root else {
      Issue.record("Expected split root")
      return
    }

    #expect(split.ratio == 0.5)
    #expect(pruned.lockedTitle == "  ")
    guard case .leaf(let left) = split.left else {
      Issue.record("Expected left leaf")
      return
    }
    #expect(left.titleOverride == "  ")
    #expect(pruned.focusedPaneIndex == 0)
  }

  @Test
  func catalogEncodingKeepsStableIDsAndOmitsDerivedTitles() throws {
    let spaceID = TerminalSpaceID(rawValue: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!)
    let projectID = TerminalProjectID(rawValue: UUID(uuidString: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC")!)
    let tabID = TerminalTabID(rawValue: UUID(uuidString: "DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD")!)
    let paneID = UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!
    let tab = PersistedTerminalTab(
      id: tabID,
      session: TerminalTabSession(
        lockedTitle: "Pinned",
        focusedPaneIndex: 0,
        root: .leaf(
          TerminalPaneLeafSession(
            id: paneID,
            workingDirectoryPath: "/tmp",
            titleOverride: "Pane",
            agents: [
              TerminalPaneAgentRecord(
                agent: .codex,
                sessionID: "session-1",
                processes: [
                  TerminalAgentProcessIdentity(processID: 123, startTimeMicroseconds: 456)
                ],
                turnLifecycle: .active("turn-1"),
                phase: .running,
                nativePlanRows: [
                  PaneAgentProgressRow(
                    id: "plan-1",
                    title: "Implement native hooks",
                    status: .running
                  )
                ],
                isForeground: true,
                revision: 7
              )
            ]
          )
        )
      )
    )
    let catalog = TerminalSessionCatalog(
      windows: [
        TerminalWindowSession(
          selectedSpaceID: spaceID,
          spaces: [
            TerminalWindowSpaceSession(
              id: spaceID,
              selectedTabID: tabID,
              projects: [TerminalWindowProjectSession(id: projectID, tabs: [tab])]
            )
          ],
          collapsedProjectIDs: [projectID]
        )
      ]
    )

    let data = try TerminalSessionCatalog.fileStorageEncoder().encode(catalog)
    let json = try #require(String(bytes: data, encoding: .utf8))

    #expect(json.contains("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"))
    #expect(json.contains("BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB"))
    #expect(json.contains("CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC"))
    #expect(json.contains("DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD"))
    #expect(json.contains(#""agent":"codex""#))
    #expect(json.contains(#""title":"Implement native hooks""#))
    #expect(json.contains(#""lockedTitle":"Pinned""#))
    #expect(json.contains(#""titleOverride":"Pane""#))
    #expect(!json.contains(#""title":"Pane""#))
    #expect(!json.contains(#""isTitleLocked":"#))
    #expect(!json.contains(#""selectedTabIndex":"#))
    #expect(!json.contains(#""focusedPaneID":"#))
  }

  @Test
  func agentRecordRoundTripsCanonicalState() throws {
    let record = TerminalPaneAgentRecord(
      agent: .codex,
      sessionID: "session-1",
      processes: [
        TerminalAgentProcessIdentity(processID: 123, startTimeMicroseconds: 456)
      ],
      transcriptPath: "/tmp/session.jsonl",
      turnLifecycle: .active("turn-1"),
      phase: .needsInput,
      detail: "Approve tests",
      attentionRequestID: "request-1",
      hoverMessages: ["Inspecting", "Testing"],
      nativePlanRows: [
        PaneAgentProgressRow(id: "plan-1", title: "Implement", status: .running)
      ],
      transcriptRows: [
        PaneAgentProgressRow(id: "goal-1", title: "Ship", status: .running, kind: .goal)
      ],
      activeChildren: [
        TerminalAgentActiveChild(
          id: TerminalAgentActiveChild.Identity(
            subagentID: "reviewer-1",
            sessionID: "session-1",
            turnID: "turn-1"
          ),
          nickname: "Mendel",
          role: "reviewer",
          transcriptPath: "/tmp/child.jsonl",
          phase: .running,
          detail: "Reviewing",
          attentionRequestID: "child-request-1"
        )
      ],
      isForeground: true,
      revision: 7,
      workingDirectoryPath: "/tmp/workspace"
    )

    let data = try JSONEncoder().encode(record)
    let decoded = try JSONDecoder().decode(TerminalPaneAgentRecord.self, from: data)

    #expect(decoded == record)
  }

  @Test
  func catalogReportsNestedSurfaceIDs() {
    let surfaceID = UUID()
    let tab = PersistedTerminalTab(
      id: TerminalTabID(),
      session: TerminalTabSession(
        lockedTitle: nil,
        focusedPaneIndex: 0,
        root: .leaf(TerminalPaneLeafSession(id: surfaceID, workingDirectoryPath: nil))
      )
    )
    let spaceID = TerminalSpaceID()
    let catalog = TerminalSessionCatalog(
      windows: [
        TerminalWindowSession(
          selectedSpaceID: spaceID,
          spaces: [
            TerminalWindowSpaceSession(
              id: spaceID,
              selectedTabID: tab.id,
              projects: [TerminalWindowProjectSession(id: TerminalProjectID(), tabs: [tab])]
            )
          ]
        )
      ]
    )

    #expect(catalog.surfaceIDs == [surfaceID])
  }
}
