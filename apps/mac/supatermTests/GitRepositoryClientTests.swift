import Foundation
import Testing

@testable import supaterm

struct GitRepositoryClientTests {
  @Test
  func githubRemotesPreferUpstreamThenOriginThenOthers() async throws {
    let rootURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: rootURL) }

    try runGit(["init"], in: rootURL)
    try runGit(["remote", "add", "zebra", "git@github.com:other/tools.git"], in: rootURL)
    try runGit(["remote", "add", "origin", "git@github.com:khoi/supaterm.git"], in: rootURL)
    try runGit(["remote", "add", "upstream", "git@github.com:supabitapp/supaterm.git"], in: rootURL)
    try runGit(["remote", "add", "alpha", "https://github.example.com/org/infra.git"], in: rootURL)

    let remotes = await GitRepositoryClient.liveValue.githubRemotes(rootURL)

    #expect(remotes.map(\.remoteName) == ["upstream", "origin", "alpha", "zebra"])
    #expect(remotes.map(\.host) == ["github.com", "github.com", "github.example.com", "github.com"])
  }

  @Test
  func parsesGithubRemoteTargetsFromSshAndHttps() {
    let ssh = GitRepositoryClient.parseGithubRemoteTarget(
      remoteName: "upstream",
      remoteURL: "git@github.com:supabitapp/supaterm.git"
    )
    let https = GitRepositoryClient.parseGithubRemoteTarget(
      remoteName: "origin",
      remoteURL: "https://github.example.com/team/product.git"
    )

    #expect(
      ssh == GithubRemoteTarget(remoteName: "upstream", host: "github.com", owner: "supabitapp", repo: "supaterm"))
    #expect(
      https == GithubRemoteTarget(remoteName: "origin", host: "github.example.com", owner: "team", repo: "product"))
  }

  private func runGit(_ arguments: [String], in directoryURL: URL) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
    process.arguments = arguments
    process.currentDirectoryURL = directoryURL

    let outputPipe = Pipe()
    process.standardOutput = outputPipe
    process.standardError = outputPipe

    try process.run()
    process.waitUntilExit()

    if process.terminationStatus != 0 {
      let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
      throw GitTestError.commandFailed(String(data: data, encoding: .utf8) ?? "")
    }
  }
}

private enum GitTestError: Error {
  case commandFailed(String)
}
