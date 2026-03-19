import Foundation

struct TerminalWorkspaceStore: Sendable {
  var load: @MainActor @Sendable () -> TerminalWorkspaceSnapshot?
  var save: @MainActor @Sendable (TerminalWorkspaceSnapshot) -> Void

  static let live = Self(
    load: {
      Self.loadSnapshot()
    },
    save: { snapshot in
      Self.saveSnapshot(snapshot)
    }
  )

  static func defaultURL(homeDirectoryPath: String = NSHomeDirectory()) -> URL {
    URL(fileURLWithPath: homeDirectoryPath, isDirectory: true)
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
      .appendingPathComponent("workspaces.json", isDirectory: false)
  }

  static func loadSnapshot(
    fileURL: URL = defaultURL(),
    fileManager: FileManager = .default
  ) -> TerminalWorkspaceSnapshot? {
    guard fileManager.fileExists(atPath: fileURL.path) else { return nil }
    guard let data = try? Data(contentsOf: fileURL) else { return nil }
    let decoder = JSONDecoder()
    return try? decoder.decode(TerminalWorkspaceSnapshot.self, from: data)
  }

  static func saveSnapshot(
    _ snapshot: TerminalWorkspaceSnapshot,
    fileURL: URL = defaultURL(),
    fileManager: FileManager = .default
  ) {
    let directoryURL = fileURL.deletingLastPathComponent()
    do {
      try fileManager.createDirectory(
        at: directoryURL,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
      )

      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      let data = try encoder.encode(snapshot)
      try data.write(to: fileURL, options: .atomic)
      try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    } catch {
      return
    }
  }
}
