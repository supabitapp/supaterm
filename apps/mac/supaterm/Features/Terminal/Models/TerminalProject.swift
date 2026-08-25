import Foundation
import SupaTheme
import SupatermCLIShared

nonisolated enum TerminalProjectCatalogError: Error, Equatable {
  case emptyName
  case duplicateName(String)
  case relativeRootPath(String)
  case nonDirectoryRoot(String)
  case duplicateRoot(String)
}

nonisolated struct TerminalProjectID: Hashable, Identifiable, Codable, Sendable {
  let rawValue: UUID

  init() {
    rawValue = UUID()
  }

  init(rawValue: UUID) {
    self.rawValue = rawValue
  }

  var id: UUID { rawValue }
}

nonisolated struct TerminalProject: Identifiable, Equatable, Codable, Sendable {
  let id: TerminalProjectID
  var name: String
  var rootPath: String?
  var color: ThemeTint
  var isPinned: Bool

  init(
    id: TerminalProjectID = TerminalProjectID(),
    name: String,
    rootPath: String? = nil,
    color: ThemeTint = .neutral,
    isPinned: Bool = false
  ) {
    self.id = id
    self.name = name
    self.rootPath = rootPath
    self.color = color
    self.isPinned = isPinned
  }
}

nonisolated struct TerminalProjectCatalog: Equatable, Codable, Sendable {
  var projects: [TerminalProject]

  static let `default` = Self()

  init(projects: [TerminalProject] = []) {
    self.projects = projects
  }

  static func defaultURL(
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    SupatermStateRoot.fileURL(
      "projects.json",
      homeDirectoryPath: homeDirectoryPath,
      environment: environment
    )
  }

  static func fileStorageEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }

  func validated(homeDirectoryPath: String = NSHomeDirectory()) throws -> Self {
    var names: Set<String> = []
    var rootPaths: Set<String> = []
    let projects = try projects.map { project in
      var project = project
      project.name = project.name.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !project.name.isEmpty else {
        throw TerminalProjectCatalogError.emptyName
      }
      let normalizedName = project.name.lowercased()
      guard names.insert(normalizedName).inserted else {
        throw TerminalProjectCatalogError.duplicateName(normalizedName)
      }
      project.rootPath = try project.rootPath.map {
        let rootPath = try Self.normalizedRootPath($0, homeDirectoryPath: homeDirectoryPath)
        let rootKey = try Self.rootKey(rootPath)
        guard rootPaths.insert(rootKey).inserted else {
          throw TerminalProjectCatalogError.duplicateRoot(rootKey)
        }
        return rootPath
      }
      return project
    }
    return Self(projects: projects.filter(\.isPinned) + projects.filter { !$0.isPinned })
  }

  @discardableResult
  mutating func setPinned(_ projectID: TerminalProjectID, isPinned: Bool) -> Bool {
    guard let index = projects.firstIndex(where: { $0.id == projectID }) else { return false }
    guard projects[index].isPinned != isPinned else { return false }
    var project = projects.remove(at: index)
    project.isPinned = isPinned
    if isPinned {
      projects.insert(project, at: projects.prefix(while: \.isPinned).count)
    } else {
      projects.append(project)
    }
    return true
  }

  @discardableResult
  mutating func reorderProject(_ projectID: TerminalProjectID, toLaneIndex laneIndex: Int) -> Bool {
    guard let sourceIndex = projects.firstIndex(where: { $0.id == projectID }) else { return false }
    let isPinned = projects[sourceIndex].isPinned
    let lane = projects.filter { $0.isPinned == isPinned }
    guard let sourceLaneIndex = lane.firstIndex(where: { $0.id == projectID }) else { return false }
    guard lane.indices.contains(laneIndex), sourceLaneIndex != laneIndex else { return false }
    let project = projects.remove(at: sourceIndex)
    let pinnedCount = projects.prefix(while: \.isPinned).count
    let destinationIndex =
      isPinned
      ? laneIndex
      : pinnedCount + laneIndex
    projects.insert(project, at: destinationIndex)
    return true
  }

  private static func normalizedRootPath(
    _ rootPath: String,
    homeDirectoryPath: String
  ) throws -> String {
    let expandedPath =
      switch rootPath {
      case "~":
        homeDirectoryPath
      case let path where path.hasPrefix("~/"):
        homeDirectoryPath + path.dropFirst()
      default:
        rootPath
      }
    guard NSString(string: expandedPath).isAbsolutePath else {
      throw TerminalProjectCatalogError.relativeRootPath(rootPath)
    }
    return URL(filePath: expandedPath).standardizedFileURL.path
  }

  private static func rootKey(_ rootPath: String) throws -> String {
    var isDirectory = ObjCBool(false)
    guard FileManager.default.fileExists(atPath: rootPath, isDirectory: &isDirectory) else {
      return rootPath
    }
    guard isDirectory.boolValue else {
      throw TerminalProjectCatalogError.nonDirectoryRoot(rootPath)
    }
    return URL(filePath: rootPath).resolvingSymlinksInPath().standardizedFileURL.path
  }
}
