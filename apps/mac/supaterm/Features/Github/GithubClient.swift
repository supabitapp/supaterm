import ComposableArchitecture
import Darwin
import Foundation

nonisolated struct GithubRepositoryIdentity: Equatable, Sendable {
  let branch: String
  let repoRoot: String
}

nonisolated struct GithubPullRequestSnapshot: Equatable, Sendable {
  let number: Int
  let repositoryIdentity: GithubRepositoryIdentity
  let url: URL
}

nonisolated struct GithubPullRequestPresentation: Equatable, Sendable {
  let label: String
  let url: URL

  init(snapshot: GithubPullRequestSnapshot) {
    label = "PR #\(snapshot.number)"
    url = snapshot.url
  }
}

nonisolated struct GithubPullRequestLookupRequest: Equatable, Sendable {
  let surfaceID: UUID
  let workingDirectory: String
}

nonisolated enum GithubPullRequestLookupResponse: Equatable, Sendable {
  case resolved(GithubPullRequestSnapshot?)
  case failure(String)
}

nonisolated enum GithubBinaryStatus: Equatable, Sendable {
  case available(String)
  case unavailable(String)

  var detail: String {
    switch self {
    case .available(let detail), .unavailable(let detail):
      return detail
    }
  }

  var isAvailable: Bool {
    switch self {
    case .available:
      return true
    case .unavailable:
      return false
    }
  }
}

nonisolated enum GithubAuthenticationStatus: Equatable, Sendable {
  case authenticated(String)
  case unavailable(String)
  case unauthenticated(String)

  var detail: String {
    switch self {
    case .authenticated(let detail), .unavailable(let detail), .unauthenticated(let detail):
      return detail
    }
  }

  var isAuthenticated: Bool {
    switch self {
    case .authenticated:
      return true
    case .unavailable, .unauthenticated:
      return false
    }
  }
}

nonisolated struct GithubDiagnostics: Equatable, Sendable {
  let authenticationStatus: GithubAuthenticationStatus
  let ghStatus: GithubBinaryStatus
  let gitStatus: GithubBinaryStatus
}

nonisolated struct GithubClient: Sendable {
  var diagnostics: @Sendable () async -> GithubDiagnostics
  var lookupPullRequests: @Sendable ([GithubPullRequestLookupRequest]) async -> [UUID: GithubPullRequestLookupResponse]
}

extension GithubClient {
  static func live(
    batchSize: Int = 20,
    runner: GithubCommandRunner
  ) -> Self {
    let service = GithubLookupService(
      batchSize: batchSize,
      runner: runner
    )
    return Self(
      diagnostics: {
        await service.diagnostics()
      },
      lookupPullRequests: { requests in
        await service.lookupPullRequests(requests)
      }
    )
  }
}

extension GithubClient: DependencyKey {
  static let liveValue = Self.live(
    runner: .live()
  )

  static let testValue = Self(
    diagnostics: {
      .init(
        authenticationStatus: .unavailable("GitHub diagnostics are unavailable in tests."),
        ghStatus: .unavailable("GitHub CLI is unavailable."),
        gitStatus: .unavailable("Git is unavailable.")
      )
    },
    lookupPullRequests: { _ in [:] }
  )
}

extension DependencyValues {
  var githubClient: GithubClient {
    get { self[GithubClient.self] }
    set { self[GithubClient.self] = newValue }
  }
}

private actor GithubLookupService {
  private let batchSize: Int
  private let runner: GithubCommandRunner

  private var cachedGhPath: String?
  private var cachedGitPath: String?

  init(
    batchSize: Int = 20,
    runner: GithubCommandRunner = .live()
  ) {
    self.batchSize = batchSize
    self.runner = runner
  }

  func diagnostics() -> GithubDiagnostics {
    let gitPath = try? resolveGitPath()
    let ghPath = try? resolveGhPath()

    let gitStatus: GithubBinaryStatus =
      if let gitPath {
        .available("Found at \(gitPath)")
      } else {
        .unavailable("Git must be installed and available in your login shell.")
      }

    let ghStatus: GithubBinaryStatus =
      if let ghPath {
        .available("Found at \(ghPath)")
      } else {
        .unavailable("GitHub CLI must be installed and available in your login shell.")
      }

    let authenticationStatus: GithubAuthenticationStatus
    if let ghPath {
      do {
        let result = try runner.run(ghPath, ["auth", "status", "--hostname", "github.com"], nil)
        if result.status == 0 {
          authenticationStatus = .authenticated(
            nonEmptyMessage(from: result, defaultDetail: "Authenticated with GitHub CLI.")
          )
        } else {
          authenticationStatus = .unauthenticated(
            nonEmptyMessage(from: result, defaultDetail: "GitHub CLI is not authenticated.")
          )
        }
      } catch {
        authenticationStatus = .unauthenticated(error.localizedDescription)
      }
    } else {
      authenticationStatus = .unavailable("GitHub CLI is unavailable, so authentication could not be checked.")
    }

    return .init(
      authenticationStatus: authenticationStatus,
      ghStatus: ghStatus,
      gitStatus: gitStatus
    )
  }

  func lookupPullRequests(
    _ requests: [GithubPullRequestLookupRequest]
  ) -> [UUID: GithubPullRequestLookupResponse] {
    guard !requests.isEmpty else { return [:] }

    let gitPath: String
    let ghPath: String
    do {
      guard let resolvedGitPath = try resolveGitPath() else {
        return Dictionary(
          uniqueKeysWithValues: requests.map {
            ($0.surfaceID, .failure("Git must be installed and available in your login shell."))
          }
        )
      }
      guard let resolvedGhPath = try resolveGhPath() else {
        return Dictionary(
          uniqueKeysWithValues: requests.map {
            ($0.surfaceID, .failure("GitHub CLI must be installed and available in your login shell."))
          }
        )
      }
      gitPath = resolvedGitPath
      ghPath = resolvedGhPath
    } catch {
      return Dictionary(
        uniqueKeysWithValues: requests.map {
          ($0.surfaceID, .failure(error.localizedDescription))
        }
      )
    }

    var responses: [UUID: GithubPullRequestLookupResponse] = [:]

    for chunkStart in stride(from: 0, to: requests.count, by: batchSize) {
      let chunkEnd = min(chunkStart + batchSize, requests.count)
      for request in requests[chunkStart..<chunkEnd] {
        responses[request.surfaceID] = resolvePullRequest(
          for: request,
          gitPath: gitPath,
          ghPath: ghPath
        )
      }
    }

    return responses
  }

  private func resolvePullRequest(
    for request: GithubPullRequestLookupRequest,
    gitPath: String,
    ghPath: String
  ) -> GithubPullRequestLookupResponse {
    do {
      guard
        let context = try resolveRepositoryContext(
          for: request.workingDirectory,
          gitPath: gitPath
        )
      else {
        return .resolved(nil)
      }

      var successfulQuery = false
      var failureMessage: String?

      for repository in context.candidateRepositories {
        let result = try runner.run(
          ghPath,
          [
            "pr",
            "list",
            "--repo",
            repository.ghRepositoryIdentifier,
            "--state",
            "open",
            "--head",
            context.repositoryIdentity.branch,
            "--json",
            "headRefName,headRepositoryOwner,number,url",
          ],
          context.repositoryIdentity.repoRoot
        )

        guard result.status == 0 else {
          failureMessage = nonEmptyMessage(
            from: result,
            defaultDetail: "GitHub CLI could not query pull requests."
          )
          continue
        }

        successfulQuery = true
        let pullRequests = try JSONDecoder().decode(
          [GithubPullRequestCandidate].self,
          from: Data(result.standardOutput.utf8)
        )

        if let pullRequest = bestMatch(
          in: pullRequests,
          expectedHeadOwner: context.expectedHeadOwner
        ) {
          return .resolved(
            .init(
              number: pullRequest.number,
              repositoryIdentity: context.repositoryIdentity,
              url: pullRequest.url
            )
          )
        }
      }

      if successfulQuery {
        return .resolved(nil)
      }

      if let failureMessage {
        return .failure(failureMessage)
      }

      return .resolved(nil)
    } catch {
      return .failure(error.localizedDescription)
    }
  }

  private func resolveRepositoryContext(
    for workingDirectory: String,
    gitPath: String
  ) throws -> GithubRepositoryContext? {
    let repoRootResult = try runner.run(gitPath, ["-C", workingDirectory, "rev-parse", "--show-toplevel"], nil)
    guard repoRootResult.status == 0 else { return nil }
    guard let repoRoot = trimmedNonEmpty(repoRootResult.standardOutput) else { return nil }

    let branchResult = try runner.run(gitPath, ["-C", repoRoot, "symbolic-ref", "--quiet", "--short", "HEAD"], nil)
    guard branchResult.status == 0 else { return nil }
    guard let branch = trimmedNonEmpty(branchResult.standardOutput) else { return nil }

    let upstreamResult = try runner.run(
      gitPath,
      [
        "-C",
        repoRoot,
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ],
      nil
    )
    let upstreamReference = upstreamResult.status == 0 ? trimmedNonEmpty(upstreamResult.standardOutput) : nil

    let remotesResult = try runner.run(gitPath, ["-C", repoRoot, "remote", "-v"], nil)
    guard remotesResult.status == 0 else { return nil }

    let remotes = parseRemotes(remotesResult.standardOutput)
    guard !remotes.isEmpty else { return nil }

    let trackingRemoteName = upstreamReference.flatMap(Self.remoteName(fromUpstreamReference:))
    let candidateRepositories = orderedRepositories(
      from: remotes,
      trackingRemoteName: trackingRemoteName
    )

    guard !candidateRepositories.isEmpty else { return nil }

    let expectedHeadOwner = trackingRemoteName
      .flatMap { name in remotes.first(where: { $0.name == name }) }
      .map { $0.repository.owner }

    return .init(
      candidateRepositories: candidateRepositories,
      expectedHeadOwner: expectedHeadOwner,
      repositoryIdentity: .init(
        branch: branch,
        repoRoot: repoRoot
      )
    )
  }

  private func orderedRepositories(
    from remotes: [GithubRemote],
    trackingRemoteName: String?
  ) -> [GithubRepositoryReference] {
    var orderedNames: [String] = []

    if let trackingRemoteName {
      orderedNames.append(trackingRemoteName)
    }
    orderedNames.append("upstream")
    orderedNames.append("origin")
    orderedNames.append(
      contentsOf: remotes
        .map(\.name)
        .sorted()
    )

    var seenRepositories = Set<GithubRepositoryReference>()
    var repositories: [GithubRepositoryReference] = []

    for name in orderedNames {
      guard let remote = remotes.first(where: { $0.name == name }) else { continue }
      if seenRepositories.insert(remote.repository).inserted {
        repositories.append(remote.repository)
      }
    }

    return repositories
  }

  private func bestMatch(
    in pullRequests: [GithubPullRequestCandidate],
    expectedHeadOwner: String?
  ) -> GithubPullRequestCandidate? {
    if let expectedHeadOwner,
      let preferred = pullRequests.first(where: {
        $0.headRepositoryOwner?.login.caseInsensitiveCompare(expectedHeadOwner) == .orderedSame
      })
    {
      return preferred
    }

    return pullRequests.first
  }

  private func parseRemotes(
    _ output: String
  ) -> [GithubRemote] {
    output
      .split(whereSeparator: \.isNewline)
      .compactMap { line in
        let parts = line.split(whereSeparator: \.isWhitespace)
        guard parts.count >= 3 else { return nil }
        guard parts[2] == "(fetch)" else { return nil }
        guard
          let repository = GithubRepositoryReference(
            remoteURL: String(parts[1])
          )
        else {
          return nil
        }
        return GithubRemote(
          name: String(parts[0]),
          repository: repository
        )
      }
  }

  private func resolveGitPath() throws -> String? {
    if let cachedGitPath {
      return cachedGitPath
    }
    let resolvedGitPath = try runner.resolveCommandPath("git")
    cachedGitPath = resolvedGitPath
    return resolvedGitPath
  }

  private func resolveGhPath() throws -> String? {
    if let cachedGhPath {
      return cachedGhPath
    }
    let resolvedGhPath = try runner.resolveCommandPath("gh")
    cachedGhPath = resolvedGhPath
    return resolvedGhPath
  }

  private static func remoteName(
    fromUpstreamReference upstreamReference: String
  ) -> String? {
    let components = upstreamReference.split(separator: "/", maxSplits: 1)
    guard let remoteName = components.first else { return nil }
    let trimmed = remoteName.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func nonEmptyMessage(
    from result: GithubCommandResult,
    defaultDetail: String
  ) -> String {
    trimmedNonEmpty(result.standardError)
      ?? trimmedNonEmpty(result.standardOutput)
      ?? defaultDetail
  }
}

private nonisolated struct GithubRepositoryContext: Sendable {
  let candidateRepositories: [GithubRepositoryReference]
  let expectedHeadOwner: String?
  let repositoryIdentity: GithubRepositoryIdentity
}

private nonisolated struct GithubRemote: Equatable, Sendable {
  let name: String
  let repository: GithubRepositoryReference
}

private nonisolated struct GithubRepositoryReference: Equatable, Hashable, Sendable {
  let host: String
  let name: String
  let owner: String

  init(
    host: String,
    name: String,
    owner: String
  ) {
    self.host = host
    self.name = name
    self.owner = owner
  }

  init?(
    remoteURL: String
  ) {
    let trimmedRemoteURL = remoteURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedRemoteURL.isEmpty else { return nil }

    if let parsed = Self.parseSCPStyleRemote(trimmedRemoteURL) {
      self = parsed
      return
    }

    guard let components = URLComponents(string: trimmedRemoteURL) else { return nil }
    guard let host = components.host?.trimmingCharacters(in: .whitespacesAndNewlines), !host.isEmpty else {
      return nil
    }
    let pathComponents = components.path
      .split(separator: "/")
      .map(String.init)
    guard pathComponents.count >= 2 else { return nil }
    let owner = pathComponents[pathComponents.count - 2]
    let repositoryName = pathComponents[pathComponents.count - 1]
    guard let normalized = Self.normalized(host: host, owner: owner, repositoryName: repositoryName) else {
      return nil
    }
    self = normalized
  }

  var ghRepositoryIdentifier: String {
    if host.caseInsensitiveCompare("github.com") == .orderedSame {
      return "\(owner)/\(name)"
    }
    return "\(host)/\(owner)/\(name)"
  }

  private static func parseSCPStyleRemote(
    _ remoteURL: String
  ) -> Self? {
    guard !remoteURL.contains("://") else { return nil }
    guard let colonIndex = remoteURL.lastIndex(of: ":") else { return nil }

    let hostSegment = remoteURL[..<colonIndex]
    let pathSegment = remoteURL[remoteURL.index(after: colonIndex)...]
    let host = hostSegment.split(separator: "@").last.map(String.init) ?? String(hostSegment)
    let pathComponents = pathSegment.split(separator: "/").map(String.init)
    guard pathComponents.count >= 2 else { return nil }
    let owner = pathComponents[pathComponents.count - 2]
    let repositoryName = pathComponents[pathComponents.count - 1]
    return normalized(host: host, owner: owner, repositoryName: repositoryName)
  }

  private static func normalized(
    host: String,
    owner: String,
    repositoryName: String
  ) -> Self? {
    let normalizedHost = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let normalizedOwner = owner.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedRepositoryName = repositoryName
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: ".git", with: "", options: [.anchored, .backwards])

    guard !normalizedHost.isEmpty, !normalizedOwner.isEmpty, !normalizedRepositoryName.isEmpty else {
      return nil
    }

    return .init(
      host: normalizedHost,
      name: normalizedRepositoryName,
      owner: normalizedOwner
    )
  }
}

private nonisolated struct GithubPullRequestCandidate: Decodable, Equatable, Sendable {
  nonisolated struct RepositoryOwner: Decodable, Equatable, Sendable {
    let login: String
  }

  let headRefName: String
  let headRepositoryOwner: RepositoryOwner?
  let number: Int
  let url: URL
}

nonisolated struct GithubCommandResult: Equatable, Sendable {
  let standardError: String
  let standardOutput: String
  let status: Int32
}

nonisolated struct GithubCommandRunner: Sendable {
  let resolveCommandPath: @Sendable (_ commandName: String) throws -> String?
  let run:
    @Sendable (_ executablePath: String, _ arguments: [String], _ currentDirectoryPath: String?) throws ->
      GithubCommandResult

  static func live(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    currentUserShellPath: String? = currentUserShellPath()
  ) -> Self {
    let loginShellURL = loginShellURL(
      environment: environment,
      currentUserShellPath: currentUserShellPath
    )
    return Self(
      resolveCommandPath: { commandName in
        let result = try runProcess(
          executablePath: loginShellURL.path,
          arguments: ["-l", "-c", "command -v \(commandName)"],
          currentDirectoryPath: nil,
          environment: environment
        )
        guard result.status == 0 else { return nil }
        return trimmedNonEmpty(result.standardOutput)
      },
      run: { executablePath, arguments, currentDirectoryPath in
        try runProcess(
          executablePath: executablePath,
          arguments: arguments,
          currentDirectoryPath: currentDirectoryPath,
          environment: environment
        )
      }
    )
  }

  private static func loginShellURL(
    environment: [String: String],
    currentUserShellPath: String?
  ) -> URL {
    let shellPath =
      normalizedShellPath(currentUserShellPath)
      ?? normalizedShellPath(environment["SHELL"])
      ?? "/bin/zsh"
    return URL(fileURLWithPath: shellPath)
  }

  private static func currentUserShellPath() -> String? {
    guard let entry = getpwuid(getuid()), let shell = entry.pointee.pw_shell else {
      return nil
    }
    return String(cString: shell)
  }

  private static func normalizedShellPath(_ path: String?) -> String? {
    guard let trimmedPath = trimmedNonEmpty(path) else { return nil }
    return trimmedPath
  }

  private static func runProcess(
    executablePath: String,
    arguments: [String],
    currentDirectoryPath: String?,
    environment: [String: String]
  ) throws -> GithubCommandResult {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executablePath)
    process.arguments = arguments
    process.environment = environment
    if let currentDirectoryPath {
      process.currentDirectoryURL = URL(fileURLWithPath: currentDirectoryPath, isDirectory: true)
    }

    let outputPipe = Pipe()
    let errorPipe = Pipe()
    process.standardOutput = outputPipe
    process.standardError = errorPipe

    try process.run()
    process.waitUntilExit()

    return .init(
      standardError: normalizedPipeOutput(errorPipe),
      standardOutput: normalizedPipeOutput(outputPipe),
      status: process.terminationStatus
    )
  }

  private static func normalizedPipeOutput(
    _ pipe: Pipe
  ) -> String {
    String(
      bytes: pipe.fileHandleForReading.readDataToEndOfFile(),
      encoding: .utf8
    )?
    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }
}

private nonisolated func trimmedNonEmpty(
  _ value: String?
) -> String? {
  guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
    return nil
  }
  return trimmed
}
