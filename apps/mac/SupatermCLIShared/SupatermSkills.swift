import Foundation

public struct SupatermSkillSummary: Codable, Equatable, Sendable {
  public let name: String
  public let description: String

  public init(name: String, description: String) {
    self.name = name
    self.description = description
  }
}

public struct SupatermSkillFile: Codable, Equatable, Sendable {
  public let path: String
  public let content: String

  public init(path: String, content: String) {
    self.path = path
    self.content = content
  }
}

public struct SupatermSkillContent: Codable, Equatable, Sendable {
  public let name: String
  public let content: String
  public let files: [SupatermSkillFile]?

  public init(name: String, content: String, files: [SupatermSkillFile]? = nil) {
    self.name = name
    self.content = content
    self.files = files
  }
}

public struct SupatermSkillInstallResult: Codable, Equatable, Sendable {
  public let path: String

  public init(path: String) {
    self.path = path
  }
}

public struct SupatermSkills {
  public static let manualInstallCommand = "sp skills install"

  let homeDirectoryURL: URL
  let bundledSkillsDirectoryURL: URL?
  let fileManager: FileManager

  public init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    bundledSkillsDirectoryURL: URL? = Self.bundledSkillsDirectoryURL(),
    fileManager: FileManager = .default
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.bundledSkillsDirectoryURL = bundledSkillsDirectoryURL
    self.fileManager = fileManager
  }

  public func list() throws -> [SupatermSkillSummary] {
    let skillDataDirectoryURL = try bundledSkillDataDirectoryURL()
    let skillURLs = try fileManager.contentsOfDirectory(
      at: skillDataDirectoryURL,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: [.skipsHiddenFiles]
    )

    return
      try skillURLs
      .filter { url in
        let values = try? url.resourceValues(forKeys: [.isDirectoryKey])
        return values?.isDirectory == true
          && fileManager.fileExists(atPath: Self.skillDefinitionURL(skillDirectoryURL: url).path)
      }
      .map { try summary(at: $0) }
      .sorted { $0.name < $1.name }
  }

  public func get(name: String, full: Bool = false) throws -> SupatermSkillContent {
    guard name.range(of: #"^[a-z0-9][a-z0-9-]*$"#, options: .regularExpression) != nil else {
      throw SupatermSkillsError.skillNotFound(name)
    }
    let skillDirectoryURL = try bundledSkillDataDirectoryURL()
      .appendingPathComponent(name, isDirectory: true)
    let skillDefinitionURL = Self.skillDefinitionURL(skillDirectoryURL: skillDirectoryURL)
    guard fileManager.fileExists(atPath: skillDefinitionURL.path) else {
      throw SupatermSkillsError.skillNotFound(name)
    }

    let summary = try summary(at: skillDirectoryURL)
    let content = try String(contentsOf: skillDefinitionURL, encoding: .utf8)
    let files = full ? try files(in: skillDirectoryURL) : nil
    return SupatermSkillContent(name: summary.name, content: content, files: files)
  }

  @discardableResult
  public func install() throws -> SupatermSkillInstallResult {
    guard let bundledSkillsDirectoryURL else {
      throw SupatermSkillsError.bundledSkillsUnavailable(nil)
    }
    let bundledSkillDirectoryURL = Self.discoverySkillDirectoryURL(
      bundledSkillsDirectoryURL: bundledSkillsDirectoryURL
    )
    guard
      fileManager.fileExists(
        atPath: Self.skillDefinitionURL(skillDirectoryURL: bundledSkillDirectoryURL).path
      )
    else {
      throw SupatermSkillsError.bundledSkillsUnavailable(bundledSkillsDirectoryURL.path)
    }

    let skillDirectoryURL = Self.skillDirectoryURL(homeDirectoryURL: homeDirectoryURL)
    try fileManager.createDirectory(
      at: skillDirectoryURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    let stagingDirectoryURL = skillDirectoryURL.deletingLastPathComponent()
      .appendingPathComponent(".supaterm-\(UUID().uuidString)", isDirectory: true)
    defer {
      try? fileManager.removeItem(at: stagingDirectoryURL)
    }
    try fileManager.copyItem(at: bundledSkillDirectoryURL, to: stagingDirectoryURL)

    if symbolicLinkDestination(at: skillDirectoryURL) != nil {
      try fileManager.removeItem(at: skillDirectoryURL)
      try fileManager.moveItem(at: stagingDirectoryURL, to: skillDirectoryURL)
    } else if fileManager.fileExists(atPath: skillDirectoryURL.path) {
      _ = try fileManager.replaceItemAt(skillDirectoryURL, withItemAt: stagingDirectoryURL)
    } else {
      try fileManager.moveItem(at: stagingDirectoryURL, to: skillDirectoryURL)
    }
    return SupatermSkillInstallResult(path: skillDirectoryURL.path)
  }

  private static func skillsDirectoryURL(homeDirectoryURL: URL) -> URL {
    homeDirectoryURL
      .appendingPathComponent(".agents", isDirectory: true)
      .appendingPathComponent("skills", isDirectory: true)
  }

  public static func skillDirectoryURL(homeDirectoryURL: URL) -> URL {
    skillsDirectoryURL(homeDirectoryURL: homeDirectoryURL)
      .appendingPathComponent("supaterm", isDirectory: true)
  }

  public static func skillDefinitionURL(skillDirectoryURL: URL) -> URL {
    skillDirectoryURL.appendingPathComponent("SKILL.md", isDirectory: false)
  }

  public static func bundledSkillsDirectoryURL(
    resourceURL: URL? = Bundle.main.resourceURL,
    executableURL: URL? = Bundle.main.executableURL,
    fileManager: FileManager = .default
  ) -> URL? {
    var candidates = [resourceURL].compactMap { $0 }
    if let executableURL {
      candidates.append(resourcesDirectoryURL(nextToExecutableURL: executableURL))
      let resolvedExecutableURL = executableURL.resolvingSymlinksInPath()
      if resolvedExecutableURL != executableURL {
        candidates.append(resourcesDirectoryURL(nextToExecutableURL: resolvedExecutableURL))
      }
    }
    return candidates.first {
      hasBundledSkills(at: $0, fileManager: fileManager)
    } ?? candidates.first
  }

  private func bundledSkillDataDirectoryURL() throws -> URL {
    guard let bundledSkillsDirectoryURL else {
      throw SupatermSkillsError.bundledSkillsUnavailable(nil)
    }
    let skillDataDirectoryURL = Self.skillDataDirectoryURL(
      bundledSkillsDirectoryURL: bundledSkillsDirectoryURL
    )
    var isDirectory: ObjCBool = false
    guard
      fileManager.fileExists(atPath: skillDataDirectoryURL.path, isDirectory: &isDirectory),
      isDirectory.boolValue
    else {
      throw SupatermSkillsError.bundledSkillsUnavailable(bundledSkillsDirectoryURL.path)
    }
    return skillDataDirectoryURL
  }

  private func summary(at skillDirectoryURL: URL) throws -> SupatermSkillSummary {
    let content = try String(
      contentsOf: Self.skillDefinitionURL(skillDirectoryURL: skillDirectoryURL),
      encoding: .utf8
    )
    let metadata = try Self.metadata(in: content, path: skillDirectoryURL.path)
    guard metadata.name == skillDirectoryURL.lastPathComponent else {
      throw SupatermSkillsError.invalidSkill(skillDirectoryURL.path)
    }
    return metadata
  }

  private func files(in skillDirectoryURL: URL) throws -> [SupatermSkillFile] {
    guard
      let enumerator = fileManager.enumerator(
        at: skillDirectoryURL,
        includingPropertiesForKeys: [.isRegularFileKey],
        options: [.skipsHiddenFiles]
      )
    else {
      return []
    }

    let rootComponentCount = skillDirectoryURL.resolvingSymlinksInPath().pathComponents.count
    return
      try enumerator
      .compactMap { $0 as? URL }
      .compactMap { url in
        guard (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else {
          return nil
        }
        let path = url.resolvingSymlinksInPath().pathComponents
          .dropFirst(rootComponentCount)
          .joined(separator: "/")
        guard path != "SKILL.md" else {
          return nil
        }
        return SupatermSkillFile(
          path: path,
          content: try String(contentsOf: url, encoding: .utf8)
        )
      }
      .sorted { $0.path < $1.path }
  }

  private static func metadata(in content: String, path: String) throws -> SupatermSkillSummary {
    let lines = content.split(separator: "\n", omittingEmptySubsequences: false)
    guard lines.first == "---",
      let endIndex = lines.dropFirst().firstIndex(of: "---")
    else {
      throw SupatermSkillsError.invalidSkill(path)
    }

    var name: String?
    var description: String?
    for line in lines[1..<endIndex] {
      if line.hasPrefix("name:") {
        name = metadataValue(in: line)
      } else if line.hasPrefix("description:") {
        description = metadataValue(in: line)
      }
    }
    guard let name, !name.isEmpty, let description, !description.isEmpty else {
      throw SupatermSkillsError.invalidSkill(path)
    }
    return SupatermSkillSummary(name: name, description: description)
  }

  private static func metadataValue(in line: Substring) -> String {
    var value = line.drop(while: { $0 != ":" }).dropFirst()
      .trimmingCharacters(in: .whitespaces)
    if value.count >= 2,
      let first = value.first,
      let last = value.last,
      (first == "\"" && last == "\"") || (first == "'" && last == "'")
    {
      value.removeFirst()
      value.removeLast()
    }
    return value
  }

  private static func hasBundledSkills(at url: URL, fileManager: FileManager) -> Bool {
    let discoverySkillURL = skillDefinitionURL(
      skillDirectoryURL: discoverySkillDirectoryURL(bundledSkillsDirectoryURL: url)
    )
    let coreSkillURL = skillDefinitionURL(
      skillDirectoryURL: skillDataDirectoryURL(bundledSkillsDirectoryURL: url)
        .appendingPathComponent("core", isDirectory: true)
    )
    return fileManager.fileExists(atPath: discoverySkillURL.path)
      && fileManager.fileExists(atPath: coreSkillURL.path)
  }

  private static func discoverySkillDirectoryURL(bundledSkillsDirectoryURL: URL) -> URL {
    bundledSkillsDirectoryURL
      .appendingPathComponent("skills", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
  }

  private static func skillDataDirectoryURL(bundledSkillsDirectoryURL: URL) -> URL {
    bundledSkillsDirectoryURL.appendingPathComponent("skill-data", isDirectory: true)
  }

  private static func resourcesDirectoryURL(nextToExecutableURL executableURL: URL) -> URL {
    executableURL
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private func symbolicLinkDestination(at url: URL) -> String? {
    try? fileManager.destinationOfSymbolicLink(atPath: url.path)
  }
}

enum SupatermSkillsError: Error, Equatable, LocalizedError {
  case bundledSkillsUnavailable(String?)
  case invalidSkill(String)
  case skillNotFound(String)

  var errorDescription: String? {
    switch self {
    case .bundledSkillsUnavailable(let path):
      guard let path else {
        return "Supaterm bundled skills are missing."
      }
      return "Supaterm bundled skills are missing at \(path)."
    case .invalidSkill(let path):
      return "Invalid Supaterm skill at \(path)."
    case .skillNotFound(let name):
      return "Skill not found: \(name). Run `sp skills list` to see available skills."
    }
  }
}
