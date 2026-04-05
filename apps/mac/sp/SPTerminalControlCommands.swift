import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct Space: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "space",
      abstract: "Create, select, and manage spaces.",
      discussion: SPHelp.spaceDiscussion,
      subcommands: [
        SpaceNew.self,
        SpaceFocus.self,
        SpaceClose.self,
        SpaceRename.self,
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
        CloseTab.self,
        RenameTab.self,
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
        CapturePane.self,
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
  struct SpaceNew: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "new",
      abstract: "Create a new space.",
      discussion: SPHelp.spaceNewDiscussion
    )

    @Flag(name: .long, help: "Focus the new space after creating it.")
    var focus = false

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let snapshot = try treeSnapshot(client)
      var previousTarget: SPResolvedSpaceTarget?
      if !focus {
        previousTarget = try resolvePublicSpaceTarget(
          nil,
          context: SupatermCLIContext.current,
          snapshot: snapshot
        )
      }

      let response = try client.send(
        .createSpace(
          .init(
            name: nil,
            target: try resolvePublicSpaceNavigationRequest(
              context: SupatermCLIContext.current,
              snapshot: snapshot
            )
          )
        )
      )
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermCreateSpaceResult.self)

      if let previousTarget {
        let restoreResponse = try client.send(.selectSpace(spaceTargetRequest(previousTarget)))
        guard restoreResponse.ok else {
          throw ValidationError(restoreResponse.error?.message ?? "Supaterm socket request failed.")
        }
      }

      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainSpaceSelector(spaceIndex: result.target.spaceIndex),
        human: render(result)
      )
    }
  }

  struct SpaceFocus: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "focus",
      abstract: "Select a space.",
      discussion: SPHelp.spaceFocusDiscussion
    )

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
      let response = try client.send(.selectSpace(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermSelectSpaceResult.self)
      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainSpaceSelector(spaceIndex: result.target.spaceIndex),
        human: render(result)
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermSpaceTargetRequest {
      spaceTargetRequest(
        try resolvePublicSpaceTarget(
          space,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
    }
  }

  struct SpaceClose: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "close",
      abstract: "Close a space.",
      discussion: SPHelp.spaceCloseDiscussion
    )

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
      let response = try client.send(.closeSpace(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermCloseSpaceResult.self)
      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainSpaceSelector(spaceIndex: result.spaceIndex),
        human: render(result)
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermSpaceTargetRequest {
      spaceTargetRequest(
        try resolvePublicSpaceTarget(
          space,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
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
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.renameSpace(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermSpaceTarget.self)
      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainSpaceSelector(spaceIndex: result.spaceIndex),
        human: render(result)
      )
    }

    func validate() throws {
      guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw ValidationError("Space names must not be empty.")
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermRenameSpaceRequest {
      .init(
        target: spaceTargetRequest(
          try resolvePublicSpaceTarget(
            space,
            context: SupatermCLIContext.current,
            snapshot: try treeSnapshot(client)
          )
        ),
        name: name
      )
    }
  }

  struct SpaceNext: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "next",
      abstract: "Select the next space.",
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
      abstract: "Select the previous space.",
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
      abstract: "Return to the previously selected space.",
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
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.focusPane(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermFocusPaneResult.self)
      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainPaneSelector(
          spaceIndex: result.target.spaceIndex,
          tabIndex: result.target.tabIndex,
          paneIndex: result.target.paneIndex
        ),
        human: render(result.target)
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermPaneTargetRequest {
      paneTargetRequest(
        try resolvePublicPaneTarget(
          pane,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
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
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.closePane(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermClosePaneResult.self)
      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainPaneSelector(
          spaceIndex: result.spaceIndex,
          tabIndex: result.tabIndex,
          paneIndex: result.paneIndex
        ),
        human: render(result)
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermPaneTargetRequest {
      paneTargetRequest(
        try resolvePublicPaneTarget(
          pane,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
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
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.selectTab(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermSelectTabResult.self)
      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainTabSelector(spaceIndex: result.target.spaceIndex, tabIndex: result.target.tabIndex),
        human: render(result)
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermTabTargetRequest {
      tabTargetRequest(
        try resolvePublicTabTarget(
          tab,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
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
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.closeTab(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermCloseTabResult.self)
      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainTabSelector(spaceIndex: result.spaceIndex, tabIndex: result.tabIndex),
        human: render(result)
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermTabTargetRequest {
      tabTargetRequest(
        try resolvePublicTabTarget(
          tab,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
    }
  }

  struct SendText: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "send",
      abstract: "Send literal text to a Supaterm pane.",
      discussion: SPHelp.sendTextDiscussion
    )

    @Flag(name: .long, help: "Append a newline after the provided text.")
    var newline = false

    @OptionGroup
    var options: SPCommandOptions

    @Argument(parsing: .remaining, help: "Optional pane target followed by text or `-` for stdin.")
    var arguments: [String] = []

    mutating func run() throws {
      applyOutputStyle(options.output)
      let resolvedInput = try resolveInput()
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(
        .sendText(
          try requestPayload(
            client: client,
            resolvedInput: resolvedInput
          )
        )
      )
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermSendTextResult.self)
      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainPaneSelector(
          spaceIndex: result.spaceIndex,
          tabIndex: result.tabIndex,
          paneIndex: result.paneIndex
        ),
        human: render(result)
      )
    }

    private func resolveInput() throws -> SendTextInput {
      switch arguments.count {
      case 0:
        guard stdinHasPipedInput() else {
          throw ValidationError("Provide text or pipe stdin.")
        }
        return .init(target: nil, text: readStandardInput())
      case 1:
        if let pane = tryParsePaneReference(arguments[0]) {
          guard stdinHasPipedInput() else {
            throw ValidationError("Pipe stdin when only a pane target is provided.")
          }
          return .init(target: pane, text: readStandardInput())
        }
        return .init(target: nil, text: try resolveText(arguments[0]))
      case 2:
        guard let pane = tryParsePaneReference(arguments[0]) else {
          throw ValidationError("The first argument must be a pane target.")
        }
        return .init(target: pane, text: try resolveText(arguments[1]))
      default:
        throw ValidationError("Expected at most a pane target and one text argument.")
      }
    }

    private func resolveText(_ argument: String) throws -> String {
      if argument == "-" {
        return readStandardInput()
      }
      return argument
    }

    private func requestPayload(
      client: SPSocketClient,
      resolvedInput: SendTextInput
    ) throws -> SupatermSendTextRequest {
      let text = newline ? resolvedInput.text + "\n" : resolvedInput.text
      return .init(
        target: paneTargetRequest(
          try resolvePublicPaneTarget(
            resolvedInput.target,
            context: SupatermCLIContext.current,
            snapshot: try treeSnapshot(client)
          )
        ),
        text: text
      )
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
      .init(
        lines: lines,
        scope: scope,
        target: paneTargetRequest(
          try resolvePublicPaneTarget(
            pane,
            context: SupatermCLIContext.current,
            snapshot: try treeSnapshot(client)
          )
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

    enum DirectionArgument: String, CaseIterable, ExpressibleByArgument {
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

    @Argument(help: "Direction to resize toward.")
    var direction: DirectionArgument

    @Argument(help: "Amount in cells to resize.")
    var amount: UInt16

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.resizePane(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermResizePaneResult.self)
      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainPaneSelector(
          spaceIndex: result.spaceIndex,
          tabIndex: result.tabIndex,
          paneIndex: result.paneIndex
        ),
        human: render(result)
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermResizePaneRequest {
      .init(
        amount: amount,
        direction: direction.resolved,
        target: paneTargetRequest(
          try resolvePublicPaneTarget(
            pane,
            context: SupatermCLIContext.current,
            snapshot: try treeSnapshot(client)
          )
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
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.renameTab(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermRenameTabResult.self)
      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainTabSelector(spaceIndex: result.target.spaceIndex, tabIndex: result.target.tabIndex),
        human: render(result.target)
      )
    }

    func validate() throws {
      guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw ValidationError("Tab titles must not be empty.")
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermRenameTabRequest {
      .init(
        target: tabTargetRequest(
          try resolvePublicTabTarget(
            tab,
            context: SupatermCLIContext.current,
            snapshot: try treeSnapshot(client)
          )
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

    enum Mode: String, CaseIterable, ExpressibleByArgument {
      case equalize
      case tile
      case mainVertical = "main-vertical"
    }

    @Argument(help: "Layout mode to apply.")
    var mode: Mode

    @Argument(help: "Optional tab target.")
    var tab: SPTabReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let request = tabTargetRequest(
        try resolvePublicTabTarget(
          tab,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
      let response = try client.send(try socketRequest(target: request))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermTabTarget.self)
      try emitMutatingResult(
        result,
        options: options.output,
        plain: plainTabSelector(spaceIndex: result.spaceIndex, tabIndex: result.tabIndex),
        human: render(result)
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

private struct SendTextInput {
  let target: SPPaneReference?
  let text: String
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

private func tryParsePaneReference(_ argument: String) -> SPPaneReference? {
  try? parsePaneReference(argument)
}

private func readStandardInput() -> String {
  String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
}

private func emitMutatingResult<T: Encodable>(
  _ result: T,
  options: SPOutputOptions,
  plain: @autoclosure () -> String,
  human: @autoclosure () -> String
) throws {
  guard !options.quiet else {
    return
  }
  switch options.mode {
  case .json:
    print(try jsonString(result))
  case .plain:
    print(plain())
  case .human:
    print(human())
  }
}

private func spaceTargetRequest(_ target: SPResolvedSpaceTarget) -> SupatermSpaceTargetRequest {
  switch target {
  case .context(let contextPaneID):
    return .init(contextPaneID: contextPaneID)
  case .space(let windowIndex, let spaceIndex):
    return .init(
      targetWindowIndex: windowIndex,
      targetSpaceIndex: spaceIndex
    )
  }
}

private func tabTargetRequest(_ target: SPResolvedTabTarget) -> SupatermTabTargetRequest {
  switch target {
  case .context(let contextPaneID):
    return .init(contextPaneID: contextPaneID)
  case .tab(let windowIndex, let spaceIndex, let tabIndex):
    return .init(
      targetWindowIndex: windowIndex,
      targetSpaceIndex: spaceIndex,
      targetTabIndex: tabIndex
    )
  }
}

private func paneTargetRequest(_ target: SPResolvedPaneOnlyTarget) -> SupatermPaneTargetRequest {
  switch target {
  case .context(let contextPaneID):
    return .init(contextPaneID: contextPaneID)
  case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
    return .init(
      targetWindowIndex: windowIndex,
      targetSpaceIndex: spaceIndex,
      targetTabIndex: tabIndex,
      targetPaneIndex: paneIndex
    )
  }
}

private func runSpaceNavigation(
  _ navigation: SPSpaceNavigationKind,
  options: SPCommandOptions
) throws {
  applyOutputStyle(options.output)
  let client = try socketClient(
    path: options.connection.explicitSocketPath,
    instance: options.connection.instance
  )
  let request = try resolvePublicSpaceNavigationRequest(
    context: SupatermCLIContext.current,
    snapshot: try treeSnapshot(client)
  )
  let response = try client.send(try spaceNavigationRequest(navigation, request: request))
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }
  let result = try response.decodeResult(SupatermSelectSpaceResult.self)
  try emitMutatingResult(
    result,
    options: options.output,
    plain: plainSpaceSelector(spaceIndex: result.target.spaceIndex),
    human: render(result)
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
  applyOutputStyle(options.output)
  let client = try socketClient(
    path: options.connection.explicitSocketPath,
    instance: options.connection.instance
  )
  let request = try resolvePublicTabNavigationRequest(
    space,
    context: SupatermCLIContext.current,
    snapshot: try treeSnapshot(client)
  )
  let response = try client.send(try tabNavigationRequest(navigation, request: request))
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }
  let result = try response.decodeResult(SupatermSelectTabResult.self)
  try emitMutatingResult(
    result,
    options: options.output,
    plain: plainTabSelector(spaceIndex: result.target.spaceIndex, tabIndex: result.target.tabIndex),
    human: render(result)
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

private func render(_ target: SupatermSpaceTarget) -> String {
  "window \(target.windowIndex) space \(target.spaceIndex)"
}

private func render(_ target: SupatermTabTarget) -> String {
  "window \(target.windowIndex) space \(target.spaceIndex) tab \(target.tabIndex)"
}

private func render(_ target: SupatermPaneTarget) -> String {
  "window \(target.windowIndex) space \(target.spaceIndex) tab \(target.tabIndex) pane \(target.paneIndex)"
}

private func render(_ result: SupatermSelectSpaceResult) -> String {
  "window \(result.target.windowIndex) space \(result.target.spaceIndex) tab \(result.tabIndex) pane \(result.paneIndex)"
}

private func render(_ result: SupatermSelectTabResult) -> String {
  "window \(result.target.windowIndex) space \(result.target.spaceIndex) tab \(result.target.tabIndex) pane \(result.paneIndex)"
}
