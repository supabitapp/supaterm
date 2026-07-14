import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct NewTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "new",
      abstract: "Create a new tab inside a Supaterm project.",
      discussion: SPHelp.newTabDiscussion
    )

    @Option(name: .long, help: "Start the new tab in the specified working directory.")
    var cwd: String?

    @Option(
      name: .customLong("in"),
      help: "Create the new tab in the specified project.",
      transform: parseProjectReference
    )
    var project: SPProjectReference?

    @Flag(inversion: .prefixedNo, help: "Focus the new tab after creating it.")
    var focus = false

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
        plain: { "\($0.spaceIndex)/\($0.projectIndex)/\($0.tabIndex)" },
        human: {
          "window \($0.windowIndex) space \($0.spaceIndex) project \($0.projectIndex) tab \($0.tabIndex) pane \($0.paneIndex)"
        }
      )
    }

    func validate() throws {
      try validateStartupCommand(script: script, tokens: input)
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNewTabRequest {
      let command = try startupCommand(script: script, tokens: input)
      let cwd = try resolvedWorkingDirectory(cwd)
      let target = try resolvePublicNewTabTarget(
        project,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      )
      return SupatermNewTabRequest(
        startupCommand: command,
        inheritingFromPaneID: target.inheritingFromPaneID,
        cwd: cwd,
        focus: focus,
        targetWindowIndex: target.windowIndex,
        targetSpaceIndex: target.spaceIndex,
        targetProjectIndex: target.projectIndex
      )
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
          "\($0.spaceIndex)/\($0.projectIndex)/\($0.tabIndex)/\($0.paneIndex)"
        },
        human: {
          "window \($0.windowIndex) space \($0.spaceIndex) project \($0.projectIndex) tab \($0.tabIndex) pane \($0.paneIndex)"
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
      case .pane(let windowIndex, let spaceIndex, let projectIndex, let tabIndex, let paneIndex):
        return SupatermNewPaneRequest(
          startupCommand: command,
          cwd: cwd,
          direction: direction.direction,
          focus: focus,
          equalize: layout == .equalize,
          targetWindowIndex: windowIndex,
          targetSpaceIndex: spaceIndex,
          targetProjectIndex: projectIndex,
          targetTabIndex: tabIndex,
          targetPaneIndex: paneIndex
        )

      case .tab(let windowIndex, let spaceIndex, let projectIndex, let tabIndex):
        return SupatermNewPaneRequest(
          startupCommand: command,
          cwd: cwd,
          direction: direction.direction,
          focus: focus,
          equalize: layout == .equalize,
          targetWindowIndex: windowIndex,
          targetSpaceIndex: spaceIndex,
          targetProjectIndex: projectIndex,
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
      let target = try resolvePublicPaneTarget(
        pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      )
      return .init(
        body: body,
        subtitle: subtitle,
        targetPaneIndex: target.paneIndex,
        targetProjectIndex: target.projectIndex,
        targetSpaceIndex: target.spaceIndex,
        targetTabIndex: target.tabIndex,
        targetWindowIndex: target.windowIndex,
        title: title
      )
    }
  }
}
