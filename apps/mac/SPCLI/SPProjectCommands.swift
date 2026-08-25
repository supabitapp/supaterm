import ArgumentParser
import Foundation
import SupatermCLIShared

struct SPProjectIconResult: Encodable, Equatable {
  let path: String?

  private enum CodingKeys: String, CodingKey {
    case path
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    if let path {
      try container.encode(path, forKey: .path)
    } else {
      try container.encodeNil(forKey: .path)
    }
  }
}

extension SP {
  struct Project: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "project",
      abstract: "List and manage projects.",
      discussion: SPHelp.projectDiscussion,
      subcommands: [
        ProjectList.self,
        ProjectAdd.self,
        ProjectPin.self,
        ProjectUnpin.self,
        ProjectRemove.self,
        ProjectReorder.self,
        ProjectIcon.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct ProjectList: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "list",
      abstract: "List all projects."
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let projects = try treeSnapshot(client).projects
      try emitCommandResult(
        projects,
        options: options.output,
        plain: projects.map(projectRow).joined(separator: "\n"),
        human: projects.map(projectRow).joined(separator: "\n")
      )
    }
  }

  struct ProjectAdd: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "add",
      abstract: "Add a project."
    )

    @Argument(help: "Project name.")
    var name: String

    @Option(name: .long, help: "Project root directory.")
    var root: String?

    @Option(name: .long, help: "Project color.", transform: parseThemeColor)
    var color: SupatermThemeColor?

    @Flag(name: .long, help: "Pin the new project.")
    var pin = false

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let name = try validatedProjectName(name)
      try runControlCommand(
        options: options,
        request: { _ in
          try .addProject(
            SupatermAddProjectRequest(
              color: color,
              isPinned: pin,
              name: name,
              rootPath: try root.flatMap(resolvedWorkingDirectory)
            )
          )
        },
        as: SupatermProjectMutationResult.self,
        plain: { projectReference($0.project.id) },
        human: { projectRow($0.project) }
      )
    }
  }

  struct ProjectPin: ParsableCommand {
    static let configuration = CommandConfiguration(commandName: "pin", abstract: "Pin a project.")

    @Argument(help: "Project target.", transform: parseProjectReference)
    var project: SPProjectReference

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runProjectMutation(project, options: options) { try .pinProject($0) }
    }
  }

  struct ProjectUnpin: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "unpin",
      abstract: "Unpin a project."
    )

    @Argument(help: "Project target.", transform: parseProjectReference)
    var project: SPProjectReference

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runProjectMutation(project, options: options) { try .unpinProject($0) }
    }
  }

  struct ProjectReorder: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "reorder",
      abstract: "Reorder a project within its pin lane."
    )

    @Argument(help: "Project target.", transform: parseProjectReference)
    var project: SPProjectReference

    @Option(name: .long, help: "One-based destination index within the pin lane.")
    var index: Int

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      guard index > 0 else { throw ValidationError("--index must be 1 or greater.") }
      try runProjectMutation(project, options: options) {
        try .reorderProject(SupatermReorderProjectRequest(index: index, target: $0))
      }
    }
  }

  struct ProjectRemove: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "remove",
      abstract: "Remove a project and close all its tabs."
    )

    @Argument(help: "Project target.", transform: parseProjectReference)
    var project: SPProjectReference

    @Flag(name: [.customShort("y"), .long], help: "Remove without interactive confirmation.")
    var yes = false

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let snapshot = try treeSnapshot(client)
      let target = try resolvePublicProjectTargetRequest(project, snapshot: snapshot)
      let assignedTabCount = snapshot.windows.reduce(0) { count, window in
        count
          + window.spaces.reduce(0) { spaceCount, space in
            spaceCount + space.tabs.count { $0.projectID == target.projectID }
          }
      }
      var confirmed = yes || assignedTabCount == 0
      if !confirmed {
        try confirmDestructiveAction(
          prompt: "Remove project and close \(assignedTabCount) tab(s)? [y/N] "
        )
        confirmed = true
      }
      let response = try client.send(
        .removeProject(SupatermRemoveProjectRequest(confirmed: confirmed, target: target))
      )
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermRemoveProjectResult.self)
      try emitCommandResult(
        result,
        options: options.output,
        plain: projectReference(result.removedProjectID),
        human: "removed project \(projectReference(result.removedProjectID))"
      )
    }
  }

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
          return try .moveTab(
            SupatermMoveTabRequest(
              index: index,
              isPinned: pin ? true : (unpin ? false : current.isPinned),
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

  struct ProjectIcon: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "icon",
      abstract: "Find the first project icon.",
      discussion: SPHelp.projectIconDiscussion
    )

    @Argument(help: "Project directory. Defaults to the current directory.")
    var path: String?

    @OptionGroup
    var output: SPOutputOptions

    mutating func run() throws {
      applyOutputStyle(output)
      let projectURL = try resolvedProjectURL(path)
      let result = SPProjectIconResult(
        path: SupatermProjectIconResolver.resolve(in: projectURL)?.path
      )
      if result.path == nil, output.mode == .plain {
        return
      }
      try emitCommandResult(
        result,
        options: output,
        plain: result.path ?? "",
        human: result.path ?? "No project icon found."
      )
    }

    private func resolvedProjectURL(_ path: String?) throws -> URL {
      let rawPath = path ?? FileManager.default.currentDirectoryPath
      let trimmedPath = rawPath.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedPath.isEmpty else {
        throw ValidationError("Project directory must not be empty.")
      }

      let expandedPath = expandCLIHomePath(trimmedPath)
      let projectURL =
        NSString(string: expandedPath).isAbsolutePath
        ? URL(fileURLWithPath: expandedPath, isDirectory: true)
        : URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
          .appendingPathComponent(expandedPath, isDirectory: true)
      let resolvedURL = projectURL.standardizedFileURL.resolvingSymlinksInPath()
      var isDirectory = ObjCBool(false)
      guard
        FileManager.default.fileExists(atPath: resolvedURL.path, isDirectory: &isDirectory),
        isDirectory.boolValue
      else {
        throw ValidationError("Project directory does not exist: \(resolvedURL.path)")
      }
      return resolvedURL
    }
  }
}

enum SPProjectReference: Equatable, Sendable {
  case id(UUID)
  case name(String)
  case short(SPShortReference)
}

func parseProjectReference(_ argument: String) throws -> SPProjectReference {
  let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else {
    throw ValidationError("Project targets must be a j: ref, UUID, or exact name.")
  }
  if let reference = try SPShortReference.parse(trimmed) {
    return .short(try reference.require(.project))
  }
  if let id = UUID(uuidString: trimmed) { return .id(id) }
  return .name(trimmed)
}

func parseThemeColor(_ argument: String) throws -> SupatermThemeColor {
  let value = argument.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  guard let color = SupatermThemeColor(rawValue: value) else {
    throw ValidationError(
      "Color must be one of: \(SupatermThemeColor.allCases.map(\.rawValue).joined(separator: ", "))."
    )
  }
  return color
}

private func validatedProjectName(_ name: String) throws -> String {
  let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else { throw ValidationError("Project names must not be empty.") }
  return trimmed
}

private func runProjectMutation(
  _ project: SPProjectReference,
  options: SPCommandOptions,
  request: (SupatermProjectTargetRequest) throws -> SupatermSocketRequest
) throws {
  try runControlCommand(
    options: options,
    request: { client in
      try request(
        resolvePublicProjectTargetRequest(project, snapshot: try treeSnapshot(client))
      )
    },
    as: SupatermProjectMutationResult.self,
    plain: { projectReference($0.project.id) },
    human: { projectRow($0.project) }
  )
}

private func projectReference(_ id: UUID) -> String {
  "j:\(id.uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(8))"
}

private func projectRow(_ project: SupatermSnapshotProject) -> String {
  let pin = project.isPinned ? "pinned" : "regular"
  let root = project.rootPath.map { " \($0)" } ?? ""
  return "\(projectReference(project.id)) \(pin) \(project.color.rawValue) \(project.name)\(root)"
}
