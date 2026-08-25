import ArgumentParser
import Foundation
import SupatermCLIShared

enum SPPaneDirectionArgument: String, CaseIterable, ExpressibleByArgument {
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

enum SPPaneLayoutOption: String, CaseIterable, ExpressibleByArgument {
  case equalize
  case keep
}

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
      help: "Create the new tab in the specified space of this window.",
      transform: parseSpaceReference
    )
    var space: SPSpaceReference?

    @Option(
      name: .long,
      help: "Assign the new tab to the specified project.",
      transform: parseProjectReference
    )
    var project: SPProjectReference?

    @Flag(inversion: .prefixedNo, help: "Focus the new tab after creating it.")
    var focus = false

    @OptionGroup
    var options: SPCommandOptions

    @Option(name: .customLong("script"), help: "Raw code for the new tab's login shell to run.")
    var script: String?

    @Argument(help: "Exact executable and arguments to launch directly in the new tab.")
    var input: [String] = []

    mutating func run() throws {
      try validate()
      try runControlCommand(
        options: options,
        request: { try .newTab(try requestPayload(client: $0)) },
        as: SupatermNewTabResult.self,
        plain: { $0.paneID.uuidString.lowercased() },
        human: {
          "window \($0.windowIndex) space \($0.spaceIndex) tab \($0.tabIndex) pane \($0.paneIndex)"
        }
      )
    }

    func validate() throws {
      _ = try terminalStartup(script: script, tokens: input)
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNewTabRequest {
      let startup = try terminalStartup(script: script, tokens: input)
      let cwd = try resolvedWorkingDirectory(cwd)
      let context = SupatermCLIContext.current
      let snapshot = try treeSnapshot(client)
      return SupatermNewTabRequest(
        startupCommand: startup,
        cwd: cwd,
        focus: focus,
        projectID: try project.map {
          try resolvePublicProjectTargetRequest($0, snapshot: snapshot).projectID
        },
        target: try resolvePublicNewTabTarget(space, context: context, snapshot: snapshot),
        context: context
      )
    }
  }

  struct NewPane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "split",
      abstract: "Create a new pane beside an existing Supaterm pane.",
      discussion: SPHelp.newPaneDiscussion
    )

    @Argument(help: "Direction for the new pane.")
    var direction: SPPaneDirectionArgument = .right

    @Option(
      name: .customLong("in"),
      help: "Split inside the specified tab or beside the specified pane.",
      transform: parseContainerReference
    )
    var container: SPContainerReference?

    @Option(name: .long, help: "Start the new pane in the specified working directory.")
    var cwd: String?

    @Flag(inversion: .prefixedNo, help: "Focus the new pane after creating it.")
    var focus = false

    @Option(name: .customLong("layout"), help: "Pane layout after splitting.")
    var layout: SPPaneLayoutOption = .equalize

    @OptionGroup
    var options: SPCommandOptions

    @Option(name: .customLong("script"), help: "Raw code for the new pane's login shell to run.")
    var script: String?

    @Argument(help: "Exact executable and arguments to launch directly in the new pane.")
    var input: [String] = []

    mutating func run() throws {
      try validate()
      try runControlCommand(
        options: options,
        request: { try .newPane(try requestPayload(client: $0)) },
        as: SupatermNewPaneResult.self,
        plain: { $0.paneID.uuidString.lowercased() },
        human: {
          "window \($0.windowIndex) space \($0.spaceIndex) tab \($0.tabIndex) pane \($0.paneIndex)"
        }
      )
    }

    func validate() throws {
      _ = try terminalStartup(script: script, tokens: input)
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermNewPaneRequest {
      let startup = try terminalStartup(script: script, tokens: input)
      let cwd = try resolvedWorkingDirectory(cwd)
      return SupatermNewPaneRequest(
        startupCommand: startup,
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
      return SupatermNotifyRequest(
        body: body,
        paneID: target.paneID,
        subtitle: subtitle,
        title: title
      )
    }
  }
}
