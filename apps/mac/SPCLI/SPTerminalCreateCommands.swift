import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct NewTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "new",
      abstract: "Create a new tab inside a Supaterm space.",
      discussion: SPHelp.newTabDiscussion
    )

    @Option(name: .long, help: "Start the new tab in the specified working directory.")
    var cwd: String?

    @Option(
      name: .customLong("in"),
      help: "Create the new tab in the specified space.",
      transform: parseSpaceReference
    )
    var space: SPSpaceReference?

    @Flag(inversion: .prefixedNo, help: "Focus the new tab after creating it.")
    var focus = false

    @Option(name: .long, help: "Create the new tab in the specified project.")
    var project: String?

    @OptionGroup
    var options: SPCommandOptions

    @Option(name: .customLong("script"), help: "Shell script to run as the new tab startup command.")
    var script: String?

    @Argument(help: "Command and arguments to run when the new tab opens.")
    var input: [String] = []

    mutating func run() throws {
      try validate()
      try runControlCommand(
        options: options,
        request: { try .newTab(try requestPayload(client: $0)) },
        as: SupatermNewTabResult.self,
        plain: { plainTabSelector(spaceIndex: $0.spaceIndex, tabIndex: $0.tabIndex) },
        human: {
          "window \($0.windowIndex) space \($0.spaceIndex) tab \($0.tabIndex) pane \($0.paneIndex)"
        }
      )
    }

    func validate() throws {
      try validateStartupCommand(script: script, tokens: input)
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNewTabRequest {
      try requestPayload(
        context: SupatermCLIContext.current,
        snapshot: treeSnapshot(client)
      )
    }

    func requestPayload(
      context: SupatermCLIContext?,
      snapshot: SupatermTreeSnapshot
    ) throws -> SupatermNewTabRequest {
      let command = try startupCommand(script: script, tokens: input)
      let cwd = try resolvedWorkingDirectory(cwd)
      switch try resolvePublicNewTabTarget(
        space,
        context: context,
        snapshot: snapshot
      ) {
      case .context(let contextPaneID):
        return SupatermNewTabRequest(
          startupCommand: command,
          contextPaneID: contextPaneID,
          cwd: cwd,
          focus: focus,
          project: project
        )

      case .space(let windowIndex, let spaceIndex):
        return SupatermNewTabRequest(
          startupCommand: command,
          cwd: cwd,
          focus: focus,
          project: project,
          targetWindowIndex: windowIndex,
          targetSpaceIndex: spaceIndex
        )
      }
    }
  }

  struct NewPane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "split",
      abstract: "Create a new pane beside an existing Supaterm pane.",
      discussion: SPHelp.newPaneDiscussion
    )

    enum PaneDirectionArgument: String, CaseIterable, ExpressibleByArgument {
      case down
      case left
      case right
      case up

      var direction: SupatermPaneDirection {
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

    enum LayoutOption: String, CaseIterable, ExpressibleByArgument {
      case equalize
      case keep
    }

    @Argument(help: "Direction for the new pane.")
    var direction: PaneDirectionArgument = .right

    @Option(
      name: .customLong("in"),
      help: "Split inside the specified tab or beside the specified pane.",
      transform: parseContainerReference
    )
    var container: SPContainerReference?

    @Option(name: .long, help: "Start the new pane in the specified working directory.")
    var cwd: String?

    @Flag(inversion: .prefixedNo, help: "Focus the new pane after creating it.")
    var focus = true

    @Option(name: .customLong("layout"), help: "Pane layout after splitting.")
    var layout: LayoutOption = .equalize

    @OptionGroup
    var options: SPCommandOptions

    @Option(name: .customLong("script"), help: "Shell script to run as the new pane startup command.")
    var script: String?

    @Argument(help: "Command and arguments to run when the new pane opens.")
    var input: [String] = []

    mutating func run() throws {
      try validate()
      try runControlCommand(
        options: options,
        request: { try .newPane(try requestPayload(client: $0)) },
        as: SupatermNewPaneResult.self,
        plain: {
          plainPaneSelector(spaceIndex: $0.spaceIndex, tabIndex: $0.tabIndex, paneIndex: $0.paneIndex)
        },
        human: {
          "window \($0.windowIndex) space \($0.spaceIndex) tab \($0.tabIndex) pane \($0.paneIndex)"
        }
      )
    }

    func validate() throws {
      try validateStartupCommand(script: script, tokens: input)
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNewPaneRequest {
      let command = try startupCommand(script: script, tokens: input)
      let cwd = try resolvedWorkingDirectory(cwd)
      switch try resolvePublicSplitTarget(
        container,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
      case .context(let contextPaneID):
        return SupatermNewPaneRequest(
          startupCommand: command,
          contextPaneID: contextPaneID,
          cwd: cwd,
          direction: direction.direction,
          focus: focus,
          equalize: layout == .equalize
        )

      case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
        return SupatermNewPaneRequest(
          startupCommand: command,
          cwd: cwd,
          direction: direction.direction,
          focus: focus,
          equalize: layout == .equalize,
          targetWindowIndex: windowIndex,
          targetSpaceIndex: spaceIndex,
          targetTabIndex: tabIndex,
          targetPaneIndex: paneIndex
        )

      case .tab(let windowIndex, let spaceIndex, let tabIndex):
        return SupatermNewPaneRequest(
          startupCommand: command,
          cwd: cwd,
          direction: direction.direction,
          focus: focus,
          equalize: layout == .equalize,
          targetWindowIndex: windowIndex,
          targetSpaceIndex: spaceIndex,
          targetTabIndex: tabIndex
        )
      }
    }
  }

  struct Notify: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "notify",
      abstract: "Send a notification to a Supaterm pane.",
      discussion: SPHelp.notifyDiscussion
    )

    @Option(name: .long, help: "Notification title. Defaults to the target tab title.")
    var title: String?

    @Option(name: .long, help: "Notification subtitle.")
    var subtitle = ""

    @Option(name: .long, help: "Notification body.")
    var body: String?

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { try .notify(try requestPayload(client: $0)) },
        as: SupatermNotifyResult.self,
        plain: {
          plainPaneSelector(spaceIndex: $0.spaceIndex, tabIndex: $0.tabIndex, paneIndex: $0.paneIndex)
        },
        human: {
          "window \($0.windowIndex) space \($0.spaceIndex) tab \($0.tabIndex) pane \($0.paneIndex)"
        }
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNotifyRequest {
      let body = body ?? ""
      switch try resolvePublicPaneTarget(
        pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      ) {
      case .context(let contextPaneID):
        return .init(
          body: body,
          contextPaneID: contextPaneID,
          subtitle: subtitle,
          title: title
        )

      case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
        return .init(
          body: body,
          subtitle: subtitle,
          targetPaneIndex: paneIndex,
          targetSpaceIndex: spaceIndex,
          targetTabIndex: tabIndex,
          targetWindowIndex: windowIndex,
          title: title
        )

      }
    }
  }
}
