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

    @Option(
      name: .long,
      help: "Create the tab in the specified group.",
      transform: parseGroupReference
    )
    var group: SPGroupReference?

    @Flag(name: .long, help: "Create the tab at the space root.")
    var root = false

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
        plain: { plainTabSelector(spaceIndex: $0.spaceIndex, tabIndex: $0.tabIndex) },
        human: {
          "window \($0.windowIndex) space \($0.spaceIndex) tab \($0.tabIndex) pane \($0.paneIndex)"
        }
      )
    }

    func validate() throws {
      try validateStartupCommand(script: script, tokens: input)
      if group != nil && root {
        throw ValidationError("Provide either --group or --root, not both.")
      }
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNewTabRequest {
      let command = try startupCommand(script: script, tokens: input)
      let cwd = try resolvedWorkingDirectory(cwd)
      let destination = group.map(SPGroupDestinationReference.group) ?? (root ? .root : nil)
      return SupatermNewTabRequest(
        startupCommand: command,
        cwd: cwd,
        focus: focus,
        target: try resolvePublicNewTabPlacement(
          space: space,
          group: destination,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
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
      return SupatermNewPaneRequest(
        startupCommand: command,
        cwd: cwd,
        direction: direction.direction,
        focus: focus,
        equalize: layout == .equalize,
        target: try resolvePublicSplitTarget(
          container,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
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
        paneID: target.paneID,
        subtitle: subtitle,
        title: title
      )
    }
  }
}
