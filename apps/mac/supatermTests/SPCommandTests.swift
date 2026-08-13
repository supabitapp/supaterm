import ArgumentParser
import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPCommandTests {
  @Test
  func newPaneHelpShowsScriptOptionAndExample() {
    let help = SP.helpMessage(for: SP.NewPane.self, columns: 100)

    #expect(help.contains("--script <script>"))
    #expect(help.contains("sp pane split down --script 'echo hi; pwd'"))
  }

  @Test
  func newPaneDefaultsAndOptions() throws {
    let defaultCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "right"]) as? SP.NewPane
    )
    let keepLayoutCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "--layout", "keep", "right"]) as? SP.NewPane
    )
    let focusedCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "--focus", "right"]) as? SP.NewPane
    )

    #expect(defaultCommand.layout == .equalize)
    #expect(!defaultCommand.focus)
    #expect(keepLayoutCommand.layout == .keep)
    #expect(focusedCommand.focus)
  }

  @Test
  func newTabParserAcceptsUUIDSpaceTarget() throws {
    let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
    let command = try #require(
      try SP.parseAsRoot(["tab", "new", "--in", spaceID.uuidString]) as? SP.NewTab
    )

    #expect(command.space == .id(spaceID))
  }

  @Test
  func targetParsersAcceptTypedShortRefs() throws {
    #expect(
      try parseSpaceReference("S:A6E57B1B")
        == .short(SPShortReference(kind: .space, prefix: "a6e57b1b"))
    )
    #expect(
      try parseGroupReference("g:5A52445E")
        == .short(SPShortReference(kind: .group, prefix: "5a52445e"))
    )
    #expect(
      try parseTabReference("t:6BFC889D2")
        == .short(SPShortReference(kind: .tab, prefix: "6bfc889d2"))
    )
    #expect(
      try parsePaneReference("p:2B8B3A57D7F84EF7930F46B1F7281B2A")
        == .short(
          SPShortReference(kind: .pane, prefix: "2b8b3a57d7f84ef7930f46b1f7281b2a")
        )
    )
    #expect(
      try parseContainerReference("t:6bfc889d")
        == .tab(.short(SPShortReference(kind: .tab, prefix: "6bfc889d")))
    )
    #expect(
      try parseContainerReference("p:2b8b3a57")
        == .pane(.short(SPShortReference(kind: .pane, prefix: "2b8b3a57")))
    )
  }

  @Test
  func targetParsersRejectMalformedAndWrongKindRefs() {
    for value in ["s:1234567", "s:123456789012345678901234567890123", "s:1234567z"] {
      #expect(throws: ValidationError.self) {
        _ = try parseSpaceReference(value)
      }
    }
    #expect(throws: ValidationError.self) {
      _ = try parseSpaceReference("g:5a52445e")
    }
    #expect(throws: ValidationError.self) {
      _ = try parseGroupReference("p:2b8b3a57")
    }
    #expect(throws: ValidationError.self) {
      _ = try parseGroupReference("g:not-a-ref")
    }
    #expect(throws: ValidationError.self) {
      _ = try parseContainerReference("s:a6e57b1b")
    }
    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["group", "collapse", "p:2b8b3a57"])
    }
  }

  @Test
  func shortRefsLengthenOnSameKindCollisions() throws {
    let first = UUID(uuidString: "AAAAAAAA-0000-4000-8000-000000000001")!
    let second = UUID(uuidString: "AAAAAAAA-1000-4000-8000-000000000002")!
    let reference = SPShortReference(kind: .tab, prefix: "aaaaaaaa0")

    #expect(
      SPShortReference.display(kind: .tab, id: first, among: [first, second])
        == "t:aaaaaaaa0"
    )
    #expect(
      SPShortReference.display(kind: .tab, id: second, among: [first, second])
        == "t:aaaaaaaa1"
    )
    #expect(try reference.resolve(in: [first, second]) == first)
    #expect(throws: ValidationError.self) {
      _ = try SPShortReference(kind: .tab, prefix: "aaaaaaaa").resolve(
        in: [first, second]
      )
    }
    #expect(
      SPShortReference.display(kind: .space, id: first, among: [first, first])
        == "s:aaaaaaaa"
    )
  }

  @Test
  func groupParsersAcceptPublicCommandShapes() throws {
    let groupID = UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!
    let create = try #require(
      try SP.parseAsRoot([
        "group", "new", "Work", "--color", "blue", "--pin", "--in", "2",
      ]) as? SP.GroupNew
    )
    let rename = try #require(
      try SP.parseAsRoot(["group", "rename", "Build", groupID.uuidString]) as? SP.GroupRename
    )
    let move = try #require(
      try SP.parseAsRoot(["group", "move", "Work", "--index", "2"]) as? SP.GroupMove
    )
    let close = try #require(
      try SP.parseAsRoot(["group", "close", "Work", "-y"]) as? SP.GroupClose
    )
    let collapse = try #require(
      try SP.parseAsRoot(["group", "collapse"]) as? SP.GroupCollapse
    )

    #expect(create.title == "Work")
    #expect(create.color == .blue)
    #expect(create.pin)
    #expect(create.space == .index(2))
    #expect(rename.title == "Build")
    #expect(rename.group == .id(groupID))
    #expect(move.group == .title("Work"))
    #expect(move.index == 2)
    #expect(close.group == .title("Work"))
    #expect(close.yes)
    #expect(collapse.group == nil)
  }

  @Test
  func moveTabParsesExclusiveGroupAndRootDestinations() throws {
    let grouped = try #require(
      try SP.parseAsRoot(["tab", "move", "1/2", "--group", "Work", "--index", "1"])
        as? SP.MoveTab
    )
    let rooted = try #require(
      try SP.parseAsRoot(["tab", "move", "1/2", "--root", "--index", "2", "--pin"])
        as? SP.MoveTab
    )

    #expect(try grouped.destinationReference() == .group(.title("Work")))
    #expect(grouped.index == 1)
    #expect(try rooted.destinationReference() == .root)
    #expect(rooted.index == 2)
    #expect(rooted.pin)
  }

  @Test
  func moveTabRejectsMissingConflictingAndPinnedGroupDestinations() throws {
    let missing = try #require(
      try SP.parseAsRoot(["tab", "move", "1/2"]) as? SP.MoveTab
    )
    let conflicting = try #require(
      try SP.parseAsRoot(["tab", "move", "1/2", "--group", "Work", "--root"])
        as? SP.MoveTab
    )
    let pinnedGroup = try #require(
      try SP.parseAsRoot(["tab", "move", "1/2", "--group", "Work", "--pin"])
        as? SP.MoveTab
    )

    #expect(throws: ValidationError.self) { try missing.destinationReference() }
    #expect(throws: ValidationError.self) { try conflicting.destinationReference() }
    #expect(throws: ValidationError.self) { try pinnedGroup.destinationReference() }
  }

  @Test
  func newTabRejectsGroupAndRootTogether() throws {
    #expect(throws: (any Error).self) {
      try SP.parseAsRoot(["tab", "new", "--group", "Work", "--root"])
    }
  }

  @Test
  func spaceListParserTakesNoTarget() throws {
    _ = try #require(try SP.parseAsRoot(["space", "ls"]) as? SP.SpaceList)

    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["space", "ls", "1"])
    }
  }

  @Test
  func spaceNewParserRejectsTheRemovedFocusFlag() throws {
    let command = try #require(
      try SP.parseAsRoot(["space", "new", "--color", "green", "Work"]) as? SP.SpaceNew
    )

    #expect(command.name == "Work")
    #expect(command.color == .green)
    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["space", "new", "--focus", "Work"])
    }
  }

  @Test
  func spaceDestroyParserAcceptsYesFlag() throws {
    let command = try #require(
      try SP.parseAsRoot(["space", "destroy", "-y", "1"]) as? SP.SpaceDestroy
    )

    #expect(command.yes)
    #expect(command.space == .index(1))
  }

  @Test
  func spaceCloseParserIsRemoved() throws {
    do {
      _ = try SP.parseAsRoot(["space", "close", "1"])
      Issue.record("Expected space close to be removed.")
    } catch {
      #expect(String(describing: error).contains("close"))
    }
  }

  @Test
  func newPaneParserAcceptsTabAndPaneTargets() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let tabCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "right", "--in", "1/2"]) as? SP.NewPane
    )
    let paneCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "right", "--in", paneID.uuidString]) as? SP.NewPane
    )

    #expect(tabCommand.container == .tab(.path(spaceIndex: 1, tabIndex: 2)))
    #expect(paneCommand.container == .id(paneID))
  }

  @Test
  func focusPaneAndSelectTabParsersAcceptSelectorTargets() throws {
    let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    let focusPane = try #require(
      try SP.parseAsRoot(["pane", "focus", paneID.uuidString]) as? SP.FocusPane
    )
    let selectTab = try #require(
      try SP.parseAsRoot(["tab", "focus", "1/2"]) as? SP.SelectTab
    )

    #expect(focusPane.pane == .id(paneID))
    #expect(selectTab.tab == .path(spaceIndex: 1, tabIndex: 2))
  }

  @Test
  func pinAndUnpinParsersAcceptSelectorTargets() throws {
    let tabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
    let pinTab = try #require(
      try SP.parseAsRoot(["tab", "pin", "1/2"]) as? SP.PinTab
    )
    let unpinTab = try #require(
      try SP.parseAsRoot(["tab", "unpin", tabID.uuidString]) as? SP.UnpinTab
    )

    #expect(pinTab.tab == .path(spaceIndex: 1, tabIndex: 2))
    #expect(unpinTab.tab == .id(tabID))
  }

  @Test
  func notifyParserAcceptsMissingBody() throws {
    let command = try #require(
      try SP.parseAsRoot(["pane", "notify", "--title", "Deploy complete"]) as? SP.Notify
    )

    #expect(command.body == nil)
  }

  @Test
  func notifyParserAcceptsEmptyBody() throws {
    let command = try #require(
      try SP.parseAsRoot(["pane", "notify", "--body", ""]) as? SP.Notify
    )

    #expect(command.body?.isEmpty == true)
  }

  @Test
  func tmuxParserAcceptsPassThroughCommandName() throws {
    let tmux = try #require(
      try SP.Tmux.parseAsRoot(["display-message"]) as? SP.Tmux
    )

    #expect(tmux.arguments == ["display-message"])
  }

  @Test
  func runParserAcceptsPassThroughCommandName() throws {
    let run = try #require(
      try SP.Run.parseAsRoot(["--", "claude", "--resume"]) as? SP.Run
    )

    #expect(run.arguments == ["claude", "--resume"])
  }

  @Test
  func newTabHelpShowsScriptOptionAndExample() {
    let help = SP.helpMessage(for: SP.NewTab.self, columns: 100)

    #expect(help.contains("--script <script>"))
    #expect(help.contains("sp tab new --script 'echo hi; pwd'"))
  }

  @Test
  func internalPingDecodesSocketResultAsJson() throws {
    let response = try SupatermSocketResponse.ok(
      id: "ping-1",
      encodableResult: SP.SPPingResult(pong: true)
    )

    let result = try SP.Ping.result(from: response)

    #expect(result == SP.SPPingResult(pong: true))
    #expect(
      try JSONDecoder().decode(SP.SPPingResult.self, from: Data(try jsonString(result).utf8))
        == result)
  }

  @Test
  func socketResolutionStrategyUsesDiscoveryOnlyWhenNeeded() {
    let environmentPath = "/tmp/environment.sock"
    let endpoint = spCommandTestSocketEndpoint(path: "/tmp/live.sock")

    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: nil,
        environmentSocketPath: environmentPath,
        environmentPathStatus: .reachable(endpoint),
        discoveryPolicy: .whenNeeded
      )
        == SPSocketResolutionStrategy(
          environmentPath: environmentPath,
          discoversManagedSockets: false
        )
    )
    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: nil,
        environmentSocketPath: environmentPath,
        environmentPathStatus: .stale,
        discoveryPolicy: .whenNeeded
      ) == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: true)
    )
    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: nil,
        environmentSocketPath: environmentPath,
        environmentPathStatus: .ignored,
        discoveryPolicy: .whenNeeded
      ) == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: true)
    )
    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: "/tmp/explicit.sock",
        environmentSocketPath: environmentPath,
        environmentPathStatus: nil,
        discoveryPolicy: .whenNeeded
      ) == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: false)
    )
  }

  @Test
  func socketResolutionStrategyAlwaysDiscoversWithoutChangingPrecedence() {
    let environmentPath = "/tmp/environment.sock"
    let endpoint = spCommandTestSocketEndpoint(path: "/tmp/live.sock")

    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: nil,
        environmentSocketPath: environmentPath,
        environmentPathStatus: .reachable(endpoint),
        discoveryPolicy: .always
      )
        == SPSocketResolutionStrategy(
          environmentPath: environmentPath,
          discoversManagedSockets: true
        )
    )
    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: nil,
        environmentSocketPath: environmentPath,
        environmentPathStatus: .stale,
        discoveryPolicy: .always
      ) == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: true)
    )
    #expect(
      SPSocketResolutionStrategy.make(
        explicitSocketPath: "/tmp/explicit.sock",
        environmentSocketPath: environmentPath,
        environmentPathStatus: nil,
        discoveryPolicy: .always
      ) == SPSocketResolutionStrategy(environmentPath: nil, discoversManagedSockets: true)
    )
  }

  @Test
  func diagnosticSocketProbeReportsResolutionFailure() {
    let result = SPDiagnosticSocketProbe.probe(
      target: nil,
      resolutionErrorMessage: "No reachable Supaterm instance was found.",
      context: nil,
      sendDebugRequest: { _, _ in
        Issue.record("Expected diagnostic probe to skip socket request.")
        return .error(code: "unexpected", message: "unexpected")
      }
    )

    #expect(result.socket.path == nil)
    #expect(!result.socket.isReachable)
    #expect(!result.socket.requestSucceeded)
    #expect(result.socket.error == "No reachable Supaterm instance was found.")
    #expect(result.appSnapshot == nil)
    #expect(result.problems == ["No reachable Supaterm instance was found."])
  }

  @Test
  func diagnosticSocketProbeDecodesSuccessfulDebugResponse() throws {
    let endpoint = spCommandTestSocketEndpoint(path: "/tmp/live.sock")
    let target = SupatermResolvedSocketTarget(
      path: endpoint.path,
      source: .discoveredSingleton
    )
    let snapshot = spCommandTestDebugSnapshot()

    let result = SPDiagnosticSocketProbe.probe(
      target: target,
      resolutionErrorMessage: nil,
      context: nil,
      sendDebugRequest: { requestedTarget, context in
        #expect(requestedTarget == target)
        #expect(context == nil)
        return try SupatermSocketResponse.ok(id: "debug-1", encodableResult: snapshot)
      }
    )

    #expect(result.socket.path == endpoint.path)
    #expect(result.socket.isReachable)
    #expect(result.socket.requestSucceeded)
    #expect(result.socket.error == nil)
    #expect(result.appSnapshot == snapshot)
    #expect(result.problems.isEmpty)
  }

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
  func diagnosticSocketProbeReportsSocketErrorResponse() {
    let endpoint = spCommandTestSocketEndpoint(path: "/tmp/live.sock")
    let target = SupatermResolvedSocketTarget(
      path: endpoint.path,
      source: .discoveredSingleton
    )

    let result = SPDiagnosticSocketProbe.probe(
      target: target,
      resolutionErrorMessage: nil,
      context: nil,
      sendDebugRequest: { _, _ in
        .error(id: "debug-1", code: "failed", message: "Debug failed.")
      }
    )

    #expect(result.socket.path == endpoint.path)
    #expect(result.socket.isReachable)
    #expect(!result.socket.requestSucceeded)
    #expect(result.socket.error == "Debug failed.")
    #expect(result.appSnapshot == nil)
    #expect(result.problems == ["Debug failed."])
  }

  @Test
  func diagnosticSocketProbeReportsThrownSocketRequestError() {
    let endpoint = spCommandTestSocketEndpoint(path: "/tmp/live.sock")
    let target = SupatermResolvedSocketTarget(
      path: endpoint.path,
      source: .discoveredSingleton
    )

    let result = SPDiagnosticSocketProbe.probe(
      target: target,
      resolutionErrorMessage: nil,
      context: nil,
      sendDebugRequest: { _, _ in
        throw SPCommandTestDiagnosticError.failed
      }
    )

    #expect(result.socket.path == endpoint.path)
    #expect(!result.socket.isReachable)
    #expect(!result.socket.requestSucceeded)
    #expect(result.socket.error == "socket failed")
    #expect(result.appSnapshot == nil)
    #expect(result.problems == ["socket failed"])
  }

  @Test
  func onboardRendererShowsLogoWelcomeShortcutsAndSetupCommands() {
    let rendered = SPOnboardingRenderer.render(
      SupatermOnboardingSnapshot(
        items: [
          SupatermOnboardingShortcut(shortcut: "⌘S", title: "Toggle sidebar"),
          SupatermOnboardingShortcut(shortcut: "⌘T", title: "New tab"),
          SupatermOnboardingShortcut(shortcut: "⌘1-8", title: "Go to tabs 1-8"),
          SupatermOnboardingShortcut(shortcut: "⌘9", title: "Last tab"),
          SupatermOnboardingShortcut(shortcut: "⌘W", title: "Close pane"),
          SupatermOnboardingShortcut(shortcut: "⌘⌥W", title: "Close tab"),
          SupatermOnboardingShortcut(shortcut: "⌃1-0", title: "Go to space 1-10"),
          SupatermOnboardingShortcut(shortcut: "⌘D", title: "Split right"),
          SupatermOnboardingShortcut(shortcut: "⌘⇧D", title: "Split down"),
          SupatermOnboardingShortcut(shortcut: "⌘F", title: "Find"),
        ]
      )
    ).replacingOccurrences(
      of: "\u{001B}\\[[0-9;]*m",
      with: "",
      options: .regularExpression
    )

    #expect(
      rendered
        == """
               ##
             ####
            #####
           ##########
         ############
        ############
            ######
            #####
            ###
            ##

        Welcome to Supaterm!

        Common Shortcuts

        ⌘S    Toggle sidebar
        ⌘T    New tab
        ⌘1-8  Go to tabs 1-8
        ⌘9    Last tab
        ⌘W    Close pane
        ⌘⌥W   Close tab
        ⌃1-0  Go to space 1-10
        ⌘D    Split right
        ⌘⇧D   Split down
        ⌘F    Find

        Coding Agents Integrations Setup:

        Install the Supaterm skill:

        sp skills install

        Run the commands that match your setup:

        sp agent install-hook claude
        sp agent install-hook codex
        pi install git:github.com/supabitapp/supaterm-skills

        Run "sp" for the list of available commands.
        """
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

  @Test
  func skillsParserAcceptsCatalogGetPathAndInstallCommands() throws {
    let defaultCommand = try #require(
      try SP.parseAsRoot(["skills"]) as? SP.ListSkills
    )
    let listCommand = try #require(
      try SP.parseAsRoot(["skills", "list", "--json"]) as? SP.ListSkills
    )
    let getCommand = try #require(
      try SP.parseAsRoot(["skills", "get", "core", "--full"]) as? SP.GetSkill
    )
    let pathCommand = try #require(
      try SP.parseAsRoot(["skills", "path", "core"]) as? SP.PathSkill
    )
    let installCommand = try #require(
      try SP.parseAsRoot(["skills", "install", "--json"]) as? SP.InstallSkill
    )

    #expect(!defaultCommand.json)
    #expect(listCommand.json)
    #expect(getCommand.name == "core")
    #expect(getCommand.full)
    #expect(pathCommand.name == "core")
    #expect(installCommand.json)
  }

  @Test
  func skillsGetRejectsJSONOutput() {
    #expect(throws: (any Error).self) {
      try SP.parseAsRoot(["skills", "get", "core", "--json"])
    }
  }

  @Test
  func agentInstallSkillCommandIsRemoved() {
    do {
      _ = try SP.parseAsRoot(["agent", "install-skill"])
      Issue.record("Expected agent install-skill to be removed.")
    } catch {
      #expect(String(describing: error).contains("install-skill"))
    }
  }

  @Test
  func agentParserAcceptsInstallRemoveHookAndReceiveAgentHookSubcommands() throws {
    let installAllCommand = try #require(
      try SP.parseAsRoot(["agent", "install-hooks"]) as? SP.InstallAgentHooks
    )
    let claudeCommand = try #require(
      try SP.parseAsRoot(["agent", "install-hook", "claude"]) as? SP.InstallAgentHook.Claude
    )
    let codexCommand = try #require(
      try SP.parseAsRoot(["agent", "install-hook", "codex"]) as? SP.InstallAgentHook.Codex
    )
    let removeClaudeCommand = try #require(
      try SP.parseAsRoot(["agent", "remove-hook", "claude"]) as? SP.RemoveAgentHook.Claude
    )
    let removeCodexCommand = try #require(
      try SP.parseAsRoot(["agent", "remove-hook", "codex"]) as? SP.RemoveAgentHook.Codex
    )
    let receiveClaudeCommand = try #require(
      try SP.parseAsRoot(["agent", "receive-agent-hook", "--agent", "claude"])
        as? SP.ReceiveAgentHook
    )
    let receivePiCommand = try #require(
      try SP.parseAsRoot(["agent", "receive-agent-hook", "--agent", "pi", "--pid", "123"])
        as? SP.ReceiveAgentHook
    )

    #expect(type(of: installAllCommand) == SP.InstallAgentHooks.self)
    #expect(type(of: claudeCommand) == SP.InstallAgentHook.Claude.self)
    #expect(type(of: codexCommand) == SP.InstallAgentHook.Codex.self)
    #expect(type(of: removeClaudeCommand) == SP.RemoveAgentHook.Claude.self)
    #expect(type(of: removeCodexCommand) == SP.RemoveAgentHook.Codex.self)
    #expect(receiveClaudeCommand.agent == .claude)
    #expect(receiveClaudeCommand.pid == nil)
    #expect(receivePiCommand.agent == .pi)
    #expect(receivePiCommand.pid == 123)
  }

  @Test
  func configParserAcceptsValidateSubcommand() throws {
    let command = try #require(
      try SP.parseAsRoot(["config", "validate", "--path", "./settings.toml"]) as? SP.ValidateConfig
    )

    #expect(command.path == "./settings.toml")
  }

  @Test
  func configParserAcceptsSettingsSubcommands() throws {
    let pathCommand = try #require(
      try SP.parseAsRoot(["config", "path"]) as? SP.PathConfig
    )
    let listCommand = try #require(
      try SP.parseAsRoot(["config", "list", "--changed"]) as? SP.ListConfig
    )
    let getCommand = try #require(
      try SP.parseAsRoot(["config", "get", "updates.channel"]) as? SP.GetConfig
    )
    let setCommand = try #require(
      try SP.parseAsRoot(["config", "set", "appearance.mode", "system"]) as? SP.SetConfig
    )
    let resetCommand = try #require(
      try SP.parseAsRoot(["config", "reset", "privacy.analytics_enabled"]) as? SP.ResetConfig
    )

    #expect(type(of: pathCommand) == SP.PathConfig.self)
    #expect(listCommand.changed)
    #expect(getCommand.key == "updates.channel")
    #expect(setCommand.key == "appearance.mode")
    #expect(setCommand.value == "system")
    #expect(resetCommand.key == "privacy.analytics_enabled")
  }

  @Test
  func tabFocusAndPaneSendParsersAcceptPublicShape() throws {
    let focusCommand = try #require(
      try SP.parseAsRoot(["tab", "focus", "1/2"]) as? SP.SelectTab
    )
    let sendCommand = try #require(
      try SP.parseAsRoot(["pane", "send", "1/2/3", "pwd"]) as? SP.SendText
    )
    let submitCommand = try #require(
      try SP.parseAsRoot(["pane", "send", "--submit", "1/2/3", "first\nsecond"])
        as? SP.SendText
    )

    #expect(focusCommand.tab == .path(spaceIndex: 1, tabIndex: 2))
    #expect(sendCommand.arguments == ["1/2/3", "pwd"])
    #expect(submitCommand.submit)
    #expect(submitCommand.arguments == ["1/2/3", "first\nsecond"])
  }

  @Test
  func paneKeyParserAcceptsPublicKeysAndOptionalTarget() throws {
    let mappings: [(String, SupatermInputKey)] = [
      ("backspace", .backspace),
      ("ctrl-c", .ctrlC),
      ("ctrl-d", .ctrlD),
      ("ctrl-l", .ctrlL),
      ("ctrl-z", .ctrlZ),
      ("enter", .enter),
      ("escape", .escape),
      ("tab", .tab),
    ]

    for (argument, inputKey) in mappings {
      let command = try #require(
        try SP.parseAsRoot(["pane", "key", argument]) as? SP.SendKey
      )
      #expect(command.key.inputKey == inputKey)
      #expect(command.pane == nil)
    }

    let selectedPane = try #require(
      try SP.parseAsRoot(["pane", "key", "enter", "1/2/3"]) as? SP.SendKey
    )

    #expect(selectedPane.key == .enter)
    #expect(selectedPane.pane == .path(spaceIndex: 1, tabIndex: 2, paneIndex: 3))
  }

  @Test
  func paneKeyParserRejectsSocketKeyNames() {
    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["pane", "key", "ctrl_c"])
    }
  }

  @Test
  func paneScreenshotParserRequiresAnOutputPath() throws {
    let command = try #require(
      try SP.parseAsRoot([
        "pane", "screenshot", "1/2/3", "--output", "pane.png", "--json",
      ]) as? SP.ScreenshotPane
    )

    #expect(command.pane == .path(spaceIndex: 1, tabIndex: 2, paneIndex: 3))
    #expect(command.outputPath == "pane.png")
    #expect(command.options.output.json)
    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["pane", "screenshot", "1/2/3"])
    }
  }

  @Test
  func paneScreenshotRejectsAnEmptyOutputPath() {
    #expect(throws: ValidationError.self) {
      _ = try resolvedCLIOutputFileURL("   ")
    }
  }

  @Test
  func paneSendRejectsNewlineWithSubmit() {
    do {
      _ = try SP.parseAsRoot(["pane", "send", "--newline", "--submit", "prompt"])
      Issue.record("Expected pane send to reject --newline with --submit.")
    } catch {
      #expect(String(describing: error).contains("--newline and --submit cannot be used together."))
    }
  }

  @Test
  func paneSendDoesNotTreatTypedTargetsAsText() throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }

    let malformed = try cli.run(["pane", "send", "p:1234567", "hello"])
    let wrongKind = try cli.run(["pane", "send", "t:6bfc889d", "hello"])

    #expect(malformed.exitCode != 0)
    #expect(malformed.stderr.contains("8 to 32 UUID hex characters"))
    #expect(wrongKind.exitCode != 0)
    #expect(wrongKind.stderr.contains("Expected a pane ref"))
    #expect(!wrongKind.stderr.contains("No reachable Supaterm instance"))
  }

  @Test(arguments: [
    ["pane", "split", "right", "--script", "echo 1", "echo", "2"],
    ["tab", "new", "--script", "echo 1", "echo", "2"],
  ])
  func parserRejectsScriptWithTrailingCommand(arguments: [String]) {
    do {
      _ = try SP.parseAsRoot(arguments)
      Issue.record("Expected parsing to reject combining --script with a trailing command.")
    } catch {
      let message = String(describing: error)
      #expect(message.contains("--script cannot be used with a trailing command."))
    }
  }

  @Test(arguments: [
    ["pane", "split", "right", "--", ""],
    ["tab", "new", "--", ""],
  ])
  func parserRejectsAnEmptyExecutable(arguments: [String]) {
    #expect(throws: (any Error).self) {
      try SP.parseAsRoot(arguments)
    }
  }

  @Test(arguments: [
    ["tab", "new", "--in", "0"],
    ["pane", "split", "right", "--in", "bad-target"],
  ])
  func parserRejectsInvalidSelectorTargets(arguments: [String]) {
    do {
      _ = try SP.parseAsRoot(arguments)
      Issue.record("Expected parsing to reject an invalid target.")
    } catch {
      let message = String(describing: error)
      #expect(
        message.contains("1 or greater")
          || message.contains("space selector")
          || message.contains("tab selector")
          || message.contains("tab target")
          || message.contains("space/tab")
          || message.contains("space/tab/pane")
          || message.localizedCaseInsensitiveContains("invalid")
      )
    }
  }
}

private enum SPCommandTestDiagnosticError: LocalizedError {
  case failed

  var errorDescription: String? {
    "socket failed"
  }
}

private func spCommandTestSocketEndpoint(path: String) -> SupatermSocketEndpoint {
  SupatermSocketEndpoint(
    id: UUID(uuidString: "3F6B51E0-F214-456C-93F4-D87AEACCC292")!,
    name: "default",
    path: path,
    pid: 1,
    startedAt: Date(timeIntervalSince1970: 1)
  )
}

private func spCommandTestDebugSnapshot() -> SupatermAppDebugSnapshot {
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
      windowCount: 0,
      spaceCount: 0,
      tabCount: 0,
      paneCount: 0,
      keyWindowIndex: nil
    ),
    currentTarget: nil,
    windows: [],
    problems: []
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
