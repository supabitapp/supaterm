import Foundation

struct ReleaseArtifact: Equatable {
  let version: String
  let url: URL
  let sha512: String
  let size: Int64
}

enum ReleaseFeed {
  static let releasesURL = URL(string: "https://github.com/supabitapp/supaterm/releases")!
  // The stable updater feed that electron-builder publishes for every release.
  // Reading it instead of the GitHub API avoids the API's per-IP rate limit.
  static let manifestURL = releasesURL.appending(path: "latest/download/latest-mac.yml")

  static func latestArtifact() async throws -> ReleaseArtifact {
    var request = URLRequest(url: manifestURL)
    request.cachePolicy = .reloadIgnoringLocalCacheData
    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200, let text = String(data: data, encoding: .utf8)
    else { throw InstallerError.feedUnavailable }
    return try artifact(fromManifest: text, architecture: MacArchitecture.current)
  }

  // Parses only the subset of YAML electron-builder writes for the mac feed:
  // a top-level `version` and a `files` list of url/sha512/size entries.
  static func artifact(fromManifest manifest: String, architecture: MacArchitecture) throws -> ReleaseArtifact {
    var version: String?
    var files: [[String: String]] = []
    var inFiles = false
    for rawLine in manifest.split(whereSeparator: \.isNewline) {
      let line = String(rawLine)
      let indented = line.first?.isWhitespace == true
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if !indented {
        inFiles = trimmed == "files:"
        if trimmed.hasPrefix("version:") { version = unquote(trimmed.dropFirst("version:".count)) }
        continue
      }
      guard inFiles else { continue }
      var entry = trimmed
      if entry.hasPrefix("- ") {
        files.append([:])
        entry.removeFirst(2)
      }
      guard !files.isEmpty, let colon = entry.firstIndex(of: ":") else { continue }
      let key = String(entry[..<colon])
      files[files.count - 1][key] = unquote(entry[entry.index(after: colon)...])
    }

    let suffix = "-\(architecture.rawValue).zip"
    guard
      let version,
      let file = files.first(where: { $0["url"]?.hasSuffix(suffix) == true }),
      let name = file["url"],
      let sha512 = file["sha512"],
      let size = file["size"].flatMap(Int64.init)
    else { throw InstallerError.noBuildForThisMac }

    let url = releasesURL.appending(path: "download/v\(version)/\(name)")
    return ReleaseArtifact(version: version, url: url, sha512: sha512, size: size)
  }

  private static func unquote(_ raw: Substring) -> String {
    let value = raw.trimmingCharacters(in: .whitespaces)
    guard value.count >= 2, let first = value.first, first == "'" || first == "\"", value.last == first
    else { return value }
    return String(value.dropFirst().dropLast())
  }
}

enum MacArchitecture: String {
  case arm64
  case x64

  // Reads the hardware rather than the running slice, so an installer forced
  // to run under Rosetta still picks the native build.
  static var current: MacArchitecture {
    var value: Int32 = 0
    var size = MemoryLayout<Int32>.size
    let found = sysctlbyname("hw.optional.arm64", &value, &size, nil, 0) == 0
    return found && value == 1 ? .arm64 : .x64
  }
}
