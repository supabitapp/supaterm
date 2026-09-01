import Foundation
import SupatermCLIShared

private struct ResolvedSupatermSkill {
  let directoryURL: URL
  let definitionURL: URL
  let summary: SupatermSkillSummary
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
    let skill = try skill(named: name)
    let content = try String(contentsOf: skill.definitionURL, encoding: .utf8)
    let files = full ? try files(in: skill.directoryURL) : nil
    return SupatermSkillContent(name: skill.summary.name, content: content, files: files)
  }

  public func path(name: String) throws -> String {
    try skill(named: name).directoryURL.path
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
    try replaceDirectory(at: skillDirectoryURL, copying: bundledSkillDirectoryURL)
    try replaceSymbolicLink(
      at: Self.claudeSkillDirectoryURL(homeDirectoryURL: homeDirectoryURL),
      pointingTo: skillDirectoryURL
    )
    return SupatermSkillInstallResult(path: skillDirectoryURL.path)
  }

  private func skill(named name: String) throws -> ResolvedSupatermSkill {
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
    return ResolvedSupatermSkill(
      directoryURL: skillDirectoryURL,
      definitionURL: skillDefinitionURL,
      summary: summary
    )
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

  static func claudeSkillDirectoryURL(homeDirectoryURL: URL) -> URL {
    homeDirectoryURL
      .appendingPathComponent(".claude", isDirectory: true)
      .appendingPathComponent("skills", isDirectory: true)
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
    SupatermBundleLayout.resourcesDirectoryURL(nextTo: executableURL)
  }

  private func symbolicLinkDestination(at url: URL) -> String? {
    try? fileManager.destinationOfSymbolicLink(atPath: url.path)
  }

  private func replaceDirectory(
    at destinationURL: URL,
    copying sourceURL: URL
  ) throws {
    let parentDirectoryURL = destinationURL.deletingLastPathComponent()
    try fileManager.createDirectory(at: parentDirectoryURL, withIntermediateDirectories: true)
    let stagingURL = parentDirectoryURL.appendingPathComponent(
      ".supaterm-\(UUID().uuidString)",
      isDirectory: true
    )
    defer {
      try? fileManager.removeItem(at: stagingURL)
    }
    try fileManager.copyItem(at: sourceURL, to: stagingURL)

    if symbolicLinkDestination(at: destinationURL) != nil {
      try fileManager.removeItem(at: destinationURL)
      try fileManager.moveItem(at: stagingURL, to: destinationURL)
    } else if fileManager.fileExists(atPath: destinationURL.path) {
      _ = try fileManager.replaceItemAt(destinationURL, withItemAt: stagingURL)
    } else {
      try fileManager.moveItem(at: stagingURL, to: destinationURL)
    }
  }

  private func replaceSymbolicLink(at destinationURL: URL, pointingTo targetURL: URL) throws {
    try fileManager.createDirectory(
      at: destinationURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    if symbolicLinkDestination(at: destinationURL) != nil
      || fileManager.fileExists(atPath: destinationURL.path)
    {
      try fileManager.removeItem(at: destinationURL)
    }
    try fileManager.createSymbolicLink(at: destinationURL, withDestinationURL: targetURL)
  }
}

public enum SupatermSkillsError: Error, Equatable, LocalizedError {
  case bundledSkillsUnavailable(String?)
  case invalidSkill(String)
  case skillNotFound(String)

  public var errorDescription: String? {
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
