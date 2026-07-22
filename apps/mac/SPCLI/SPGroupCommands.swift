import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct Group: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "group",
      abstract: "Create and manage tab groups.",
      discussion: SPHelp.groupDiscussion,
      subcommands: [
        GroupNew.self,
        GroupRename.self,
        GroupColor.self,
        GroupPin.self,
        GroupUnpin.self,
        GroupCollapse.self,
        GroupExpand.self,
        GroupMove.self,
        GroupUngroup.self,
        GroupClose.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct GroupNew: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "new",
      abstract: "Create an empty tab group.",
      discussion: SPHelp.groupNewDiscussion
    )

    @Argument(help: "Title for the new group.")
    var title: String

    @Option(name: .long, help: "Color for the new group.", transform: parseGroupColor)
    var color: SupatermTabGroupColor = .neutral

    @Flag(name: .long, help: "Pin the new group.")
    var pin = false

    @Option(
      name: .customLong("in"),
      help: "Create the group in the specified space.",
      transform: parseSpaceReference
    )
    var space: SPSpaceReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let title = try validatedGroupTitle(title)
      try runControlCommand(
        options: options,
        request: { client in
          let snapshot = try treeSnapshot(client)
          return try .createTabGroup(
            .init(
              color: color,
              isPinned: pin,
              target: try resolvePublicSpaceTarget(
                space,
                context: SupatermCLIContext.current,
                snapshot: snapshot
              ),
              title: title
            )
          )
        },
        as: SupatermTabGroupMutationResult.self,
        plain: { plainGroupSelector($0.group.id) },
        human: { renderGroupMutation($0) }
      )
    }
  }

  struct GroupRename: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "rename",
      abstract: "Rename a tab group.",
      discussion: SPHelp.groupRenameDiscussion
    )

    @Argument(help: "New group title.")
    var title: String

    @Argument(help: "Optional group title or UUID.")
    var group: SPGroupReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let title = try validatedGroupTitle(title)
      try runGroupMutation(
        group,
        options: options,
        request: { try .renameTabGroup(.init(title: title, target: $0)) }
      )
    }
  }

  struct GroupColor: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "color",
      abstract: "Set a tab group's color.",
      discussion: SPHelp.groupColorDiscussion
    )

    @Argument(help: "Group color.", transform: parseGroupColor)
    var color: SupatermTabGroupColor

    @Argument(help: "Optional group title or UUID.")
    var group: SPGroupReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let color = color
      try runGroupMutation(
        group,
        options: options,
        request: { try .setTabGroupColor(.init(color: color, target: $0)) }
      )
    }
  }

  struct GroupPin: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "pin",
      abstract: "Pin a tab group.",
      discussion: SPHelp.groupTargetDiscussion
    )

    @Argument(help: "Optional group title or UUID.")
    var group: SPGroupReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runGroupMutation(group, options: options, request: { try .pinTabGroup($0) })
    }
  }

  struct GroupUnpin: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "unpin",
      abstract: "Unpin a tab group.",
      discussion: SPHelp.groupTargetDiscussion
    )

    @Argument(help: "Optional group title or UUID.")
    var group: SPGroupReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runGroupMutation(group, options: options, request: { try .unpinTabGroup($0) })
    }
  }

  struct GroupCollapse: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "collapse",
      abstract: "Collapse a tab group.",
      discussion: SPHelp.groupTargetDiscussion
    )

    @Argument(help: "Optional group title or UUID.")
    var group: SPGroupReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runGroupMutation(group, options: options, request: { try .collapseTabGroup($0) })
    }
  }

  struct GroupExpand: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "expand",
      abstract: "Expand a tab group.",
      discussion: SPHelp.groupTargetDiscussion
    )

    @Argument(help: "Optional group title or UUID.")
    var group: SPGroupReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runGroupMutation(group, options: options, request: { try .expandTabGroup($0) })
    }
  }

  struct GroupMove: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "move",
      abstract: "Move a tab group within its root lane.",
      discussion: SPHelp.groupMoveDiscussion
    )

    @Argument(help: "Optional group title or UUID.")
    var group: SPGroupReference?

    @Option(name: .long, help: "1-based destination index.")
    var index: Int

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      guard index > 0 else {
        throw ValidationError("--index must be 1 or greater.")
      }
      let index = index
      try runGroupMutation(
        group,
        options: options,
        request: { try .moveTabGroup(.init(index: index, target: $0)) }
      )
    }
  }

  struct GroupUngroup: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "ungroup",
      abstract: "Move a group's tabs to the space root.",
      discussion: SPHelp.groupTargetDiscussion
    )

    @Argument(help: "Optional group title or UUID.")
    var group: SPGroupReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runGroupRemoval(group, options: options, request: { try .ungroupTabGroup($0) })
    }
  }

  struct GroupClose: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "close",
      abstract: "Close a tab group and its tabs.",
      discussion: SPHelp.groupTargetDiscussion
    )

    @Argument(help: "Optional group title or UUID.")
    var group: SPGroupReference?

    @Flag(name: [.customShort("y"), .long], help: "Close without interactive confirmation.")
    var yes = false

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let target = try resolvePublicGroupTargetRequest(
        group,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      )
      if !yes {
        try confirmDestructiveAction(
          prompt: "Close group \(target.groupID.uuidString.lowercased()) and all its tabs? [y/N] "
        )
      }
      let response = try client.send(.closeTabGroup(target))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermRemoveTabGroupResult.self)
      try emitCommandResult(
        result,
        options: options.output,
        plain: plainGroupSelector(result.removedGroupID),
        human:
          "window \(result.windowIndex) space \(result.spaceIndex) removed group \(result.removedGroupID.uuidString.lowercased())"
      )
    }
  }

  struct MoveTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "move",
      abstract: "Move a tab into a group or to the space root.",
      discussion: SPHelp.moveTabDiscussion
    )

    @Argument(help: "Optional tab target.")
    var tab: SPTabReference?

    @Option(name: .long, help: "Destination group title or UUID.", transform: parseGroupReference)
    var group: SPGroupReference?

    @Flag(name: .long, help: "Move the tab to the space root.")
    var root = false

    @Option(name: .long, help: "1-based index within the destination.")
    var index: Int?

    @Flag(name: .long, help: "Pin the tab at the root destination.")
    var pin = false

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let destination = try destinationReference()
      try runControlCommand(
        options: options,
        request: { client in
          try .moveTab(
            try resolvePublicMoveTabRequest(
              tab: tab,
              destination: destination,
              index: index,
              isPinned: pin,
              context: SupatermCLIContext.current,
              snapshot: try treeSnapshot(client)
            )
          )
        },
        as: SupatermMoveTabResult.self,
        plain: {
          plainTabSelector(spaceIndex: $0.target.spaceIndex, tabIndex: $0.target.tabIndex)
        },
        human: {
          "window \($0.target.windowIndex) space \($0.target.spaceIndex) tab \($0.target.tabIndex)"
        }
      )
    }

    func destinationReference() throws -> SPGroupDestinationReference {
      switch (group, root) {
      case (.some(let group), false):
        guard !pin else {
          throw ValidationError("--group cannot be combined with --pin.")
        }
        return .group(group)
      case (nil, true):
        return .root
      case (.some, true):
        throw ValidationError("Provide either --group or --root, not both.")
      case (nil, false):
        throw ValidationError("Provide --group or --root.")
      }
    }
  }
}

func parseGroupColor(_ argument: String) throws -> SupatermTabGroupColor {
  let value = argument.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  guard let color = SupatermTabGroupColor(rawValue: value) else {
    throw ValidationError(
      "Group color must be one of: \(SupatermTabGroupColor.allCases.map(\.rawValue).joined(separator: ", "))."
    )
  }
  return color
}

private func validatedGroupTitle(_ title: String) throws -> String {
  let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    throw ValidationError("Group titles must not be empty.")
  }
  return trimmed
}

private func runGroupMutation(
  _ group: SPGroupReference?,
  options: SPCommandOptions,
  request: @escaping (SupatermTabGroupTargetRequest) throws -> SupatermSocketRequest
) throws {
  try runControlCommand(
    options: options,
    request: { client in
      try request(
        resolvePublicGroupTargetRequest(
          group,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
    },
    as: SupatermTabGroupMutationResult.self,
    plain: { plainGroupSelector($0.group.id) },
    human: { renderGroupMutation($0) }
  )
}

private func runGroupRemoval(
  _ group: SPGroupReference?,
  options: SPCommandOptions,
  request: @escaping (SupatermTabGroupTargetRequest) throws -> SupatermSocketRequest
) throws {
  try runControlCommand(
    options: options,
    request: { client in
      try request(
        resolvePublicGroupTargetRequest(
          group,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
    },
    as: SupatermRemoveTabGroupResult.self,
    plain: { plainGroupSelector($0.removedGroupID) },
    human: {
      "window \($0.windowIndex) space \($0.spaceIndex) removed group \($0.removedGroupID.uuidString.lowercased())"
    }
  )
}

private func plainGroupSelector(_ groupID: UUID) -> String {
  groupID.uuidString.lowercased()
}

private func renderGroupMutation(_ result: SupatermTabGroupMutationResult) -> String {
  "window \(result.windowIndex) space \(result.spaceIndex) group \(result.group.id.uuidString.lowercased()) \(result.group.title)"
}
