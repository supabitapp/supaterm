import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct FocusPane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "focus-pane",
      abstract: "Focus a pane in Supaterm.",
      discussion: SPHelp.focusPaneDiscussion
    )

    @Option(
      name: .long,
      help: "Target a pane inside the specified tab by its 1-based index or UUID.",
      transform: parsePaneTarget
    )
    var pane: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a space by its 1-based index or UUID.",
      transform: parseSpaceTarget
    )
    var space: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a tab inside the specified space by its 1-based index or UUID.",
      transform: parseTabTarget
    )
    var tab: SPTargetSelector?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.focusPane(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermFocusPaneResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print(render(result.target))
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermPaneTargetRequest {
      switch try SPTargetResolver.resolvePaneOnlyTarget(
        window: window,
        space: space,
        tab: tab,
        pane: pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
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
  }

  struct ClosePane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "close-pane",
      abstract: "Close a pane in Supaterm.",
      discussion: SPHelp.closePaneDiscussion
    )

    @Option(
      name: .long,
      help: "Target a pane inside the specified tab by its 1-based index or UUID.",
      transform: parsePaneTarget
    )
    var pane: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a space by its 1-based index or UUID.",
      transform: parseSpaceTarget
    )
    var space: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a tab inside the specified space by its 1-based index or UUID.",
      transform: parseTabTarget
    )
    var tab: SPTargetSelector?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.closePane(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermClosePaneResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print(render(result))
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermPaneTargetRequest {
      switch try SPTargetResolver.resolvePaneOnlyTarget(
        window: window,
        space: space,
        tab: tab,
        pane: pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
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
  }

  struct SelectTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "select-tab",
      abstract: "Select a tab in Supaterm.",
      discussion: SPHelp.selectTabDiscussion
    )

    @Option(
      name: .long,
      help: "Target a space by its 1-based index or UUID.",
      transform: parseSpaceTarget
    )
    var space: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a tab inside the specified space by its 1-based index or UUID.",
      transform: parseTabTarget
    )
    var tab: SPTargetSelector?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.selectTab(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermSelectTabResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print(render(result))
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermTabTargetRequest {
      switch try SPTargetResolver.resolveTabTarget(
        window: window,
        space: space,
        tab: tab,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
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
  }

  struct CloseTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "close-tab",
      abstract: "Close a tab in Supaterm.",
      discussion: SPHelp.closeTabDiscussion
    )

    @Option(
      name: .long,
      help: "Target a space by its 1-based index or UUID.",
      transform: parseSpaceTarget
    )
    var space: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a tab inside the specified space by its 1-based index or UUID.",
      transform: parseTabTarget
    )
    var tab: SPTargetSelector?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.closeTab(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermCloseTabResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print(render(result))
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermTabTargetRequest {
      switch try SPTargetResolver.resolveTabTarget(
        window: window,
        space: space,
        tab: tab,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
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
  }

  struct SendText: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "send-text",
      abstract: "Send literal text to a Supaterm pane.",
      discussion: SPHelp.sendTextDiscussion
    )

    @Option(name: .long, help: "Literal text to send.")
    var text: String?

    @Flag(name: .long, help: "Append a newline after the provided text.")
    var newline = false

    @Option(
      name: .long,
      help: "Target a pane inside the specified tab by its 1-based index or UUID.",
      transform: parsePaneTarget
    )
    var pane: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a space by its 1-based index or UUID.",
      transform: parseSpaceTarget
    )
    var space: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a tab inside the specified space by its 1-based index or UUID.",
      transform: parseTabTarget
    )
    var tab: SPTargetSelector?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.sendText(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermSendTextResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print(render(result))
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermSendTextRequest {
      guard let text else {
        throw ValidationError("--text is required.")
      }
      let resolvedText = newline ? "\(text)\n" : text
      switch try SPTargetResolver.resolvePaneOnlyTarget(
        window: window,
        space: space,
        tab: tab,
        pane: pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
      case .context(let contextPaneID):
        return .init(
          target: .init(contextPaneID: contextPaneID),
          text: resolvedText
        )
      case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
        return .init(
          target: .init(
            targetWindowIndex: windowIndex,
            targetSpaceIndex: spaceIndex,
            targetTabIndex: tabIndex,
            targetPaneIndex: paneIndex
          ),
          text: resolvedText
        )
      }
    }
  }

  struct CapturePane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "capture-pane",
      abstract: "Capture text from a Supaterm pane.",
      discussion: SPHelp.capturePaneDiscussion
    )

    @Flag(name: .long, help: "Include scrollback instead of just the visible screen.")
    var scrollback = false

    @Option(name: .long, help: "Return only the last N lines.")
    var lines: Int?

    @Option(
      name: .long,
      help: "Target a pane inside the specified tab by its 1-based index or UUID.",
      transform: parsePaneTarget
    )
    var pane: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a space by its 1-based index or UUID.",
      transform: parseSpaceTarget
    )
    var space: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a tab inside the specified space by its 1-based index or UUID.",
      transform: parseTabTarget
    )
    var tab: SPTargetSelector?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      if let lines, lines < 1 {
        throw ValidationError("--lines must be 1 or greater.")
      }
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.capturePane(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermCapturePaneResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print(result.text)
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermCapturePaneRequest {
      switch try SPTargetResolver.resolvePaneOnlyTarget(
        window: window,
        space: space,
        tab: tab,
        pane: pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
      case .context(let contextPaneID):
        return .init(
          lines: lines,
          scope: scrollback ? .scrollback : .visible,
          target: .init(contextPaneID: contextPaneID)
        )
      case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
        return .init(
          lines: lines,
          scope: scrollback ? .scrollback : .visible,
          target: .init(
            targetWindowIndex: windowIndex,
            targetSpaceIndex: spaceIndex,
            targetTabIndex: tabIndex,
            targetPaneIndex: paneIndex
          )
        )
      }
    }
  }

  struct ResizePane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "resize-pane",
      abstract: "Resize a Supaterm pane split.",
      discussion: SPHelp.resizePaneDiscussion
    )

    enum DirectionArgument: String, CaseIterable, ExpressibleByArgument {
      case down
      case left
      case right
      case up
    }

    @Argument(help: "Direction to resize toward.")
    var direction: DirectionArgument

    @Argument(help: "Amount in cells to resize.")
    var amount: UInt16

    @Option(
      name: .long,
      help: "Target a pane inside the specified tab by its 1-based index or UUID.",
      transform: parsePaneTarget
    )
    var pane: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a space by its 1-based index or UUID.",
      transform: parseSpaceTarget
    )
    var space: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a tab inside the specified space by its 1-based index or UUID.",
      transform: parseTabTarget
    )
    var tab: SPTargetSelector?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.resizePane(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermResizePaneResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print(render(result))
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermResizePaneRequest {
      let resolvedDirection: SupatermResizePaneDirection =
        switch direction {
        case .down: .down
        case .left: .left
        case .right: .right
        case .up: .up
        }
      switch try SPTargetResolver.resolvePaneOnlyTarget(
        window: window,
        space: space,
        tab: tab,
        pane: pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
      case .context(let contextPaneID):
        return .init(
          amount: amount,
          direction: resolvedDirection,
          target: .init(contextPaneID: contextPaneID)
        )
      case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
        return .init(
          amount: amount,
          direction: resolvedDirection,
          target: .init(
            targetWindowIndex: windowIndex,
            targetSpaceIndex: spaceIndex,
            targetTabIndex: tabIndex,
            targetPaneIndex: paneIndex
          )
        )
      }
    }
  }

  struct RenameTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "rename-tab",
      abstract: "Lock a Supaterm tab title or clear the lock.",
      discussion: SPHelp.renameTabDiscussion
    )

    @Option(name: .long, help: "Locked title to apply. Pass an empty string to clear the lock.")
    var title: String?

    @Option(
      name: .long,
      help: "Target a space by its 1-based index or UUID.",
      transform: parseSpaceTarget
    )
    var space: SPTargetSelector?

    @Option(
      name: .long,
      help: "Target a tab inside the specified space by its 1-based index or UUID.",
      transform: parseTabTarget
    )
    var tab: SPTargetSelector?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      guard title != nil else {
        throw ValidationError("--title is required.")
      }
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.renameTab(try requestPayload(client: client)))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermRenameTabResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print(render(result.target))
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermRenameTabRequest {
      switch try SPTargetResolver.resolveTabTarget(
        window: window,
        space: space,
        tab: tab,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
      case .context(let contextPaneID):
        return .init(
          target: .init(contextPaneID: contextPaneID),
          title: title
        )
      case .tab(let windowIndex, let spaceIndex, let tabIndex):
        return .init(
          target: .init(
            targetWindowIndex: windowIndex,
            targetSpaceIndex: spaceIndex,
            targetTabIndex: tabIndex
          ),
          title: title
        )
      }
    }
  }
}

private func render(_ target: SupatermPaneTarget) -> String {
  "window \(target.windowIndex) space \(target.spaceIndex) tab \(target.tabIndex) pane \(target.paneIndex)"
}

private func render(_ target: SupatermTabTarget) -> String {
  "window \(target.windowIndex) space \(target.spaceIndex) tab \(target.tabIndex)"
}

private func render(_ result: SupatermSelectTabResult) -> String {
  "window \(result.target.windowIndex) space \(result.target.spaceIndex) tab \(result.target.tabIndex) pane \(result.paneIndex)"
}
