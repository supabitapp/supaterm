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
  func newPaneLayoutDefaultsToEqualizeAndCanKeepLayout() throws {
    let defaultCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "right"]) as? SP.NewPane
    )
    let keepLayoutCommand = try #require(
      try SP.parseAsRoot(["pane", "split", "--layout", "keep", "right"]) as? SP.NewPane
    )

    #expect(defaultCommand.layout == .equalize)
    #expect(keepLayoutCommand.layout == .keep)
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

    #expect(command.body == "")
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

    #expect(result == .init(pong: true))
    #expect(
      try JSONDecoder().decode(SP.SPPingResult.self, from: Data(try jsonString(result).utf8))
        == result)
  }

  @Test
  func onboardRendererShowsWelcomeShortcutsAndSetupCommands() {
    let rendered = SPOnboardingRenderer.render(
      .init(
        items: [
          .init(shortcut: "⌘S", title: "Toggle sidebar"),
          .init(shortcut: "⌘T", title: "New tab"),
          .init(shortcut: "⌘1-8", title: "Go to tabs 1-8"),
          .init(shortcut: "⌘9", title: "Last tab"),
          .init(shortcut: "⌘W", title: "Close pane"),
          .init(shortcut: "⌘⌥W", title: "Close tab"),
          .init(shortcut: "⌃1-0", title: "Go to space 1-10"),
          .init(shortcut: "⌘D", title: "Split right"),
          .init(shortcut: "⌘⇧D", title: "Split down"),
          .init(shortcut: "⌘F", title: "Find"),
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

        npx skills add supabitapp/supaterm-skills --skill supaterm -g

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
    let snapshot = SupatermAppDebugSnapshot(
      build: .init(
        version: "1.0.0",
        buildNumber: "1",
        isDevelopmentBuild: true,
        usesStubUpdateChecks: false
      ),
      update: .init(
        canCheckForUpdates: true,
        phase: "idle",
        detail: ""
      ),
      summary: .init(
        windowCount: 1,
        spaceCount: 1,
        tabCount: 1,
        paneCount: 1,
        keyWindowIndex: 1
      ),
      currentTarget: nil,
      windows: [
        .init(
          index: 1,
          isKey: true,
          isVisible: true,
          spaces: [
            .init(
              index: 1,
              id: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
              name: "A",
              isSelected: true,
              tabs: [
                .init(
                  index: 1,
                  id: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
                  title: "fish",
                  isSelected: true,
                  isPinned: false,
                  isDirty: false,
                  isTitleLocked: false,
                  hasRunningActivity: false,
                  hasBell: false,
                  hasReadOnly: false,
                  hasSecureInput: false,
                  panes: [
                    .init(
                      index: 1,
                      id: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!,
                      isFocused: true,
                      displayTitle: "build",
                      pwd: nil,
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
                      lastChildExitTimeMs: nil
                    )
                  ]
                )
              ]
            )
          ]
        )
      ],
      problems: []
    )

    #expect(
      SPTreeRenderer.render(snapshot)
        == """
        window 1 [key]
        └─ space 1 "A" [selected]
           └─ tab 1 "fish" [selected]
              └─ pane 1 "build" [focused]
        """
    )
    #expect(
      SPTreeRenderer.renderPlain(snapshot)
        == """
        1\tspace\tA\tselected
        1/1\ttab\tfish\tselected
        1/1/1\tpane\tbuild\tfocused
        """
    )
  }

  @Test
  func agentParserAcceptsInstallRemoveHookAndReceiveAgentHookSubcommands() throws {
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
      try SP.parseAsRoot(["agent", "receive-agent-hook", "--agent", "pi"]) as? SP.ReceiveAgentHook
    )

    #expect(type(of: claudeCommand) == SP.InstallAgentHook.Claude.self)
    #expect(type(of: codexCommand) == SP.InstallAgentHook.Codex.self)
    #expect(type(of: removeClaudeCommand) == SP.RemoveAgentHook.Claude.self)
    #expect(type(of: removeCodexCommand) == SP.RemoveAgentHook.Codex.self)
    #expect(receiveClaudeCommand.agent == .claude)
    #expect(receivePiCommand.agent == .pi)
  }

  @Test
  func computerUseParserAcceptsCoreSubcommands() throws {
    let permissions = try #require(
      try SP.parseAsRoot(["computer-use", "permissions"]) as? SP.ComputerUsePermissions
    )
    let launch = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "launch",
        "--bundle-id",
        "com.apple.TextEdit",
        "--url",
        "file:///tmp/example.txt",
        "--argument=--foreground",
        "--env=FOO=bar",
        "--electron-debugging-port",
        "9222",
        "--webkit-inspector-port",
        "9226",
        "--new-instance",
      ]) as? SP.ComputerUseLaunch
    )
    let windows = try #require(
      try SP.parseAsRoot(["computer-use", "windows", "--app", "TextEdit", "--on-screen-only"])
        as? SP.ComputerUseWindows
    )
    let snapshot = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "snapshot",
        "--pid",
        "123",
        "--window",
        "456",
        "--image-out",
        "/tmp/window.png",
        "--query",
        "save",
        "--mode",
        "som",
      ]) as? SP.ComputerUseSnapshot
    )
    let click = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "click",
        "--pid",
        "123",
        "--window",
        "456",
        "--element",
        "7",
        "--action",
        "open",
      ]) as? SP.ComputerUseClick
    )
    let coordinateClick = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "click",
        "--pid",
        "123",
        "--window",
        "456",
        "--x",
        "320",
        "--y",
        "240",
        "--button",
        "right",
        "--count",
        "2",
        "--modifier",
        "cmd",
        "--modifier",
        "alt",
      ]) as? SP.ComputerUseClick
    )
    #expect(type(of: permissions) == SP.ComputerUsePermissions.self)
    #expect(launch.bundleID == "com.apple.TextEdit")
    #expect(launch.url == ["file:///tmp/example.txt"])
    #expect(launch.argument == ["--foreground"])
    #expect(launch.env.count == 1)
    #expect(launch.env.first?.key == "FOO")
    #expect(launch.env.first?.value == "bar")
    #expect(launch.electronDebuggingPort == 9222)
    #expect(launch.webkitInspectorPort == 9226)
    #expect(launch.createsNewInstance)
    #expect(windows.app == "TextEdit")
    #expect(windows.onScreenOnly)
    #expect(snapshot.pid == 123)
    #expect(snapshot.window == 456)
    #expect(snapshot.imageOutputPath == "/tmp/window.png")
    #expect(snapshot.query == "save")
    #expect(snapshot.mode == .som)
    #expect(click.element == 7)
    #expect(click.action == .open)
    #expect(coordinateClick.x == 320)
    #expect(coordinateClick.y == 240)
    #expect(coordinateClick.button == .right)
    #expect(coordinateClick.count == 2)
    #expect(coordinateClick.modifier == [.command, .option])
  }

  @Test
  func computerUseParserAcceptsSnapshotJavaScriptAndDebugClick() throws {
    let snapshot = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "snapshot",
        "--pid",
        "123",
        "--window",
        "456",
        "--javascript",
        "document.title",
      ]) as? SP.ComputerUseSnapshot
    )
    let coordinateClick = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "click",
        "--pid",
        "123",
        "--window",
        "456",
        "--x",
        "320",
        "--y",
        "240",
        "--debug-image-out",
        "/tmp/click.png",
      ]) as? SP.ComputerUseClick
    )

    #expect(snapshot.javascript == "document.title")
    #expect(coordinateClick.debugImageOutputPath == "/tmp/click.png")
  }

  @Test
  func computerUseParserAcceptsScreenAndCursorSubcommands() throws {
    let screenSize = try #require(
      try SP.parseAsRoot(["computer-use", "screen-size"]) as? SP.ComputerUseScreenSize
    )
    let cursorPosition = try #require(
      try SP.parseAsRoot(["computer-use", "cursor", "position"]) as? SP.ComputerUseCursorPosition
    )
    let cursorMove = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "cursor",
        "move",
        "--x",
        "12",
        "--y",
        "34",
      ]) as? SP.ComputerUseCursorMove
    )
    let cursorSet = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "cursor",
        "set",
        "--enable",
        "--always-float",
        "--glide-ms",
        "10",
        "--dwell-ms",
        "20",
      ]) as? SP.ComputerUseCursorSet
    )
    #expect(type(of: screenSize) == SP.ComputerUseScreenSize.self)
    #expect(type(of: cursorPosition) == SP.ComputerUseCursorPosition.self)
    #expect(cursorMove.x == 12)
    #expect(cursorMove.y == 34)
    #expect(cursorSet.enable)
    #expect(cursorSet.alwaysFloat)
    #expect(cursorSet.glideMilliseconds == 10)
    #expect(cursorSet.dwellMilliseconds == 20)
  }

  @Test
  func computerUseParserAcceptsCaptureAndInputSubcommands() throws {
    let screenshot = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "screenshot",
        "--window",
        "456",
        "--image-out",
        "/tmp/screen.jpg",
        "--format",
        "jpeg",
        "--quality",
        "0.85",
      ]) as? SP.ComputerUseScreenshot
    )
    let zoom = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "zoom",
        "--pid",
        "123",
        "--window",
        "456",
        "--x",
        "1",
        "--y",
        "2",
        "--width",
        "30",
        "--height",
        "40",
        "--image-out",
        "/tmp/zoom.png",
      ]) as? SP.ComputerUseZoom
    )
    let typeChars = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "type-chars",
        "--pid",
        "123",
        "--delay-ms",
        "10",
        "hello",
      ]) as? SP.ComputerUseTypeChars
    )
    let hotkey = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "hotkey",
        "--pid",
        "123",
        "--window",
        "456",
        "cmd+shift+p",
      ]) as? SP.ComputerUseHotkey
    )

    #expect(screenshot.window == 456)
    #expect(screenshot.format == .jpeg)
    #expect(screenshot.quality == 0.85)
    #expect(zoom.width == 30)
    #expect(zoom.height == 40)
    #expect(typeChars.text == "hello")
    #expect(typeChars.delayMilliseconds == 10)
    #expect(hotkey.combo == "cmd+shift+p")
  }

  @Test
  func computerUseParserAcceptsRecordingSubcommands() throws {
    let recordingStart = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "recording",
        "start",
        "--directory",
        "/tmp/run",
      ]) as? SP.ComputerUseRecordingStart
    )
    let recordingReplay = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "recording",
        "replay",
        "--directory",
        "/tmp/run",
        "--delay-ms",
        "5",
        "--keep-going",
      ]) as? SP.ComputerUseRecordingReplay
    )
    let recordingRender = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "recording",
        "render",
        "--directory",
        "/tmp/run",
        "--output",
        "/tmp/run.mp4",
      ]) as? SP.ComputerUseRecordingRender
    )

    #expect(recordingStart.directory == "/tmp/run")
    #expect(recordingReplay.delayMilliseconds == 5)
    #expect(recordingReplay.keepGoing)
    #expect(recordingRender.outputPath == "/tmp/run.mp4")
  }

  @Test
  func computerUseParserAcceptsPageSubcommands() throws {
    let getText = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "page",
        "get-text",
        "--pid",
        "123",
        "--window",
        "456",
      ]) as? SP.ComputerUsePageGetText
    )
    let queryDOM = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "page",
        "query-dom",
        "--pid",
        "123",
        "--window",
        "456",
        "--selector",
        "a",
        "--attribute",
        "href",
      ]) as? SP.ComputerUsePageQueryDOM
    )
    let executeJavaScript = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "page",
        "execute-javascript",
        "--pid",
        "123",
        "--window",
        "456",
        "(() => document.title)()",
      ]) as? SP.ComputerUsePageExecuteJavaScript
    )
    let enable = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "page",
        "enable-javascript-apple-events",
        "--browser",
        "brave",
      ]) as? SP.ComputerUsePageEnableJavaScriptAppleEvents
    )

    #expect(getText.pid == 123)
    #expect(getText.window == 456)
    #expect(queryDOM.selector == "a")
    #expect(queryDOM.attribute == ["href"])
    #expect(executeJavaScript.javascript == "(() => document.title)()")
    #expect(enable.browser == .brave)
    #expect(throws: (any Error).self) {
      try SP.parseAsRoot([
        "computer-use",
        "page",
        "enable-javascript-apple-events",
        "--bundle-id",
        "com.google.Chrome",
      ])
    }
  }

  @Test
  func computerUseParserAcceptsInputTargeting() throws {
    let typeCommand = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "type",
        "--pid",
        "123",
        "--window",
        "456",
        "--element",
        "7",
        "--delay-ms",
        "0",
        "hello",
      ]) as? SP.ComputerUseType
    )
    let key = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "key",
        "--pid",
        "123",
        "--window",
        "456",
        "--element",
        "7",
        "--modifier",
        "command",
        "s",
      ]) as? SP.ComputerUseKey
    )
    let scroll = try #require(
      try SP.parseAsRoot([
        "computer-use",
        "scroll",
        "--pid",
        "123",
        "--window",
        "456",
        "--element",
        "7",
        "--direction",
        "down",
        "--unit",
        "page",
        "--amount",
        "2",
      ]) as? SP.ComputerUseScroll
    )

    #expect(typeCommand.window == 456)
    #expect(typeCommand.element == 7)
    #expect(typeCommand.delayMilliseconds == 0)
    #expect(typeCommand.text == "hello")
    #expect(key.window == 456)
    #expect(key.element == 7)
    #expect(key.modifier == [.command])
    #expect(key.key == "s")
    #expect(scroll.element == 7)
    #expect(scroll.unit == .page)
    #expect(scroll.amount == 2)
  }

  @Test
  func configParserAcceptsValidateSubcommand() throws {
    let command = try #require(
      try SP.parseAsRoot(["config", "validate", "--path", "./settings.toml"]) as? SP.ValidateConfig
    )

    #expect(command.path == "./settings.toml")
  }

  @Test
  func tabFocusAndPaneSendParsersAcceptPublicShape() throws {
    let focusCommand = try #require(
      try SP.parseAsRoot(["tab", "focus", "1/2"]) as? SP.SelectTab
    )
    let sendCommand = try #require(
      try SP.parseAsRoot(["pane", "send", "1/2/3", "pwd"]) as? SP.SendText
    )

    #expect(focusCommand.tab == .path(spaceIndex: 1, tabIndex: 2))
    #expect(sendCommand.arguments == ["1/2/3", "pwd"])
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

  @Test
  func startupCommandRejectsEmptyScript() {
    do {
      _ = try startupCommand(script: "", tokens: [])
      Issue.record("Expected startupCommand to reject an empty --script.")
    } catch {
      let message = String(describing: error)
      #expect(message.contains("--script must not be empty."))
    }
  }

  @Test
  func startupCommandPreservesScriptText() throws {
    #expect(try startupCommand(script: "echo 1\necho 2", tokens: []) == "echo 1\necho 2")
    #expect(try startupCommand(script: "echo 1\necho 2\n", tokens: []) == "echo 1\necho 2\n")
  }

  @Test
  func startupCommandEscapesTokenCommands() throws {
    #expect(try startupCommand(script: nil, tokens: ["pwd"]) == "pwd")
    #expect(
      try startupCommand(script: nil, tokens: ["echo", "hello world"]) == "echo 'hello world'")
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
          || message.contains("space/tab")
          || message.contains("space/tab/pane")
          || message.localizedCaseInsensitiveContains("invalid")
      )
    }
  }
}
