import ComposableArchitecture
import Foundation

nonisolated struct GithubRemoteTarget: Equatable, Sendable, Hashable {
  let remoteName: String
  let host: String
  let owner: String
  let repo: String
}

nonisolated struct GitRepositoryClient: Sendable {
  var repositoryRoot: @Sendable (URL) async -> URL?
  var branchName: @Sendable (URL) async -> String?
  var githubRemotes: @Sendable (URL) async -> [GithubRemoteTarget]
  var headURL: @Sendable (URL) -> URL?
}

extension GitRepositoryClient: DependencyKey {
  static let liveValue = Self(
    repositoryRoot: { workingDirectoryURL in
      GitRepositoryCommandRunner.repositoryRoot(for: workingDirectoryURL)
    },
    branchName: { workingDirectoryURL in
      GitRepositoryCommandRunner.branchName(for: workingDirectoryURL)
    },
    githubRemotes: { repositoryRootURL in
      GitRepositoryCommandRunner.githubRemotes(for: repositoryRootURL)
    },
    headURL: { workingDirectoryURL in
      GitWorktreeHeadResolver.headURL(for: workingDirectoryURL)
    }
  )

  static let testValue = Self(
    repositoryRoot: { _ in nil },
    branchName: { _ in nil },
    githubRemotes: { _ in [] },
    headURL: { _ in nil }
  )
}

extension DependencyValues {
  var gitRepositoryClient: GitRepositoryClient {
    get { self[GitRepositoryClient.self] }
    set { self[GitRepositoryClient.self] = newValue }
  }
}

extension GitRepositoryClient {
  static func parseGithubRemoteTarget(
    remoteName: String,
    remoteURL: String
  ) -> GithubRemoteTarget? {
    GitRepositoryCommandRunner.parseGithubRemoteTarget(
      remoteName: remoteName,
      remoteURL: remoteURL
    )
  }
}

private nonisolated enum GitRepositoryCommandRunner {
  static func repositoryRoot(for workingDirectoryURL: URL) -> URL? {
    guard
      let output = try? runGit(
        ["-C", workingDirectoryURL.path(percentEncoded: false), "rev-parse", "--show-toplevel"]
      )
    else {
      return nil
    }
    let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    return URL(fileURLWithPath: trimmed).standardizedFileURL
  }

  static func branchName(for workingDirectoryURL: URL) -> String? {
    guard
      let output = try? runGit(
        ["-C", workingDirectoryURL.path(percentEncoded: false), "branch", "--show-current"]
      )
    else {
      return nil
    }
    let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  static func githubRemotes(for repositoryRootURL: URL) -> [GithubRemoteTarget] {
    guard
      let output = try? runGit(
        ["-C", repositoryRootURL.path(percentEncoded: false), "remote"]
      )
    else {
      return []
    }
    let remoteNames =
      output
      .split(whereSeparator: \.isNewline)
      .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    var targets: [GithubRemoteTarget] = []
    for remoteName in orderedRemoteNames(remoteNames) {
      guard
        let remoteURL = try? runGit(
          [
            "-C",
            repositoryRootURL.path(percentEncoded: false),
            "remote",
            "get-url",
            remoteName,
          ]
        ),
        let target = parseGithubRemoteTarget(
          remoteName: remoteName,
          remoteURL: remoteURL
        )
      else {
        continue
      }
      targets.append(target)
    }
    return targets
  }

  private static func orderedRemoteNames(_ remoteNames: [String]) -> [String] {
    let remainder = remoteNames.filter { $0 != "upstream" && $0 != "origin" }
      .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    var ordered: [String] = []
    if remoteNames.contains("upstream") {
      ordered.append("upstream")
    }
    if remoteNames.contains("origin") {
      ordered.append("origin")
    }
    ordered.append(contentsOf: remainder)
    return ordered
  }

  static func parseGithubRemoteTarget(
    remoteName: String,
    remoteURL: String
  ) -> GithubRemoteTarget? {
    let trimmed = remoteURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    if let target = parseSSHRemote(remoteName: remoteName, remoteURL: trimmed) {
      return target
    }
    if let target = parseURLRemote(remoteName: remoteName, remoteURL: trimmed) {
      return target
    }
    return nil
  }

  private static func parseSSHRemote(
    remoteName: String,
    remoteURL: String
  ) -> GithubRemoteTarget? {
    let components: (host: String, path: String)?
    if remoteURL.hasPrefix("git@"), let colonIndex = remoteURL.firstIndex(of: ":") {
      let hostStartIndex = remoteURL.index(remoteURL.startIndex, offsetBy: 4)
      let host = String(remoteURL[hostStartIndex..<colonIndex])
      let path = String(remoteURL[remoteURL.index(after: colonIndex)...])
      components = (host, path)
    } else if let url = URL(string: remoteURL), url.scheme == "ssh" {
      let host = url.host ?? ""
      let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      components = (host, path)
    } else {
      components = nil
    }
    guard let components else { return nil }
    return target(
      remoteName: remoteName,
      host: components.host,
      path: components.path
    )
  }

  private static func parseURLRemote(
    remoteName: String,
    remoteURL: String
  ) -> GithubRemoteTarget? {
    guard let url = URL(string: remoteURL), let host = url.host else { return nil }
    let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return target(remoteName: remoteName, host: host, path: path)
  }

  private static func target(
    remoteName: String,
    host: String,
    path: String
  ) -> GithubRemoteTarget? {
    let normalizedHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
    guard !normalizedHost.isEmpty else { return nil }
    let trimmedPath = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let segments = trimmedPath.split(separator: "/").map(String.init)
    guard segments.count >= 2 else { return nil }
    let owner = segments[0].trimmingCharacters(in: .whitespacesAndNewlines)
    var repo = segments[1].trimmingCharacters(in: .whitespacesAndNewlines)
    if repo.hasSuffix(".git") {
      repo.removeLast(4)
    }
    guard !owner.isEmpty, !repo.isEmpty else { return nil }
    return GithubRemoteTarget(
      remoteName: remoteName,
      host: normalizedHost,
      owner: owner,
      repo: repo
    )
  }

  private static func runGit(_ arguments: [String]) throws -> String {
    let result = try ProcessRunner.run(
      executableURL: URL(fileURLWithPath: "/usr/bin/git"),
      arguments: arguments
    )
    guard result.status == 0 else {
      throw GitRepositoryError.commandFailed(result.errorMessage)
    }
    return result.standardOutput
  }
}

private nonisolated enum GitRepositoryError: Error {
  case commandFailed(String)
}
