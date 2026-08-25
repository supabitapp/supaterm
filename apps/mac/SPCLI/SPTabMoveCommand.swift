import ArgumentParser
import SupatermCLIShared

extension SP {
  struct MoveTab: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "move",
      abstract: "Move a tab to a project or Unassigned.",
      discussion: SPHelp.moveTabDiscussion
    )

    @Argument(help: "Optional tab target.")
    var tab: SPTabReference?

    @Option(name: .long, help: "Destination project.", transform: parseProjectReference)
    var project: SPProjectReference?

    @Flag(name: .long, help: "Move the tab to Unassigned.")
    var unassigned = false

    @Flag(name: .long, help: "Pin the tab.")
    var pin = false

    @Flag(name: .long, help: "Unpin the tab.")
    var unpin = false

    @Option(name: .long, help: "One-based index within the destination pin lane.")
    var index: Int?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      guard (project != nil) != unassigned else {
        throw ValidationError("Provide either --project or --unassigned.")
      }
      guard !(pin && unpin) else { throw ValidationError("Provide either --pin or --unpin.") }
      if let index, index < 1 { throw ValidationError("--index must be 1 or greater.") }
      try runControlCommand(
        options: options,
        request: { client in
          let snapshot = try treeSnapshot(client)
          let target = try resolvePublicTabTarget(
            tab,
            context: SupatermCLIContext.current,
            snapshot: snapshot
          )
          guard
            let current = snapshot.windows.lazy.flatMap(\.spaces).lazy
              .flatMap(\.tabs).first(where: { $0.id == target.tabID })
          else { throw ValidationError("The target tab no longer exists.") }
          let projectID = try project.map {
            try resolvePublicProjectTargetRequest($0, snapshot: snapshot).projectID
          }
          let isPinned: Bool
          if pin {
            isPinned = true
          } else if unpin {
            isPinned = false
          } else {
            isPinned = current.isPinned
          }
          return try .moveTab(
            SupatermMoveTabRequest(
              index: index,
              isPinned: isPinned,
              projectID: projectID,
              target: target
            )
          )
        },
        as: SupatermMoveTabResult.self,
        plain: { "\($0.target.spaceIndex)/\($0.target.tabIndex)" },
        human: { "space \($0.target.spaceIndex) tab \($0.target.tabIndex)" }
      )
    }
  }
}
