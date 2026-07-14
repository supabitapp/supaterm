import Foundation

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

nonisolated struct TerminalProjectItem: Identifiable, Equatable, Codable, Sendable {
  let id: TerminalProjectID
  let directoryURL: URL
  var isPinned: Bool

  init(
    id: TerminalProjectID = TerminalProjectID(),
    directoryURL: URL,
    isPinned: Bool = false
  ) {
    guard let directoryURL = Self.canonicalDirectoryURL(directoryURL) else {
      preconditionFailure("Project directory URL must be a file URL")
    }
    self.id = id
    self.directoryURL = directoryURL
    self.isPinned = isPinned
  }

  var displayName: String {
    let displayName = directoryURL.lastPathComponent
    return displayName.isEmpty ? directoryURL.path(percentEncoded: false) : displayName
  }

  static func canonicalDirectoryURL(_ directoryURL: URL) -> URL? {
    guard directoryURL.isFileURL else { return nil }
    let resolvedURL = directoryURL.standardizedFileURL.resolvingSymlinksInPath()
    return URL(
      fileURLWithPath: resolvedURL.path(percentEncoded: false),
      isDirectory: true
    ).standardizedFileURL
  }

  static func reachableDirectoryURL(_ directoryURL: URL) -> URL? {
    guard let canonicalURL = canonicalDirectoryURL(directoryURL) else { return nil }
    guard (try? canonicalURL.checkResourceIsReachable()) == true else { return nil }
    guard (try? canonicalURL.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
      return nil
    }
    return canonicalURL
  }
}
