import Foundation
import SupatermCLIShared

struct TerminalCustomCommandProblem: Equatable, Identifiable, Sendable {
  let id: String
  let message: String

  init(message: String) {
    self.id = message
    self.message = message
  }
}

struct TerminalCustomTextCommandSnapshot: Equatable, Sendable {
  let command: String
}

struct TerminalCustomWorkspaceLeafSnapshot: Equatable, Sendable {
  let title: String?
  let workingDirectoryPath: String?
  let command: String?
  let environmentVariables: [SupatermCLIEnvironmentVariable]
}

struct TerminalCustomWorkspaceSplitSnapshot: Equatable, Sendable {
  let direction: SupatermWorkspaceSplitDirection
  let ratio: Double
  let first: TerminalCustomWorkspacePaneSnapshot
  let second: TerminalCustomWorkspacePaneSnapshot
}

indirect enum TerminalCustomWorkspacePaneSnapshot: Equatable, Sendable {
  case leaf(TerminalCustomWorkspaceLeafSnapshot)
  case split(TerminalCustomWorkspaceSplitSnapshot)

  var leafCount: Int {
    switch self {
    case .leaf:
      return 1
    case .split(let split):
      return split.first.leafCount + split.second.leafCount
    }
  }
}

struct TerminalCustomWorkspaceTabSnapshot: Equatable, Sendable {
  let title: String
  let rootPane: TerminalCustomWorkspacePaneSnapshot
  let focusedLeafIndex: Int
}

struct TerminalCustomWorkspaceSnapshot: Equatable, Sendable {
  let restartBehavior: SupatermWorkspaceRestartBehavior
  let spaceName: String
  let tabs: [TerminalCustomWorkspaceTabSnapshot]
  let selectedTabIndex: Int
}

enum TerminalCustomCommandKindSnapshot: Equatable, Sendable {
  case command(TerminalCustomTextCommandSnapshot)
  case workspace(TerminalCustomWorkspaceSnapshot)
}

struct TerminalCustomCommandSnapshot: Equatable, Identifiable, Sendable {
  let id: String
  let title: String
  let subtitle: String
  let keywords: [String]
  let kind: TerminalCustomCommandKindSnapshot

  var requiresFocusedSurface: Bool {
    switch kind {
    case .command:
      return true
    case .workspace:
      return false
    }
  }
}

struct TerminalCustomCommandCatalogResult: Equatable, Sendable {
  let commands: [TerminalCustomCommandSnapshot]
  let problems: [TerminalCustomCommandProblem]

  static let empty = Self(commands: [], problems: [])
}

enum TerminalCustomCommandCatalog {
  static func load(
    focusedWorkingDirectory: String?,
    fileManager: FileManager = .default,
    homeDirectoryPath: String = NSHomeDirectory()
  ) -> TerminalCustomCommandCatalogResult {
    let globalURL = SupatermSettings.defaultURL(homeDirectoryPath: homeDirectoryPath)
      .deletingLastPathComponent()
      .appendingPathComponent("supaterm.json", isDirectory: false)
    let localURL = nearestLocalConfigURL(
      from: focusedWorkingDirectory,
      excluding: globalURL,
      fileManager: fileManager
    )

    let globalResult = decodeFileIfPresent(at: globalURL, fileManager: fileManager)
    let localResult =
      localURL.map { decodeFileIfPresent(at: $0, fileManager: fileManager) }
      ?? DecodedFileResult.empty

    return merge(
      globalResult: globalResult,
      localResult: localResult
    )
  }

  private struct DecodedFileResult {
    let commands: [TerminalCustomCommandSnapshot]
    let problems: [TerminalCustomCommandProblem]

    static let empty = Self(commands: [], problems: [])
  }

  private static func decodeFileIfPresent(
    at url: URL,
    fileManager: FileManager
  ) -> DecodedFileResult {
    guard fileManager.fileExists(atPath: url.path(percentEncoded: false)) else {
      return .empty
    }

    do {
      let data = try Data(contentsOf: url)
      let file = try JSONDecoder().decode(SupatermCustomCommandsFile.self, from: data)
      return resolve(file: file, sourceURL: url)
    } catch {
      return .init(
        commands: [],
        problems: [
          .init(message: "Failed to load \(url.path(percentEncoded: false)): \(error.localizedDescription)")
        ]
      )
    }
  }

  private static func resolve(
    file: SupatermCustomCommandsFile,
    sourceURL: URL
  ) -> DecodedFileResult {
    var problems: [TerminalCustomCommandProblem] = []
    var order: [String] = []
    var snapshotsByID: [String: TerminalCustomCommandSnapshot] = [:]
    var seenCounts: [String: Int] = [:]

    for command in file.commands {
      seenCounts[command.id, default: 0] += 1
      if seenCounts[command.id] == 1 {
        order.append(command.id)
      }
      do {
        snapshotsByID[command.id] = try resolve(
          command: command,
          sourceURL: sourceURL
        )
      } catch {
        problems.append(
          .init(
            message:
              "Invalid command \(command.id) in \(sourceURL.path(percentEncoded: false)): \(error.localizedDescription)"
          )
        )
      }
    }

    let duplicateIDs = seenCounts.keys.sorted().filter { (seenCounts[$0] ?? 0) > 1 }
    if !duplicateIDs.isEmpty {
      problems.append(
        .init(
          message:
            "Duplicate command ids in \(sourceURL.path(percentEncoded: false)): \(duplicateIDs.joined(separator: ", "))"
        )
      )
    }

    return .init(
      commands: order.compactMap { snapshotsByID[$0] },
      problems: problems
    )
  }

  private static func resolve(
    command: SupatermCustomCommand,
    sourceURL: URL
  ) throws -> TerminalCustomCommandSnapshot {
    switch command.kind {
    case .command:
      return .init(
        id: command.id,
        title: command.name,
        subtitle: command.description ?? "Command",
        keywords: command.keywords,
        kind: .command(.init(command: try required(command.command)))
      )
    case .workspace:
      let workspace = try required(command.workspace)
      let resolvedWorkspace = try resolve(
        workspace: workspace,
        restartBehavior: command.restartBehavior ?? .focusExisting,
        sourceURL: sourceURL,
        commandID: command.id
      )
      return .init(
        id: command.id,
        title: command.name,
        subtitle: command.description ?? resolvedWorkspace.spaceName,
        keywords: command.keywords,
        kind: .workspace(resolvedWorkspace)
      )
    }
  }

  private static func resolve(
    workspace: SupatermWorkspaceDefinition,
    restartBehavior: SupatermWorkspaceRestartBehavior,
    sourceURL: URL,
    commandID: String
  ) throws -> TerminalCustomWorkspaceSnapshot {
    let selectedIndexes = workspace.tabs.enumerated().compactMap { index, tab in
      tab.selected ? index : nil
    }
    let selectedTabIndex = selectedIndexes.first ?? 0
    var problems: [String] = []
    if selectedIndexes.count > 1 {
      problems.append("multiple selected tabs")
    }

    var resolvedTabs: [TerminalCustomWorkspaceTabSnapshot] = []
    for tab in workspace.tabs {
      try resolvedTabs.append(
        resolve(
          tab: tab,
          sourceURL: sourceURL,
          commandID: commandID,
          problems: &problems
        )
      )
    }

    if resolvedTabs.isEmpty {
      throw CatalogError.invalid("workspace must contain at least one tab")
    }

    if !problems.isEmpty {
      throw CatalogError.invalid(problems.joined(separator: ", "))
    }

    return .init(
      restartBehavior: restartBehavior,
      spaceName: workspace.spaceName,
      tabs: resolvedTabs,
      selectedTabIndex: resolvedTabs.indices.contains(selectedTabIndex) ? selectedTabIndex : 0
    )
  }

  private static func resolve(
    tab: SupatermWorkspaceTabDefinition,
    sourceURL: URL,
    commandID: String,
    problems: inout [String]
  ) throws -> TerminalCustomWorkspaceTabSnapshot {
    let resolvedPane = try resolve(
      pane: tab.rootPane,
      inheritedWorkingDirectory: tab.cwd,
      sourceURL: sourceURL,
      commandID: commandID,
      problems: &problems
    )
    let focusedLeafIndexes = focusedLeafIndexes(in: resolvedPane)
    if focusedLeafIndexes.count > 1 {
      problems.append("multiple focused panes in tab \(tab.title)")
    }
    return .init(
      title: tab.title,
      rootPane: clearedFocusMarkers(in: resolvedPane),
      focusedLeafIndex: focusedLeafIndexes.first ?? 0
    )
  }

  private indirect enum FocusMarkedPane {
    case leaf(TerminalCustomWorkspaceLeafSnapshot, focused: Bool)
    case split(
      direction: SupatermWorkspaceSplitDirection,
      ratio: Double,
      first: FocusMarkedPane,
      second: FocusMarkedPane
    )
  }

  private static func resolve(
    pane: SupatermWorkspacePaneDefinition,
    inheritedWorkingDirectory: String?,
    sourceURL: URL,
    commandID: String,
    problems: inout [String]
  ) throws -> FocusMarkedPane {
    switch pane {
    case .leaf(let leaf):
      let workingDirectoryPath = resolvePath(
        leaf.cwd ?? inheritedWorkingDirectory,
        relativeTo: sourceURL.deletingLastPathComponent()
      )
      let environmentVariables = try resolveEnvironmentVariables(
        leaf.env,
        commandID: commandID
      )
      return .leaf(
        .init(
          title: leaf.title,
          workingDirectoryPath: workingDirectoryPath,
          command: leaf.command,
          environmentVariables: environmentVariables
        ),
        focused: leaf.focus
      )
    case .split(let split):
      return .split(
        direction: split.direction,
        ratio: split.ratio > 0 && split.ratio < 1 ? split.ratio : 0.5,
        first: try resolve(
          pane: split.first,
          inheritedWorkingDirectory: inheritedWorkingDirectory,
          sourceURL: sourceURL,
          commandID: commandID,
          problems: &problems
        ),
        second: try resolve(
          pane: split.second,
          inheritedWorkingDirectory: inheritedWorkingDirectory,
          sourceURL: sourceURL,
          commandID: commandID,
          problems: &problems
        )
      )
    }
  }

  private static func focusedLeafIndexes(
    in pane: FocusMarkedPane
  ) -> [Int] {
    var currentIndex = 0
    var focusedIndexes: [Int] = []

    func visit(_ pane: FocusMarkedPane) {
      switch pane {
      case .leaf(_, let focused):
        if focused {
          focusedIndexes.append(currentIndex)
        }
        currentIndex += 1
      case .split(_, _, let first, let second):
        visit(first)
        visit(second)
      }
    }

    visit(pane)
    return focusedIndexes
  }

  private static func clearedFocusMarkers(
    in pane: FocusMarkedPane
  ) -> TerminalCustomWorkspacePaneSnapshot {
    switch pane {
    case .leaf(let leaf, _):
      return .leaf(leaf)
    case .split(let direction, let ratio, let first, let second):
      return .split(
        .init(
          direction: direction,
          ratio: ratio,
          first: clearedFocusMarkers(in: first),
          second: clearedFocusMarkers(in: second)
        )
      )
    }
  }

  private static func resolveEnvironmentVariables(
    _ environment: SupatermWorkspaceEnvironment,
    commandID: String
  ) throws -> [SupatermCLIEnvironmentVariable] {
    try environment.values.keys.sorted().map { key in
      if isReservedEnvironmentKey(key) {
        throw CatalogError.invalid("reserved environment key \(key) in command \(commandID)")
      }
      return .init(
        key: key,
        value: environment.values[key] ?? ""
      )
    }
  }

  private static func isReservedEnvironmentKey(_ key: String) -> Bool {
    let normalized = key.uppercased()
    return normalized == "PATH" || normalized.hasPrefix("SUPATERM_")
  }

  private static func resolvePath(
    _ path: String?,
    relativeTo baseURL: URL
  ) -> String? {
    guard let trimmedPath = trimmed(path) else { return nil }
    if trimmedPath.hasPrefix("/") {
      return GhosttySurfaceView.normalizedWorkingDirectoryPath(trimmedPath)
    }
    return GhosttySurfaceView.normalizedWorkingDirectoryPath(
      baseURL.appendingPathComponent(trimmedPath, isDirectory: true).standardizedFileURL.path(percentEncoded: false)
    )
  }

  private static func merge(
    globalResult: DecodedFileResult,
    localResult: DecodedFileResult
  ) -> TerminalCustomCommandCatalogResult {
    var merged = globalResult.commands
    var indexByID = Dictionary(uniqueKeysWithValues: merged.enumerated().map { ($1.id, $0) })

    for command in localResult.commands {
      if let existingIndex = indexByID[command.id] {
        merged[existingIndex] = command
      } else {
        indexByID[command.id] = merged.count
        merged.append(command)
      }
    }

    return .init(
      commands: merged,
      problems: globalResult.problems + localResult.problems
    )
  }

  private static func nearestLocalConfigURL(
    from focusedWorkingDirectory: String?,
    excluding globalURL: URL,
    fileManager: FileManager
  ) -> URL? {
    guard let path = trimmed(focusedWorkingDirectory) else { return nil }
    var currentURL = URL(fileURLWithPath: GhosttySurfaceView.normalizedWorkingDirectoryPath(path), isDirectory: true)
      .standardizedFileURL

    while true {
      let candidateURL = currentURL.appendingPathComponent("supaterm.json", isDirectory: false)
      if candidateURL != globalURL && fileManager.fileExists(atPath: candidateURL.path(percentEncoded: false)) {
        return candidateURL
      }
      let parentURL = currentURL.deletingLastPathComponent()
      if parentURL == currentURL {
        return nil
      }
      currentURL = parentURL
    }
  }

  private static func trimmed(_ value: String?) -> String? {
    guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
      return nil
    }
    return value
  }

  private static func required<T>(_ value: T?) throws -> T {
    guard let value else {
      throw CatalogError.invalid("missing required value")
    }
    return value
  }

  private enum CatalogError: LocalizedError {
    case invalid(String)

    var errorDescription: String? {
      switch self {
      case .invalid(let message):
        return message
      }
    }
  }
}
