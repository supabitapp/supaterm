import Foundation
import Testing

@testable import supaterm

@MainActor
struct GithubClientTests {
  @Test
  func lookupPullRequestsPrefersTrackingRemoteBeforeUpstream() async {
    let recorder = GithubCommandRecorder()
    let client = GithubClient.live(
      runner: .init(
        resolveCommandPath: { commandName in
          switch commandName {
          case "git":
            return "/usr/bin/git"
          case "gh":
            return "/opt/homebrew/bin/gh"
          default:
            return nil
          }
        },
        run: { executablePath, arguments, currentDirectoryPath in
          recorder.record(
            executablePath: executablePath,
            arguments: arguments,
            currentDirectoryPath: currentDirectoryPath
          )
          return try githubCommandResult(
            executablePath: executablePath,
            arguments: arguments
          )
        }
      )
    )

    let surfaceID = UUID()
    let responses = await client.lookupPullRequests(
      [
        .init(
          surfaceID: surfaceID,
          workingDirectory: "/tmp/project/subdir",
        ),
      ]
    )

    #expect(
      responses[surfaceID] == .resolved(
        .init(
          number: 123,
          repositoryIdentity: .init(
            branch: "feature",
            repoRoot: "/tmp/project"
          ),
          url: URL(string: "https://github.com/supabitapp/supaterm/pull/123")!
        )
      )
    )
    #expect(
      recorder.recordedGithubRepositories() == [
        "acme/supaterm",
        "supabitapp/supaterm",
      ]
    )
  }

  @Test
  func lookupPullRequestsPrefersForkOwnerWhenMultiplePullRequestsShareTheBranchName() async {
    let client = GithubClient.live(
      runner: .init(
        resolveCommandPath: { commandName in
          switch commandName {
          case "git":
            return "/usr/bin/git"
          case "gh":
            return "/opt/homebrew/bin/gh"
          default:
            return nil
          }
        },
        run: { executablePath, arguments, _ in
          try githubCommandResult(
            executablePath: executablePath,
            arguments: arguments,
            upstreamPullRequests: """
              [
                {
                  "headRefName": "feature",
                  "headRepositoryOwner": { "login": "someone-else" },
                  "number": 98,
                  "url": "https://github.com/supabitapp/supaterm/pull/98"
                },
                {
                  "headRefName": "feature",
                  "headRepositoryOwner": { "login": "acme" },
                  "number": 456,
                  "url": "https://github.com/supabitapp/supaterm/pull/456"
                }
              ]
              """
          )
        }
      )
    )

    let surfaceID = UUID()
    let responses = await client.lookupPullRequests(
      [
        .init(
          surfaceID: surfaceID,
          workingDirectory: "/tmp/project/subdir",
        ),
      ]
    )

    #expect(
      responses[surfaceID] == .resolved(
        .init(
          number: 456,
          repositoryIdentity: .init(
            branch: "feature",
            repoRoot: "/tmp/project"
          ),
          url: URL(string: "https://github.com/supabitapp/supaterm/pull/456")!
        )
      )
    )
  }

  @Test
  func lookupPullRequestsProcessesRequestsAcrossMultipleChunks() async {
    let recorder = GithubCommandRecorder()
    let client = GithubClient.live(
      batchSize: 2,
      runner: .init(
        resolveCommandPath: { commandName in
          switch commandName {
          case "git":
            return "/usr/bin/git"
          case "gh":
            return "/opt/homebrew/bin/gh"
          default:
            return nil
          }
        },
        run: { executablePath, arguments, currentDirectoryPath in
          recorder.record(
            executablePath: executablePath,
            arguments: arguments,
            currentDirectoryPath: currentDirectoryPath
          )
          return try chunkedGithubCommandResult(
            executablePath: executablePath,
            arguments: arguments
          )
        }
      )
    )

    let requests = (1...5).map { index in
      GithubPullRequestLookupRequest(
        surfaceID: UUID(),
        workingDirectory: "/tmp/project\(index)"
      )
    }
    let responses = await client.lookupPullRequests(requests)

    #expect(responses.count == 5)
    for (index, request) in requests.enumerated() {
      #expect(
        responses[request.surfaceID] == .resolved(
          .init(
            number: index + 1,
            repositoryIdentity: .init(
              branch: "feature\(index + 1)",
              repoRoot: "/tmp/project\(index + 1)"
            ),
            url: URL(string: "https://github.com/acme/project\(index + 1)/pull/\(index + 1)")!
          )
        )
      )
    }
    #expect(recorder.recordedGithubRepositories() == [
      "acme/project1",
      "acme/project2",
      "acme/project3",
      "acme/project4",
      "acme/project5",
    ])
  }
}

private nonisolated func githubCommandResult(
  executablePath: String,
  arguments: [String],
  upstreamPullRequests: String = """
    [
      {
        "headRefName": "feature",
        "headRepositoryOwner": { "login": "acme" },
        "number": 123,
        "url": "https://github.com/supabitapp/supaterm/pull/123"
      }
    ]
    """
) throws -> GithubCommandResult {
  if executablePath.hasSuffix("/git") {
    switch arguments {
    case ["-C", "/tmp/project/subdir", "rev-parse", "--show-toplevel"]:
      return .init(standardError: "", standardOutput: "/tmp/project", status: 0)
    case ["-C", "/tmp/project", "symbolic-ref", "--quiet", "--short", "HEAD"]:
      return .init(standardError: "", standardOutput: "feature", status: 0)
    case ["-C", "/tmp/project", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]:
      return .init(standardError: "", standardOutput: "origin/feature", status: 0)
    case ["-C", "/tmp/project", "remote", "-v"]:
      return .init(
        standardError: "",
        standardOutput: """
          origin	git@github.com:acme/supaterm.git (fetch)
          origin	git@github.com:acme/supaterm.git (push)
          upstream	git@github.com:supabitapp/supaterm.git (fetch)
          upstream	git@github.com:supabitapp/supaterm.git (push)
          """,
        status: 0
      )
    default:
      throw TestFailure("Unexpected git arguments: \(arguments)")
    }
  }

  if executablePath.hasSuffix("/gh") {
    switch arguments {
    case [
      "pr",
      "list",
      "--repo",
      "acme/supaterm",
      "--state",
      "open",
      "--head",
      "feature",
      "--json",
      "headRefName,headRepositoryOwner,number,url",
    ]:
      return .init(standardError: "", standardOutput: "[]", status: 0)
    case [
      "pr",
      "list",
      "--repo",
      "supabitapp/supaterm",
      "--state",
      "open",
      "--head",
      "feature",
      "--json",
      "headRefName,headRepositoryOwner,number,url",
    ]:
      return .init(standardError: "", standardOutput: upstreamPullRequests, status: 0)
    default:
      throw TestFailure("Unexpected gh arguments: \(arguments)")
    }
  }

  throw TestFailure("Unexpected executable path: \(executablePath)")
}

private nonisolated func chunkedGithubCommandResult(
  executablePath: String,
  arguments: [String]
) throws -> GithubCommandResult {
  if executablePath.hasSuffix("/git") {
    guard arguments.count >= 3 else {
      throw TestFailure("Unexpected git arguments: \(arguments)")
    }
    let workingDirectory = arguments[1]
    let index = try #require(Int(workingDirectory.replacingOccurrences(of: "/tmp/project", with: "")))

    switch Array(arguments.dropFirst(2)) {
    case ["rev-parse", "--show-toplevel"]:
      return .init(standardError: "", standardOutput: "/tmp/project\(index)", status: 0)
    case ["symbolic-ref", "--quiet", "--short", "HEAD"]:
      return .init(standardError: "", standardOutput: "feature\(index)", status: 0)
    case ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]:
      return .init(standardError: "", standardOutput: "origin/feature\(index)", status: 0)
    case ["remote", "-v"]:
      return .init(
        standardError: "",
        standardOutput: """
          origin	git@github.com:acme/project\(index).git (fetch)
          origin	git@github.com:acme/project\(index).git (push)
          """,
        status: 0
      )
    default:
      throw TestFailure("Unexpected git arguments: \(arguments)")
    }
  }

  if executablePath.hasSuffix("/gh") {
    guard
      let repositoryIndex = arguments.firstIndex(of: "--repo"),
      arguments.indices.contains(repositoryIndex + 1)
    else {
      throw TestFailure("Unexpected gh arguments: \(arguments)")
    }
    let repository = arguments[repositoryIndex + 1]
    let index = try #require(Int(repository.replacingOccurrences(of: "acme/project", with: "")))
    return .init(
      standardError: "",
      standardOutput: """
        [
          {
            "headRefName": "feature\(index)",
            "headRepositoryOwner": { "login": "acme" },
            "number": \(index),
            "url": "https://github.com/acme/project\(index)/pull/\(index)"
          }
        ]
        """,
      status: 0
    )
  }

  throw TestFailure("Unexpected executable path: \(executablePath)")
}

private nonisolated enum TestFailure: Error {
  case message(String)

  init(_ message: String) {
    self = .message(message)
  }
}

private nonisolated final class GithubCommandRecorder: @unchecked Sendable {
  private let lock = NSLock()
  private var commands: [([String], String?)] = []

  func record(
    executablePath: String,
    arguments: [String],
    currentDirectoryPath: String?
  ) {
    guard executablePath.hasSuffix("/gh") else { return }
    lock.lock()
    commands.append((arguments, currentDirectoryPath))
    lock.unlock()
  }

  func recordedGithubRepositories() -> [String] {
    lock.lock()
    let commands = commands
    lock.unlock()
    return commands.compactMap { arguments, _ in
      guard let repoIndex = arguments.firstIndex(of: "--repo"), arguments.indices.contains(repoIndex + 1) else {
        return nil
      }
      return arguments[repoIndex + 1]
    }
  }
}
