import ArgumentParser
import Foundation
import SupatermCLIShared

private struct SPPaneScreenshotOutput: Encodable {
  let target: SupatermPaneTarget
  let path: String
}

extension SP {
  struct Space: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "space",
      abstract: "List, create, and display spaces.",
      discussion: SPHelp.spaceDiscussion,
      subcommands: [
        SpaceList.self,
        SpaceNew.self,
        SpaceFocus.self,
        SpaceDestroy.self,
        SpaceRename.self,
        SpaceColor.self,
        SpaceNext.self,
        SpacePrev.self,
        SpaceLast.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct Tab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "tab",
      abstract: "Create, select, and manage tabs.",
      discussion: SPHelp.tabDiscussion,
      subcommands: [
        NewTab.self,
        SelectTab.self,
        PinTab.self,
        UnpinTab.self,
        CloseTab.self,
        RenameTab.self,
        MoveTab.self,
        NextTab.self,
        PreviousTab.self,
        LastTab.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct Pane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "pane",
      abstract: "Split, focus, and control panes.",
      discussion: SPHelp.paneDiscussion,
      subcommands: [
        NewPane.self,
        FocusPane.self,
        ClosePane.self,
        SendText.self,
        SendKey.self,
        CapturePane.self,
        ScreenshotPane.self,
        PaneHealth.self,
        PaneWaitReady.self,
        ResizePane.self,
        PaneLayout.self,
        Notify.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }
}

extension SP {
  struct SpaceList: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "ls",
      abstract: "List the spaces this window can display.",
      discussion: SPHelp.spaceListDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let window = try resolvePublicSpaceListing(
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      )
      try emitCommandResult(
        window,
        options: options.output,
        plain: window.spaces.map { plainSpaceRow($0, in: window) }.joined(separator: "\n"),
        human: window.spaces.map { humanSpaceRow($0, in: window) }.joined(separator: "\n")
      )
    }
  }

  struct SpaceNew: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "new",
      abstract: "Create a new space and display it in this window.",
      discussion: SPHelp.spaceNewDiscussion
    )

    @Option(name: .long, help: "Color for the new space; random when omitted.", transform: parseThemeColor)
    var color: SupatermThemeColor?

    @Argument(help: "Name for the new space.")
    var name: String

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try validate()
      try runControlCommand(
        options: options,
        request: { _ in try .createSpace(requestPayload()) },
        as: SupatermCreateSpaceResult.self,
        plain: { plainSpaceSelector(spaceIndex: $0.target.spaceIndex) },
        human: { render($0) }
      )
    }

    func validate() throws {
      guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw ValidationError("Space names must not be empty.")
      }
    }

    private func requestPayload() -> SupatermCreateSpaceRequest {
      SupatermCreateSpaceRequest(
        color: color,
        name: name,
        context: SupatermCLIContext.current
      )
    }
  }

  struct SpaceFocus: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "focus",
      abstract: "Display a space in this window.",
      discussion: SPHelp.spaceFocusDiscussion
    )

    @Argument(help: "Optional space target.")
    var space: SPSpaceReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { try .selectSpace(try requestPayload(client: $0)) },
        as: SupatermSelectSpaceResult.self,
        plain: { plainSpaceSelector(spaceIndex: $0.target.spaceIndex) },
        human: { render($0) }
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermSpaceTargetRequest {
      try resolvePublicSpaceTarget(
        space,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      )
    }
  }

  struct SpaceDestroy: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "destroy",
      abstract: "Destroy a space.",
      discussion: SPHelp.spaceDestroyDiscussion
    )

    @Flag(name: [.customShort("y"), .long], help: "Destroy without interactive confirmation.")
    var yes = false

    @Argument(help: "Optional space target.")
    var space: SPSpaceReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let target = try resolveTarget(client: client)
      if !yes {
        try confirmDestructiveAction(prompt: "Destroy \(destroyPromptTarget(target))? [y/N] ")
      }
      let response = try client.send(.closeSpace(target))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermCloseSpaceResult.self)
      try emitCommandResult(
        result,
        options: options.output,
        plain: plainSpaceSelector(spaceIndex: result.spaceIndex),
        human: render(result)
      )
    }

    private func resolveTarget(client: SPSocketClient) throws -> SupatermSpaceTargetRequest {
      try resolvePublicSpaceTarget(
        space,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      )
    }

    private func destroyPromptTarget(_ target: SupatermSpaceTargetRequest) -> String {
      switch space {
      case nil:
        return "the current space"
      case .index(let spaceIndex):
        return "space \(spaceIndex)"
      case .id:
        return "space \(target.spaceID.uuidString.lowercased())"
      case .short(let reference):
        return "space \(reference)"
      }
    }
  }

  struct SpaceRename: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "rename",
      abstract: "Rename a space.",
      discussion: SPHelp.spaceRenameDiscussion
    )

    @Argument(help: "New space name.")
    var name: String

    @Argument(help: "Optional space target.")
    var space: SPSpaceReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try validate()
      try runControlCommand(
        options: options,
        request: { try .renameSpace(try requestPayload(client: $0)) },
        as: SupatermSpaceTarget.self,
        plain: { plainSpaceSelector(spaceIndex: $0.spaceIndex) },
        human: { render($0) }
      )
    }

    func validate() throws {
      guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw ValidationError("Space names must not be empty.")
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermRenameSpaceRequest {
      SupatermRenameSpaceRequest(
        target: try resolvePublicSpaceTarget(
          space,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        ),
        name: name
      )
    }
  }

  struct SpaceColor: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "color",
      abstract: "Set a space's color.",
      discussion: SPHelp.spaceColorDiscussion
    )

    @Argument(help: "Space color.", transform: parseThemeColor)
    var color: SupatermThemeColor

    @Argument(help: "Optional space target.")
    var space: SPSpaceReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let color = color
      let space = space
      try runControlCommand(
        options: options,
        request: { client in
          try .setSpaceColor(
            SupatermSetSpaceColorRequest(
              color: color,
              target: try resolvePublicSpaceTarget(
                space,
                context: SupatermCLIContext.current,
                snapshot: try treeSnapshot(client)
              )
            )
          )
        },
        as: SupatermSpaceTarget.self,
        plain: { plainSpaceSelector(spaceIndex: $0.spaceIndex) },
        human: { render($0) }
      )
    }
  }

  struct SpaceNext: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "next",
      abstract: "Display the next space in this window.",
      discussion: SPHelp.spaceNavigationDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runSpaceNavigation(.next, options: options)
    }
  }

  struct SpacePrev: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "prev",
      abstract: "Display the previous space in this window.",
      discussion: SPHelp.spaceNavigationDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runSpaceNavigation(.previous, options: options)
    }
  }

  struct SpaceLast: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "last",
      abstract: "Return to the space this window displayed before.",
      discussion: SPHelp.spaceNavigationDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runSpaceNavigation(.last, options: options)
    }
  }
}

extension SP {
  struct FocusPane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "focus",
      abstract: "Focus a pane in Supaterm.",
      discussion: SPHelp.focusPaneDiscussion
    )

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { try .focusPane(try requestPayload(client: $0)) },
        as: SupatermFocusPaneResult.self,
        plain: {
          plainPaneSelector(
            spaceIndex: $0.target.spaceIndex,
            tabIndex: $0.target.tabIndex,
            paneIndex: $0.target.paneIndex
          )
        },
        human: { render($0.target) }
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermPaneTargetRequest {
      try resolvePublicPaneTarget(
        pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      )
    }
  }

  struct ClosePane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "close",
      abstract: "Close a pane in Supaterm.",
      discussion: SPHelp.closePaneDiscussion
    )

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { try .closePane(try requestPayload(client: $0)) },
        as: SupatermClosePaneResult.self,
        plain: {
          plainPaneSelector(
            spaceIndex: $0.spaceIndex,
            tabIndex: $0.tabIndex,
            paneIndex: $0.paneIndex
          )
        },
        human: { render($0) }
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermPaneTargetRequest {
      try resolvePublicPaneTarget(
        pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      )
    }
  }

  struct SelectTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "focus",
      abstract: "Select a tab in Supaterm.",
      discussion: SPHelp.selectTabDiscussion
    )

    @Argument(help: "Optional tab target.")
    var tab: SPTabReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { try .selectTab(try requestPayload(client: $0)) },
        as: SupatermSelectTabResult.self,
        plain: {
          plainTabSelector(spaceIndex: $0.target.spaceIndex, tabIndex: $0.target.tabIndex)
        },
        human: { render($0) }
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermTabTargetRequest {
      try resolvePublicTabTarget(
        tab,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      )
    }
  }

  struct CloseTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "close",
      abstract: "Close a tab in Supaterm.",
      discussion: SPHelp.closeTabDiscussion
    )

    @Argument(help: "Optional tab target.")
    var tab: SPTabReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { try .closeTab(try requestPayload(client: $0)) },
        as: SupatermCloseTabResult.self,
        plain: { plainTabSelector(spaceIndex: $0.spaceIndex, tabIndex: $0.tabIndex) },
        human: { render($0) }
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermTabTargetRequest {
      try resolvePublicTabTarget(
        tab,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      )
    }
  }

  struct PinTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "pin",
      abstract: "Pin a tab in Supaterm.",
      discussion: SPHelp.pinTabDiscussion
    )

    @Argument(help: "Optional tab target.")
    var tab: SPTabReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runTabPinnedState(.pin, tab: tab, options: options)
    }
  }

  struct UnpinTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "unpin",
      abstract: "Unpin a tab in Supaterm.",
      discussion: SPHelp.unpinTabDiscussion
    )

    @Argument(help: "Optional tab target.")
    var tab: SPTabReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runTabPinnedState(.unpin, tab: tab, options: options)
    }
  }

  struct CapturePane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "capture",
      abstract: "Capture text from a Supaterm pane.",
      discussion: SPHelp.capturePaneDiscussion
    )

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @Option(name: .customLong("scope"), help: "Capture visible screen contents or full scrollback.")
    var scope: SupatermCapturePaneScope = .visible

    @Option(name: .long, help: "Return only the last N lines.")
    var lines: Int?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      if let lines, lines < 1 {
        throw ValidationError("--lines must be 1 or greater.")
      }
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.capturePane(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermCapturePaneResult.self)
      switch options.output.mode {
      case .json:
        print(try jsonString(result))
      case .plain, .human:
        print(result.text)
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermCapturePaneRequest {
      SupatermCapturePaneRequest(
        lines: lines,
        scope: scope,
        target: try resolvePublicPaneTarget(
          pane,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
    }
  }

  struct ScreenshotPane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "screenshot",
      abstract: "Save a visible Supaterm pane as a PNG.",
      discussion: SPHelp.screenshotPaneDiscussion
    )

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @Option(
      name: [.customShort("o"), .customLong("output")],
      help: "PNG output path."
    )
    var outputPath: String

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let outputURL = try resolvedCLIOutputFileURL(outputPath)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(
        .screenshotPane(
          try resolvePublicPaneTarget(
            pane,
            context: SupatermCLIContext.current,
            snapshot: try treeSnapshot(client)
          )
        )
      )
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermScreenshotPaneResult.self)
      try result.pngData.write(to: outputURL, options: .atomic)
      let output = SPPaneScreenshotOutput(
        target: result.target,
        path: outputURL.path
      )
      try emitCommandResult(
        output,
        options: options.output,
        plain: output.path,
        human: "Saved pane screenshot to \(output.path)"
      )
    }
  }

  struct PaneHealth: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "health",
      abstract: "Inspect Supaterm pane readiness.",
      discussion: SPHelp.paneHealthDiscussion
    )

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { try .paneHealth(try requestPayload(client: $0)) },
        as: SupatermPaneHealthResult.self,
        plain: { paneHealthSummary($0) },
        human: { paneHealthSummary($0) }
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermPaneHealthRequest {
      SupatermPaneHealthRequest(
        target: try resolvePublicPaneTarget(
          pane,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
    }
  }

  struct PaneWaitReady: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "wait-ready",
      abstract: "Wait for a Supaterm pane to become ready.",
      discussion: SPHelp.paneWaitReadyDiscussion
    )

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @Option(name: .long, help: "Maximum seconds to wait.")
    var timeout: Double = 5

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      guard timeout > 0 else {
        throw ValidationError("--timeout must be greater than 0.")
      }
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let request = try requestPayload(client: client)
      let deadline = Date().addingTimeInterval(timeout)
      var lastResult: SupatermPaneHealthResult?
      while true {
        let response = try client.send(.paneHealth(request))
        guard response.ok else {
          throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
        }
        let result = try response.decodeResult(SupatermPaneHealthResult.self)
        if result.isReady {
          try emitCommandResult(
            result,
            options: options.output,
            plain: paneHealthSummary(result),
            human: paneHealthSummary(result)
          )
          return
        }
        lastResult = result
        if Date() >= deadline {
          break
        }
        Thread.sleep(forTimeInterval: 0.1)
      }
      let summary = lastResult.map(paneHealthSummary) ?? "no health result"
      throw ValidationError("Timed out waiting for pane readiness: \(summary)")
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermPaneHealthRequest {
      SupatermPaneHealthRequest(
        target: try resolvePublicPaneTarget(
          pane,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
    }
  }

  struct ResizePane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "resize",
      abstract: "Resize a Supaterm pane split.",
      discussion: SPHelp.resizePaneDiscussion
    )

    @Argument(help: "Direction to resize toward.")
    var direction: SPResizePaneDirectionArgument

    @Argument(help: "Amount in cells to resize.")
    var amount: UInt16

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { try .resizePane(try requestPayload(client: $0)) },
        as: SupatermResizePaneResult.self,
        plain: {
          plainPaneSelector(
            spaceIndex: $0.spaceIndex,
            tabIndex: $0.tabIndex,
            paneIndex: $0.paneIndex
          )
        },
        human: { render($0) }
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermResizePaneRequest {
      SupatermResizePaneRequest(
        amount: amount,
        direction: direction.resolved,
        target: try resolvePublicPaneTarget(
          pane,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
    }
  }

  struct RenameTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "rename",
      abstract: "Lock a Supaterm tab title.",
      discussion: SPHelp.renameTabDiscussion
    )

    @Argument(help: "Locked title to apply.")
    var title: String

    @Argument(help: "Optional tab target.")
    var tab: SPTabReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try validate()
      try runControlCommand(
        options: options,
        request: { try .renameTab(try requestPayload(client: $0)) },
        as: SupatermRenameTabResult.self,
        plain: {
          plainTabSelector(spaceIndex: $0.target.spaceIndex, tabIndex: $0.target.tabIndex)
        },
        human: { render($0.target) }
      )
    }

    func validate() throws {
      guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw ValidationError("Tab titles must not be empty.")
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermRenameTabRequest {
      SupatermRenameTabRequest(
        target: try resolvePublicTabTarget(
          tab,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        ),
        title: title
      )
    }
  }

  struct NextTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "next",
      abstract: "Select the next tab in a space.",
      discussion: SPHelp.tabNavigationDiscussion
    )

    @Argument(help: "Optional space target.")
    var space: SPSpaceReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runTabNavigation(.next, space: space, options: options)
    }
  }

  struct PreviousTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "prev",
      abstract: "Select the previous tab in a space.",
      discussion: SPHelp.tabNavigationDiscussion
    )

    @Argument(help: "Optional space target.")
    var space: SPSpaceReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runTabNavigation(.previous, space: space, options: options)
    }
  }

  struct LastTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "last",
      abstract: "Return to the previously selected tab in a space.",
      discussion: SPHelp.tabNavigationDiscussion
    )

    @Argument(help: "Optional space target.")
    var space: SPSpaceReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runTabNavigation(.last, space: space, options: options)
    }
  }

  struct PaneLayout: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "layout",
      abstract: "Apply a pane layout to a tab.",
      discussion: SPHelp.paneLayoutDiscussion
    )

    @Argument(help: "Layout mode to apply.")
    var mode: SPPaneLayoutMode

    @Argument(help: "Optional tab target.")
    var tab: SPTabReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { client in
          try socketRequest(
            target: try resolvePublicTabTarget(
              tab,
              context: SupatermCLIContext.current,
              snapshot: try treeSnapshot(client)
            )
          )
        },
        as: SupatermTabTarget.self,
        plain: { plainTabSelector(spaceIndex: $0.spaceIndex, tabIndex: $0.tabIndex) },
        human: { render($0) }
      )
    }

    private func socketRequest(target: SupatermTabTargetRequest) throws -> SupatermSocketRequest {
      switch mode {
      case .equalize:
        return try .equalizePanes(target)
      case .tile:
        return try .tilePanes(target)
      case .mainVertical:
        return try .mainVerticalPanes(target)
      }
    }
  }
}

enum SPResizePaneDirectionArgument: String, CaseIterable, ExpressibleByArgument {
  case down
  case left
  case right
  case up

  var resolved: SupatermResizePaneDirection {
    switch self {
    case .down:
      return .down
    case .left:
      return .left
    case .right:
      return .right
    case .up:
      return .up
    }
  }
}

enum SPPaneLayoutMode: String, CaseIterable, ExpressibleByArgument {
  case equalize
  case tile
  case mainVertical = "main-vertical"
}

private enum SPSpaceNavigationKind {
  case next
  case previous
  case last
}

private enum SPTabNavigationKind {
  case next
  case previous
  case last
}

private enum SPTabPinnedStateKind {
  case pin
  case unpin
}

extension SPSpaceReference: ExpressibleByArgument {
  init?(argument: String) {
    guard let value = try? parseSpaceReference(argument) else {
      return nil
    }
    self = value
  }
}

extension SPTabReference: ExpressibleByArgument {
  init?(argument: String) {
    guard let value = try? parseTabReference(argument) else {
      return nil
    }
    self = value
  }
}

extension SPPaneReference: ExpressibleByArgument {
  init?(argument: String) {
    guard let value = try? parsePaneReference(argument) else {
      return nil
    }
    self = value
  }
}

extension SupatermCapturePaneScope: @retroactive ExpressibleByArgument {}

private func runSpaceNavigation(
  _ navigation: SPSpaceNavigationKind,
  options: SPCommandOptions
) throws {
  try runControlCommand(
    options: options,
    request: { _ in
      try spaceNavigationRequest(
        navigation,
        request: SupatermSpaceNavigationRequest(context: SupatermCLIContext.current)
      )
    },
    as: SupatermSelectSpaceResult.self,
    plain: { plainSpaceSelector(spaceIndex: $0.target.spaceIndex) },
    human: { render($0) }
  )
}

private func spaceNavigationRequest(
  _ navigation: SPSpaceNavigationKind,
  request: SupatermSpaceNavigationRequest
) throws -> SupatermSocketRequest {
  switch navigation {
  case .next:
    return try .nextSpace(request)
  case .previous:
    return try .previousSpace(request)
  case .last:
    return try .lastSpace(request)
  }
}

private func runTabNavigation(
  _ navigation: SPTabNavigationKind,
  space: SPSpaceReference?,
  options: SPCommandOptions
) throws {
  try runControlCommand(
    options: options,
    request: { client in
      try tabNavigationRequest(
        navigation,
        request: try resolvePublicTabNavigationRequest(
          space,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
    },
    as: SupatermSelectTabResult.self,
    plain: { plainTabSelector(spaceIndex: $0.target.spaceIndex, tabIndex: $0.target.tabIndex) },
    human: { render($0) }
  )
}

private func runTabPinnedState(
  _ state: SPTabPinnedStateKind,
  tab: SPTabReference?,
  options: SPCommandOptions
) throws {
  try runControlCommand(
    options: options,
    request: { client in
      try tabPinnedStateRequest(
        state,
        request: try resolvePublicTabTarget(
          tab,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
    },
    as: SupatermPinTabResult.self,
    plain: { plainTabSelector(spaceIndex: $0.target.spaceIndex, tabIndex: $0.target.tabIndex) },
    human: { render($0.target) }
  )
}

private func tabNavigationRequest(
  _ navigation: SPTabNavigationKind,
  request: SupatermTabNavigationRequest
) throws -> SupatermSocketRequest {
  switch navigation {
  case .next:
    return try .nextTab(request)
  case .previous:
    return try .previousTab(request)
  case .last:
    return try .lastTab(request)
  }
}

private func tabPinnedStateRequest(
  _ state: SPTabPinnedStateKind,
  request: SupatermTabTargetRequest
) throws -> SupatermSocketRequest {
  switch state {
  case .pin:
    return try .pinTab(request)
  case .unpin:
    return try .unpinTab(request)
  }
}

private func plainSpaceRow(
  _ space: SupatermTreeSnapshot.Space,
  in window: SupatermTreeSnapshot.Window
) -> String {
  var flags = [space.color.rawValue]
  if space.id == window.displayedSpaceID {
    flags.append("displayed")
  }
  if !space.isWarm {
    flags.append("cold")
  }
  return "\(space.index)\t\(space.id.uuidString.lowercased())\t\(space.name)\t\(flags.joined(separator: ","))"
}

private func humanSpaceRow(
  _ space: SupatermTreeSnapshot.Space,
  in window: SupatermTreeSnapshot.Window
) -> String {
  var labels = [space.color.rawValue]
  if !space.isWarm {
    labels.append("cold")
  }
  let marker = space.id == window.displayedSpaceID ? "*" : " "
  return "\(marker) \(space.index) \(space.id.uuidString.lowercased()) "
    + "\"\(space.name)\" [\(labels.joined(separator: ", "))]"
}

private func render(_ target: SupatermSpaceTarget) -> String {
  "window \(target.windowIndex) space \(target.spaceIndex)"
}

private func render(_ target: SupatermTabTarget) -> String {
  "window \(target.windowIndex) space \(target.spaceIndex) tab \(target.tabIndex)"
}

private func paneHealthSummary(_ result: SupatermPaneHealthResult) -> String {
  "ready=\(result.isReady) surface=\(result.hasSurface) bridge=\(result.hasBridgeSurface) "
    + "attached=\(result.isAttachedToWindow) visible=\(result.isWindowVisible) "
    + "capture=\(result.canCaptureText)"
}

private func render(_ result: SupatermSelectSpaceResult) -> String {
  "window \(result.target.windowIndex) space \(result.target.spaceIndex) "
    + "tab \(result.tabIndex) pane \(result.paneIndex)"
}

private func render(_ result: SupatermSelectTabResult) -> String {
  "window \(result.target.windowIndex) space \(result.target.spaceIndex) "
    + "tab \(result.target.tabIndex) pane \(result.paneIndex)"
}
