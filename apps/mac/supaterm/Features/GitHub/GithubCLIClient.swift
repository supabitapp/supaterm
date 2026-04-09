import ComposableArchitecture
import Darwin
import Foundation

nonisolated struct GithubCLIClient: Sendable {
  var isAvailable: @Sendable () async -> Bool
  var authStatus: @Sendable () async throws -> GithubAuthStatus?
  var batchPullRequests: @Sendable (GithubRemoteTarget, [String]) async throws -> [String: GithubPullRequest]
}

extension GithubCLIClient: DependencyKey {
  static let liveValue = live()

  static func live() -> GithubCLIClient {
    let resolver = GithubCLIExecutableResolver()
    let availabilityCache = GithubCLIAvailabilityCache()
    return GithubCLIClient(
      isAvailable: {
        await availabilityCache.value {
          do {
            _ = try GithubCLIRunner.run(
              resolver: resolver,
              arguments: ["--version"]
            )
            return true
          } catch {
            return false
          }
        }
      },
      authStatus: {
        let output = try GithubCLIRunner.run(
          resolver: resolver,
          arguments: ["auth", "status", "--json", "hosts"]
        )
        let data = Data(output.utf8)
        let response = try JSONDecoder().decode(GithubAuthStatusResponse.self, from: data)
        for (host, accounts) in response.hosts.sorted(by: { $0.key < $1.key }) {
          if let account = accounts.first(where: { $0.active }) {
            return GithubAuthStatus(username: account.login, host: host)
          }
        }
        return nil
      },
      batchPullRequests: { remote, branches in
        let deduplicated = GithubCLIRunner.deduplicatedBranches(branches)
        guard !deduplicated.isEmpty else { return [:] }
        let chunks = GithubCLIRunner.makeBranchChunks(
          deduplicated,
          chunkSize: 25
        )
        var results: [String: GithubPullRequest] = [:]
        for chunk in chunks {
          let (query, aliasMap) = GithubCLIRunner.makeBatchPullRequestsQuery(branches: chunk)
          let output = try GithubCLIRunner.run(
            resolver: resolver,
            arguments: [
              "api",
              "graphql",
              "--hostname",
              remote.host,
              "-f",
              "query=\(query)",
              "-f",
              "owner=\(remote.owner)",
              "-f",
              "repo=\(remote.repo)",
            ]
          )
          guard !output.isEmpty else { continue }
          let decoder = JSONDecoder()
          decoder.dateDecodingStrategy = .iso8601
          let response = try decoder.decode(
            GithubGraphQLPullRequestResponse.self,
            from: Data(output.utf8)
          )
          let chunkResults = response.pullRequestsByBranch(
            aliasMap: aliasMap,
            owner: remote.owner,
            repo: remote.repo
          )
          results.merge(chunkResults) { current, _ in current }
        }
        return results
      }
    )
  }

  static let testValue = GithubCLIClient(
    isAvailable: { true },
    authStatus: { GithubAuthStatus(username: "test", host: "github.com") },
    batchPullRequests: { _, _ in [:] }
  )
}

extension DependencyValues {
  var githubCLIClient: GithubCLIClient {
    get { self[GithubCLIClient.self] }
    set { self[GithubCLIClient.self] = newValue }
  }
}

private actor GithubCLIAvailabilityCache {
  private struct Entry {
    let value: Bool
    let fetchedAt: ContinuousClock.Instant
  }

  private let clock = ContinuousClock()
  private let ttl: Duration = .seconds(30)
  private var cachedEntry: Entry?
  private var inFlightTask: Task<Bool, Never>?

  func value(fetch: @Sendable @escaping () async -> Bool) async -> Bool {
    let now = clock.now
    if let cachedEntry, cachedEntry.fetchedAt.duration(to: now) < ttl {
      return cachedEntry.value
    }
    if let inFlightTask {
      return await inFlightTask.value
    }
    let task = Task { await fetch() }
    inFlightTask = task
    let value = await task.value
    cachedEntry = Entry(value: value, fetchedAt: clock.now)
    inFlightTask = nil
    return value
  }
}

private nonisolated final class GithubCLIExecutableResolver: @unchecked Sendable {
  private let lock = NSLock()
  private var cachedExecutableURL: URL?

  func executableURL() throws -> URL {
    lock.lock()
    defer { lock.unlock() }
    if let cachedExecutableURL {
      return cachedExecutableURL
    }
    let executableURL = try GithubCLIRunner.resolveExecutableURL()
    cachedExecutableURL = executableURL
    return executableURL
  }
}

private nonisolated struct GithubAuthStatusResponse: Decodable {
  let hosts: [String: [GithubAuthAccount]]

  struct GithubAuthAccount: Decodable {
    let active: Bool
    let login: String
  }
}

private nonisolated enum GithubCLIRunner {
  static func run(
    resolver: GithubCLIExecutableResolver,
    arguments: [String]
  ) throws -> String {
    let executableURL = try resolver.executableURL()
    let result = try runLoginShellCommand(
      executableURL: executableURL,
      arguments: arguments
    )
    guard result.status == 0 else {
      if isOutdated(result) {
        throw GithubCLIError.outdated
      }
      throw GithubCLIError.commandFailed(result.errorMessage)
    }
    return result.standardOutput
  }

  static func resolveExecutableURL() throws -> URL {
    if let direct = locateExecutableURL(useLoginShell: false) {
      return direct
    }
    if let login = locateExecutableURL(useLoginShell: true) {
      return login
    }
    throw GithubCLIError.unavailable
  }

  private static func locateExecutableURL(useLoginShell: Bool) -> URL? {
    let whichURL = URL(fileURLWithPath: "/usr/bin/which")
    let result: ProcessResult
    do {
      if useLoginShell {
        result = try runLoginShellCommand(
          executableURL: whichURL,
          arguments: ["gh"],
          useWhichMode: true
        )
      } else {
        result = try ProcessRunner.run(
          executableURL: whichURL,
          arguments: ["gh"]
        )
      }
    } catch {
      return nil
    }
    guard result.status == 0 else { return nil }
    let trimmed = result.standardOutput.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    return URL(fileURLWithPath: trimmed)
  }

  static func deduplicatedBranches(_ branches: [String]) -> [String] {
    var seen = Set<String>()
    return branches.filter { !$0.isEmpty && seen.insert($0).inserted }
  }

  static func makeBranchChunks(
    _ branches: [String],
    chunkSize: Int
  ) -> [[String]] {
    guard !branches.isEmpty else { return [] }
    var chunks: [[String]] = []
    var index = 0
    while index < branches.count {
      let end = min(index + chunkSize, branches.count)
      chunks.append(Array(branches[index..<end]))
      index = end
    }
    return chunks
  }

  static func makeBatchPullRequestsQuery(
    branches: [String]
  ) -> (query: String, aliasMap: [String: String]) {
    var aliasMap: [String: String] = [:]
    var selections: [String] = []
    for (index, branch) in branches.enumerated() {
      let alias = "branch\(index)"
      aliasMap[alias] = branch
      let escapedBranch = escapeGraphQLString(branch)
      selections.append(
        """
          \(alias): pullRequests(
            first: 5,
            states: [OPEN, MERGED],
            headRefName: "\(escapedBranch)",
            orderBy: {field: UPDATED_AT, direction: DESC}
          ) {
            nodes {
              number
              title
              state
              isDraft
              reviewDecision
              mergeable
              mergeStateStatus
              url
              updatedAt
              headRefName
              baseRefName
              headRepository {
                name
                owner { login }
              }
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    ... on CheckRun {
                      name
                      status
                      conclusion
                      detailsUrl
                    }
                    ... on StatusContext {
                      context
                      state
                      targetUrl
                    }
                  }
                }
              }
            }
          }
        """
      )
    }
    let selectionBlock = selections.joined(separator: "\n")
    let query = """
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
      \(selectionBlock)
        }
      }
      """
    return (query, aliasMap)
  }

  private static func escapeGraphQLString(_ value: String) -> String {
    value
      .replacing("\\", with: "\\\\")
      .replacing("\"", with: "\\\"")
      .replacing("\n", with: "\\n")
      .replacing("\r", with: "\\r")
      .replacing("\t", with: "\\t")
  }

  private static func isOutdated(_ result: ProcessResult) -> Bool {
    let combined = "\(result.standardOutput)\n\(result.standardError)".lowercased()
    if combined.contains("unknown flag: --json") {
      return true
    }
    if combined.contains("unknown shorthand flag") && combined.contains("json") {
      return true
    }
    return false
  }

  private static func runLoginShellCommand(
    executableURL: URL,
    arguments: [String],
    useWhichMode: Bool = false
  ) throws -> ProcessResult {
    let shellURL = loginShellURL()
    let command: String
    if useWhichMode {
      command = ([executableURL.path(percentEncoded: false)] + arguments).joined(separator: " ")
    } else {
      let escapedExecutable = shellEscaped(executableURL.path(percentEncoded: false))
      let escapedArguments = arguments.map(shellEscaped).joined(separator: " ")
      command = [escapedExecutable, escapedArguments]
        .filter { !$0.isEmpty }
        .joined(separator: " ")
    }
    return try ProcessRunner.run(
      executableURL: shellURL,
      arguments: ["-l", "-c", command]
    )
  }

  private static func loginShellURL() -> URL {
    let shellPath =
      currentUserShellPath()
      ?? ProcessInfo.processInfo.environment["SHELL"]
      ?? "/bin/zsh"
    return URL(fileURLWithPath: shellPath)
  }

  private static func currentUserShellPath() -> String? {
    guard let entry = getpwuid(getuid()), let shell = entry.pointee.pw_shell else {
      return nil
    }
    let value = String(cString: shell).trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
  }

  private static func shellEscaped(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }
}
