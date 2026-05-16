import Foundation
import Testing

@testable import supaterm

struct TerminalAgentPanelTests {
  @Test
  func shortstatParserHandlesInsertionsAndDeletions() {
    #expect(
      TerminalAgentGitClient.parseShortstat(
        " 2 files changed, 2676 insertions(+), 4 deletions(-)\n"
      ) == (added: 2676, removed: 4)
    )
  }

  @Test
  func shortstatParserHandlesEmptyDiff() {
    #expect(TerminalAgentGitClient.parseShortstat("") == (added: 0, removed: 0))
  }

  @Test
  func porcelainStatusDetectsWorkingTreeChanges() {
    #expect(
      TerminalAgentGitClient.hasWorkingTreeChanges(
        """
        # branch.oid abc
        # branch.head main
        1 .M N... 100644 100644 100644 abc abc file.swift
        """
      )
    )
    #expect(
      !TerminalAgentGitClient.hasWorkingTreeChanges(
        """
        # branch.oid abc
        # branch.head main
        """
      )
    )
  }

  @Test
  func headResolverHandlesWorktreeGitFile() throws {
    let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: root) }
    let worktree = root.appending(path: "worktree", directoryHint: .isDirectory)
    let gitDirectory = root.appending(path: "gitdir", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: worktree, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: gitDirectory, withIntermediateDirectories: true)
    try "gitdir: \(gitDirectory.path(percentEncoded: false))\n".write(
      to: worktree.appending(path: ".git"),
      atomically: true,
      encoding: .utf8
    )

    #expect(
      TerminalAgentGitClient.headURL(for: worktree, fileManager: .default)
        == gitDirectory.appending(path: "HEAD")
    )
  }

  @Test
  func processTreeExpansionIncludesDescendants() {
    let expanded = PaneAgentPortScanner.expandProcessTree(
      rootProcessIDs: [10],
      parentByPID: [
        11: 10,
        12: 11,
        20: 1,
      ]
    )

    #expect(expanded == [10, 11, 12])
  }

  @Test
  func lsofParserExtractsListeningPorts() {
    let ports = PaneAgentPortScanner.ports(
      fromLsofOutput: """
        p10
        n*:5173
        n127.0.0.1:5175
        p12
        n[::1]:8080
        """
    )

    #expect(ports == [10: [5173, 5175], 12: [8080]])
  }

  @Test
  func githubPullRequestDecoderHandlesNoPullRequest() {
    let status = TerminalAgentGithubClient.decodePullRequestStatus(
      """
      {"data":{"repository":{"pullRequests":{"nodes":[]}}}}
      """
    )

    #expect(status == .none)
  }
}
