import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPListCommandTests {
  @Test
  func listUsesOneDebugSnapshotForEveryOutputMode() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()
    let snapshot = spCommandTestDebugSnapshot()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        return try .ok(id: request.id, encodableResult: snapshot)
      },
      run: { endpoint in
        let socket = ["--socket", endpoint.path]
        let human = try cli.run(["ls"] + socket)
        let plain = try cli.run(["ls", "--plain"] + socket)
        let json = try cli.run(["ls", "--json"] + socket)
        let quiet = try cli.run(["ls", "--quiet"] + socket)
        let data = try #require(json.stdout.data(using: .utf8))
        let object = try #require(
          JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        #expect(human == SPCLIResult(exitCode: 0, stdout: "\n", stderr: ""))
        #expect(plain == SPCLIResult(exitCode: 0, stdout: "\n", stderr: ""))
        #expect(Set(object.keys) == ["revision", "items"])
        #expect((object["items"] as? [Any])?.isEmpty == true)
        #expect(quiet == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
      }
    )

    #expect(
      log.requests.map(\.method)
        == Array(repeating: SupatermSocketMethod.appDebug, count: 4)
    )
  }

  @Test
  func terminalCreationPlainOutputIsTheNewPaneUUID() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let tree = spCommandTestTreeSnapshot()
    let spaceID = tree.windows[0].spaces[0].id
    let tabID = tree.windows[0].spaces[0].flattenedTabs[0].id
    let existingPaneID = tree.windows[0].spaces[0].flattenedTabs[0].panes[0].id
    let tabPaneID = UUID(uuidString: "E66DDF0D-E6FF-456A-A8FB-004D9134A4AF")!
    let splitPaneID = UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!

    try await withSocketRuntime(
      replying: { request, _ in
        switch request.method {
        case SupatermSocketMethod.appTree:
          return try .ok(id: request.id, encodableResult: tree)
        case SupatermSocketMethod.terminalNewTab:
          return try .ok(
            id: request.id,
            encodableResult: SupatermNewTabResult(
              isFocused: false,
              isSelectedSpace: true,
              isSelectedTab: false,
              windowIndex: 1,
              spaceIndex: 1,
              spaceID: spaceID,
              tabIndex: 2,
              tabID: UUID(uuidString: "D9AF1AF2-8B42-484F-88DB-C582B8E9201E")!,
              paneIndex: 1,
              paneID: tabPaneID
            )
          )
        case SupatermSocketMethod.terminalNewPane:
          return try .ok(
            id: request.id,
            encodableResult: SupatermNewPaneResult(
              direction: .right,
              isFocused: false,
              isSelectedTab: true,
              windowIndex: 1,
              spaceIndex: 1,
              spaceID: spaceID,
              tabIndex: 1,
              tabID: tabID,
              paneIndex: 2,
              paneID: splitPaneID
            )
          )
        default:
          return .error(id: request.id, code: "unexpected", message: request.method)
        }
      },
      run: { endpoint in
        let tab = try cli.run([
          "tab", "new", "--plain", "--in", spaceID.uuidString,
          "--socket", endpoint.path,
        ])
        let pane = try cli.run([
          "pane", "split", "right", "--plain", "--in", existingPaneID.uuidString,
          "--socket", endpoint.path,
        ])

        #expect(
          tab
            == SPCLIResult(
              exitCode: 0, stdout: "\(tabPaneID.uuidString.lowercased())\n", stderr: ""))
        #expect(
          pane
            == SPCLIResult(
              exitCode: 0,
              stdout: "\(splitPaneID.uuidString.lowercased())\n",
              stderr: ""
            )
        )
      }
    )
  }

  @Test
  func treeRendererShowsPaneDisplayTitles() {
    let snapshot = spCommandTestListSnapshot()

    #expect(
      SPTreeRenderer.render(SPListSnapshot(snapshot))
        == """
        window 1 [current]
        └─ s:a6e57b1b space 1 "A" [selected]
           └─ g:5a52445e group "Work"
              └─ t:6bfc889d tab 1/1 "fish" [selected]
                 └─ p:2b8b3a57 pane 1/1/1 "build" [selected, codex:running, cwd="/tmp/build"]
        """
    )
    #expect(
      SPTreeRenderer.renderPlain(SPListSnapshot(snapshot))
        == """
        s:a6e57b1b\tspace\t1\t1\t-\tselected\tA\t-\t-
        g:5a52445e\tgroup\t-\t1\ts:a6e57b1b\t-\tWork\t-\t-
        t:6bfc889d\ttab\t1/1\t1\tg:5a52445e\tselected\tfish\t-\t-
        p:2b8b3a57\tpane\t1/1/1\t1\tt:6bfc889d\tselected\tbuild\t/tmp/build\tcodex:running:session-1
        """
    )
  }

  @Test
  func diagnosticTopologyRendererKeepsRichState() {
    #expect(
      SPDiagnosticTopologyRenderer.render(spCommandTestListSnapshot())
        == """
        window 1 [key]
        └─ space 1 "A" [neutral, displayed]
           └─ group 5a52445e-e42a-48b7-a5dd-c6c7c978b139 "Work" [blue]
              └─ tab 1 "fish" [selected]
                 └─ pane 1 "build" [focused]
        """
    )
  }

  @Test
  func listSnapshotEncodesExactCanonicalSchema() throws {
    let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
    let groupID = UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!
    let tabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let snapshot = SPListSnapshot(spCommandTestListSnapshot())
    let data = try JSONEncoder().encode(snapshot)
    let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let current = try #require(object["current"] as? [String: Any])
    let items = try #require(object["items"] as? [[String: Any]])
    let agent = try #require(items[3]["agent"] as? [String: Any])

    #expect(Set(object.keys) == ["revision", "current", "items"])
    #expect((object["revision"] as? String)?.count == 16)
    #expect(Set(current.keys) == ["windowIndex", "spaceID", "tabID", "paneID"])
    #expect(current["spaceID"] as? String == spaceID.uuidString)
    #expect(current["tabID"] as? String == tabID.uuidString)
    #expect(current["paneID"] as? String == paneID.uuidString)
    #expect(items.map { $0["kind"] as? String } == ["space", "group", "tab", "pane"])
    #expect(
      items.map { $0["id"] as? String }
        == [spaceID.uuidString, groupID.uuidString, tabID.uuidString, paneID.uuidString]
    )
    #expect(Set(items[0].keys) == ["kind", "id", "windowIndex", "title", "selected", "isWarm"])
    #expect(Set(items[1].keys) == ["kind", "id", "parentID", "windowIndex", "title", "selected"])
    #expect(Set(items[2].keys) == ["kind", "id", "parentID", "windowIndex", "title", "selected"])
    #expect(
      Set(items[3].keys)
        == ["kind", "id", "parentID", "windowIndex", "title", "cwd", "selected", "agent"]
    )
    #expect(items[1]["parentID"] as? String == spaceID.uuidString)
    #expect(items[2]["parentID"] as? String == groupID.uuidString)
    #expect(items[3]["parentID"] as? String == tabID.uuidString)
    #expect(Set(agent.keys) == ["kind", "phase", "sessionID"])
    #expect(agent["kind"] as? String == "codex")
    #expect(agent["sessionID"] as? String == "session-1")
    #expect(agent["phase"] as? String == "running")
  }

  @Test
  func listRevisionDistinguishesMissingAndLiteralPlaceholderValues() {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    func snapshot(cwd: String?) -> SPListSnapshot {
      SPListSnapshot(
        current: nil,
        items: [
          SPListSnapshot.Item(
            kind: .pane,
            id: paneID,
            parentID: nil,
            windowIndex: 1,
            title: "build",
            cwd: cwd,
            selected: false,
            isWarm: nil,
            agent: nil
          )
        ]
      )
    }

    #expect(snapshot(cwd: nil).revision != snapshot(cwd: "-").revision)
  }

  @Test
  func listSnapshotKeepsValidTabContextWhenItsPaneIsMissing() throws {
    let tabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
    let snapshot = SPListSnapshot(
      spCommandTestListSnapshot(
        currentTarget: SupatermAppDebugSnapshot.CurrentTarget(
          windowIndex: 1,
          spaceIndex: 1,
          spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
          spaceName: "A",
          tabIndex: 1,
          tabID: tabID,
          tabTitle: "fish",
          paneIndex: nil,
          paneID: nil
        ),
        problems: ["The context pane is missing."]
      )
    )

    #expect(snapshot.current?.tabID == tabID)
    #expect(snapshot.current?.paneID == nil)
  }

  @Test
  func listRendererEscapesUntrustedFieldsAndKeepsPlainColumnsFixed() {
    let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
    let tabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let snapshot = SPListSnapshot(
      current: nil,
      items: [
        SPListSnapshot.Item(
          kind: .space,
          id: spaceID,
          parentID: nil,
          windowIndex: 1,
          title: "Work",
          cwd: nil,
          selected: true,
          isWarm: true,
          agent: nil
        ),
        SPListSnapshot.Item(
          kind: .tab,
          id: tabID,
          parentID: spaceID,
          windowIndex: 1,
          title: "shell",
          cwd: nil,
          selected: true,
          isWarm: nil,
          agent: nil
        ),
        SPListSnapshot.Item(
          kind: .pane,
          id: paneID,
          parentID: tabID,
          windowIndex: 1,
          title: "bad\tline\n\u{1B}[31m\u{202E}",
          cwd: "/tmp\\build\r",
          selected: false,
          isWarm: nil,
          agent: nil
        ),
      ]
    )
    let plain = SPTreeRenderer.renderPlain(snapshot)
    let human = SPTreeRenderer.render(snapshot)
    let lines = plain.split(separator: "\n", omittingEmptySubsequences: false)
    let paneLine = String(lines.last ?? "")

    #expect(lines.count == 3)
    #expect(paneLine.split(separator: "\t", omittingEmptySubsequences: false).count == 9)
    #expect(!plain.contains("\u{1B}"))
    #expect(!plain.contains("\u{202E}"))
    #expect(paneLine.contains("bad\\tline\\n\\u{1b}[31m\\u{202e}"))
    #expect(paneLine.contains("/tmp\\\\build\\r"))
    #expect(!human.contains("\u{1B}"))
    #expect(!human.contains("\u{202E}"))
    #expect(human.contains("bad\\tline\\n\\u{1b}[31m\\u{202e}"))
  }

  private func spCommandTestListSnapshot(
    currentTarget: SupatermAppDebugSnapshot.CurrentTarget? = nil,
    problems: [String] = []
  ) -> SupatermAppDebugSnapshot {
    SupatermAppDebugSnapshot(
      build: SupatermAppDebugSnapshot.Build(
        version: "1.0.0",
        buildNumber: "1",
        isDevelopmentBuild: true,
        usesStubUpdateChecks: false
      ),
      update: SupatermAppDebugSnapshot.Update(
        canCheckForUpdates: true,
        phase: "idle",
        detail: ""
      ),
      summary: SupatermAppDebugSnapshot.Summary(
        windowCount: 1,
        spaceCount: 1,
        tabCount: 1,
        paneCount: 1,
        keyWindowIndex: 1
      ),
      currentTarget: currentTarget,
      windows: [
        SupatermAppDebugSnapshot.Window(
          index: 1,
          isKey: true,
          isVisible: true,
          displayedSpaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
          spaces: [
            SupatermAppDebugSnapshot.Space(
              index: 1,
              id: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
              name: "A",
              color: .neutral,
              isWarm: true,
              rootItems: [
                .group(
                  SupatermAppDebugSnapshot.Group(
                    color: .blue,
                    id: UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!,
                    isCollapsed: false,
                    isPinned: false,
                    title: "Work",
                    tabs: [
                      SupatermAppDebugSnapshot.Tab(
                        id: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
                        title: "fish",
                        isSelected: true,
                        isDirty: false,
                        isTitleLocked: false,
                        hasRunningActivity: false,
                        hasBell: false,
                        hasReadOnly: false,
                        hasSecureInput: false,
                        panes: [
                          SupatermAppDebugSnapshot.Pane(
                            index: 1,
                            id: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!,
                            isFocused: true,
                            displayTitle: "build",
                            pwd: "/tmp/build",
                            isReadOnly: false,
                            hasSecureInput: false,
                            bellCount: 0,
                            isRunning: false,
                            progressState: nil,
                            progressValue: nil,
                            needsCloseConfirmation: false,
                            lastCommandExitCode: nil,
                            lastCommandDurationMs: nil,
                            lastChildExitCode: nil,
                            lastChildExitTimeMs: nil,
                            foregroundProcessGroupID: nil,
                            ttyName: nil,
                            agent: SupatermAppDebugSnapshot.Agent(
                              kind: .codex,
                              sessionID: "session-1",
                              phase: .running
                            )
                          )
                        ]
                      )
                    ]
                  )
                )
              ]
            )
          ]
        )
      ],
      problems: problems
    )
  }

  private func spCommandTestTreeSnapshot() -> SupatermTreeSnapshot {
    let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
    return SupatermTreeSnapshot(
      windows: [
        SupatermTreeSnapshot.Window(
          index: 1,
          isKey: true,
          displayedSpaceID: spaceID,
          spaces: [
            SupatermTreeSnapshot.Space(
              index: 1,
              id: spaceID,
              name: "Work",
              color: .neutral,
              isWarm: true,
              rootItems: [
                .tab(
                  SupatermTreeSnapshot.RootTab(
                    isPinned: false,
                    tab: SupatermTreeSnapshot.Tab(
                      id: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
                      title: "shell",
                      isSelected: true,
                      panes: [
                        SupatermTreeSnapshot.Pane(
                          index: 1,
                          id: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!,
                          isFocused: true
                        )
                      ]
                    )
                  )
                )
              ]
            )
          ]
        )
      ]
    )
  }
}
