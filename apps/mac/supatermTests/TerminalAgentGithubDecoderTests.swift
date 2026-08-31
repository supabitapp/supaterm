import Foundation
import Testing

@testable import supaterm

extension TerminalAgentPanelTests {
  @Test
  func githubPullRequestDecoderShowsAutoMerge() {
    let status = Self.decodePullRequestStatus(
      autoMergeEnabled: true,
      inMergeQueue: false
    )

    #expect(status.mergeAutomation == .autoMerge)
    #expect(status.displayTitle == "#39 (Auto merge enabled)")
  }

  @Test
  func githubPullRequestDecoderPrefersMergeQueue() {
    let status = Self.decodePullRequestStatus(
      autoMergeEnabled: true,
      inMergeQueue: true
    )

    #expect(status.mergeAutomation == .mergeQueue)
    #expect(status.displayTitle == "#39 (In merge queue)")
  }

  @Test
  func githubPullRequestDecoderKeepsGoodBranchesWhenOneAliasIsNull() {
    let statuses = TerminalAgentGithubClient.decodePullRequestStatuses(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 39,
                  "additions": 10,
                  "deletions": 2,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/39",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {"nodes": []}
                }
              ]
            },
            "branch1": null
          }
        }
      }
      """,
      aliasMap: ["branch0": "feature/a", "branch1": "feature/b"],
      remote: TerminalAgentGithubRemote(
        host: "github.com",
        owner: "supabitapp",
        repo: "supaterm"
      )
    )

    #expect(statuses["feature/a"]?.kind == .open)
    #expect(statuses["feature/a"]?.title == "#39")
    #expect(statuses["feature/b"]?.kind == PaneAgentPullRequestStatus.Kind.none)
    #expect(statuses["feature/b"]?.title == "Create pull request")
    #expect(
      statuses["feature/b"]?.url?.absoluteString
        == "https://github.com/supabitapp/supaterm/compare/feature/b?expand=1"
    )
  }

  @Test
  func githubPullRequestDecoderIgnoresForkPullRequestTargetingCurrentBranch() {
    let statuses = TerminalAgentGithubClient.decodePullRequestStatuses(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 538,
                  "additions": 1,
                  "deletions": 0,
                  "state": "MERGED",
                  "isDraft": false,
                  "url": "https://github.com/NoopApp/noop/pull/538",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "noop",
                    "owner": { "login": "ahmedelfayoume" }
                  },
                  "commits": {"nodes": []}
                }
              ]
            }
          }
        }
      }
      """,
      aliasMap: ["branch0": "main"],
      remote: TerminalAgentGithubRemote(
        host: "github.com",
        owner: "NoopApp",
        repo: "noop"
      )
    )

    #expect(statuses["main"]?.kind == PaneAgentPullRequestStatus.Kind.none)
    #expect(statuses["main"]?.title == "Create pull request")
  }

  @Test
  func githubPullRequestDecoderUsesNumberChangesAndChecks() throws {
    let status = Self.decodeSinglePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 39,
                  "additions": 3040,
                  "deletions": 29,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/39",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {
                    "nodes": [
                      {
                        "commit": {
                          "statusCheckRollup": {
                            "state": "PENDING",
                            "contexts": {
                              "totalCount": 2,
                              "nodes": [
                                {
                                  "__typename": "CheckRun",
                                  "name": "inspect-dependencies",
                                  "status": "COMPLETED",
                                  "conclusion": "SUCCESS"
                                },
                                {
                                  "__typename": "StatusContext",
                                  "context": "test",
                                  "state": "PENDING"
                                }
                              ]
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
      """
    )

    #expect(status.kind == .open)
    #expect(status.title == "#39")
    #expect(status.addedLineCount == 3040)
    #expect(status.removedLineCount == 29)
    #expect(
      status.checks
        == PaneAgentPullRequestChecks(
          status: .pending,
          totalCount: 2,
          items: [
            PaneAgentPullRequestCheck(name: "inspect-dependencies", status: .passing),
            PaneAgentPullRequestCheck(name: "test", status: .pending),
          ]
        )
    )
    #expect(status.checks?.title == "1 pending")
    #expect(status.checks?.accessibilityTitle == "Checks, 1 pending")
  }

  @Test
  func githubPullRequestDecoderMapsPullRequestStates() {
    #expect(Self.decodePullRequestState("OPEN", isDraft: false).kind == .open)
    #expect(Self.decodePullRequestState("OPEN", isDraft: true).kind == .draft)
    #expect(Self.decodePullRequestState("MERGED", isDraft: false).kind == .merged)
    #expect(Self.decodePullRequestState("CLOSED", isDraft: true).kind == .closed)
  }

  @Test
  func githubPullRequestDecoderBuildsCheckDisplayText() throws {
    let status = Self.decodeSinglePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 40,
                  "additions": 12,
                  "deletions": 3,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/40",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {
                    "nodes": [
                      {
                        "commit": {
                          "statusCheckRollup": {
                            "state": "PENDING",
                            "contexts": {
                              "totalCount": 3,
                              "nodes": [
                                {
                                  "__typename": "CheckRun",
                                  "name": "test",
                                  "status": "IN_PROGRESS",
                                  "conclusion": null,
                                  "startedAt": "2026-05-17T14:10:22Z",
                                  "completedAt": null,
                                  "checkSuite": {
                                    "workflowRun": {
                                      "workflow": {
                                        "name": "test"
                                      }
                                    }
                                  }
                                },
                                {
                                  "__typename": "CheckRun",
                                  "name": "inspect-dependencies",
                                  "status": "COMPLETED",
                                  "conclusion": "SUCCESS",
                                  "startedAt": "2026-05-17T14:10:23Z",
                                  "completedAt": "2026-05-17T14:12:03Z",
                                  "checkSuite": {
                                    "workflowRun": {
                                      "workflow": {
                                        "name": "inspect-dependencies"
                                      }
                                    }
                                  }
                                },
                                {
                                  "__typename": "CheckRun",
                                  "name": "preview",
                                  "status": "WAITING",
                                  "conclusion": null,
                                  "startedAt": null,
                                  "completedAt": null,
                                  "checkSuite": {
                                    "workflowRun": {
                                      "workflow": {
                                        "name": "deploy"
                                      }
                                    }
                                  }
                                }
                              ]
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
      """
    )
    let items = try #require(status.checks?.items)
    let now = try isoDate("2026-05-17T14:13:22Z")

    #expect(items[0].title == "test")
    #expect(items[0].detailText(now: now) == "Started 3 minutes ago")
    #expect(items[1].title == "inspect-dependencies")
    #expect(items[1].detailText(now: now) == "Successful in 1m")
    #expect(items[2].title == "deploy / preview")
    #expect(items[2].detailText(now: now) == "Waiting for approval")
    #expect(status.checks?.title == "1 running, 1 pending")
  }

  @Test
  func githubPullRequestDecoderBuildsCheckURLs() throws {
    let status = Self.decodeSinglePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 41,
                  "additions": 12,
                  "deletions": 3,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/41",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {
                    "nodes": [
                      {
                        "commit": {
                          "statusCheckRollup": {
                            "state": "PENDING",
                            "contexts": {
                              "totalCount": 2,
                              "nodes": [
                                {
                                  "__typename": "CheckRun",
                                  "name": "build",
                                  "status": "COMPLETED",
                                  "conclusion": "SUCCESS",
                                  "detailsUrl": "https://github.com/supabitapp/supaterm/actions/runs/1/job/2",
                                  "url": "https://github.com/supabitapp/supaterm/runs/2"
                                },
                                {
                                  "__typename": "StatusContext",
                                  "context": "ci",
                                  "state": "PENDING",
                                  "targetUrl": "https://ci.example.com/supaterm/41"
                                }
                              ]
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
      """
    )
    let items = try #require(status.checks?.items)

    #expect(items[0].url?.absoluteString == "https://github.com/supabitapp/supaterm/actions/runs/1/job/2")
    #expect(items[1].url?.absoluteString == "https://ci.example.com/supaterm/41")
  }

  @Test
  func pullRequestChecksCountsKnownItemsByStatus() {
    let checks = PaneAgentPullRequestChecks(
      status: .failing,
      totalCount: 5,
      items: [
        PaneAgentPullRequestCheck(name: "lint", status: .passing),
        PaneAgentPullRequestCheck(name: "test", state: .inProgress),
        PaneAgentPullRequestCheck(name: "build", state: .inProgress),
        PaneAgentPullRequestCheck(name: "deploy", status: .failing),
        PaneAgentPullRequestCheck(name: "docs", status: .skipped),
      ]
    )

    let expectedCounts: [PaneAgentPullRequestCheck.Status: Int] = [
      .passing: 1,
      .pending: 2,
      .failing: 1,
      .skipped: 1,
    ]
    #expect(checks.itemCounts == expectedCounts)
    #expect(checks.title == "1 failed, 2 running")
    #expect(checks.accessibilityTitle == "Checks, 1 failed, 2 running")
    #expect(!checks.isEmpty)
  }

  @Test
  func pullRequestChecksDistinguishesIssuesFromFailures() {
    let checks = PaneAgentPullRequestChecks(
      status: .failing,
      totalCount: 8,
      items: [
        PaneAgentPullRequestCheck(name: "failure", state: .failure),
        PaneAgentPullRequestCheck(name: "error", state: .error),
        PaneAgentPullRequestCheck(name: "startup", state: .startupFailure),
        PaneAgentPullRequestCheck(name: "cancelled", state: .cancelled),
        PaneAgentPullRequestCheck(name: "timed-out", state: .timedOut),
        PaneAgentPullRequestCheck(name: "action", state: .actionRequired),
        PaneAgentPullRequestCheck(name: "stale", state: .stale),
        PaneAgentPullRequestCheck(name: "unavailable", state: .unavailable),
      ]
    )

    #expect(checks.title == "3 failed, 5 issues")
    #expect(
      PaneAgentPullRequestChecks(
        status: .failing,
        totalCount: 1,
        items: [PaneAgentPullRequestCheck(name: "cancelled", state: .cancelled)]
      ).title == "1 issue"
    )
  }

  @Test
  func pullRequestChecksIsEmptyWhenTotalCountIsZero() {
    let checks = PaneAgentPullRequestChecks(
      status: .passing,
      totalCount: 0,
      items: []
    )

    #expect(checks.isEmpty)
  }

  @Test
  func githubPullRequestDecoderUsesRollupStateForCheckSummary() throws {
    let status = Self.decodeSinglePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 39,
                  "additions": 3040,
                  "deletions": 29,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/39",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {
                    "nodes": [
                      {
                        "commit": {
                          "statusCheckRollup": {
                            "state": "FAILURE",
                            "contexts": {
                              "totalCount": 25,
                              "nodes": [
                                {
                                  "__typename": "CheckRun",
                                  "name": "first-page-check",
                                  "status": "COMPLETED",
                                  "conclusion": "FAILURE"
                                }
                              ]
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
      """
    )

    #expect(status.checks?.title == "Checks failing")
  }

  private static func decodeSinglePullRequestStatus(_ json: String) -> PaneAgentPullRequestStatus {
    TerminalAgentGithubClient.decodePullRequestStatuses(
      json,
      aliasMap: ["branch0": "feature"],
      remote: TerminalAgentGithubRemote(host: "github.com", owner: "supabitapp", repo: "supaterm")
    )["feature"] ?? .unavailable
  }

  private static func decodePullRequestState(
    _ state: String,
    isDraft: Bool
  ) -> PaneAgentPullRequestStatus {
    decodeSinglePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 39,
                  "additions": 10,
                  "deletions": 2,
                  "state": "\(state)",
                  "isDraft": \(isDraft),
                  "url": "https://github.com/supabitapp/supaterm/pull/39",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {"nodes": []}
                }
              ]
            }
          }
        }
      }
      """
    )
  }

  private static func decodePullRequestStatus(
    autoMergeEnabled: Bool,
    inMergeQueue: Bool
  ) -> PaneAgentPullRequestStatus {
    let autoMergeRequest = autoMergeEnabled ? #"{"__typename":"AutoMergeRequest"}"# : "null"
    let mergeQueueEntry = inMergeQueue ? #"{"__typename":"MergeQueueEntry"}"# : "null"
    return decodeSinglePullRequestStatus(
      """
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 39,
                  "additions": 10,
                  "deletions": 2,
                  "state": "OPEN",
                  "isDraft": false,
                  "url": "https://github.com/supabitapp/supaterm/pull/39",
                  "baseRefName": "main",
                  "autoMergeRequest": \(autoMergeRequest),
                  "mergeQueueEntry": \(mergeQueueEntry),
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  },
                  "commits": {"nodes": []}
                }
              ]
            }
          }
        }
      }
      """
    )
  }

}

private func isoDate(_ value: String) throws -> Date {
  try #require(ISO8601DateFormatter().date(from: value))
}
