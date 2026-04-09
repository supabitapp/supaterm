import Foundation
import Testing

@testable import supaterm

struct GithubPullRequestParsingTests {
  @Test
  func parserPrefersOwnerRepoMatchAndOpenState() throws {
    let response = try decodeResponse(
      #"""
      {
        "data": {
          "repository": {
            "branch0": {
              "nodes": [
                {
                  "number": 30,
                  "title": "Fork PR",
                  "state": "OPEN",
                  "isDraft": false,
                  "reviewDecision": "APPROVED",
                  "mergeable": "MERGEABLE",
                  "mergeStateStatus": "CLEAN",
                  "updatedAt": "2026-04-09T08:00:00Z",
                  "url": "https://github.com/supabitapp/supaterm/pull/30",
                  "headRefName": "feature",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "forker" }
                  }
                },
                {
                  "number": 31,
                  "title": "Upstream PR",
                  "state": "OPEN",
                  "isDraft": false,
                  "reviewDecision": "REVIEW_REQUIRED",
                  "mergeable": "CONFLICTING",
                  "mergeStateStatus": "DIRTY",
                  "updatedAt": "2026-04-09T07:00:00Z",
                  "url": "https://github.com/supabitapp/supaterm/pull/31",
                  "headRefName": "feature",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm",
                    "owner": { "login": "supabitapp" }
                  }
                }
              ]
            },
            "branch1": {
              "nodes": [
                {
                  "number": 40,
                  "title": "Merged fallback",
                  "state": "MERGED",
                  "isDraft": false,
                  "reviewDecision": null,
                  "mergeable": null,
                  "mergeStateStatus": null,
                  "updatedAt": "2026-04-09T06:00:00Z",
                  "url": "https://github.com/supabitapp/supaterm/pull/40",
                  "headRefName": "fork-branch",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm-fork",
                    "owner": { "login": "forker" }
                  }
                },
                {
                  "number": 41,
                  "title": "Open fallback",
                  "state": "OPEN",
                  "isDraft": false,
                  "reviewDecision": null,
                  "mergeable": null,
                  "mergeStateStatus": null,
                  "updatedAt": "2026-04-09T05:00:00Z",
                  "url": "https://github.com/supabitapp/supaterm/pull/41",
                  "headRefName": "fork-branch",
                  "baseRefName": "main",
                  "headRepository": {
                    "name": "supaterm-fork",
                    "owner": { "login": "forker" }
                  }
                }
              ]
            }
          }
        }
      }
      """#
    )

    let result = response.pullRequestsByBranch(
      aliasMap: ["branch0": "feature", "branch1": "fork-branch"],
      owner: "supabitapp",
      repo: "supaterm"
    )

    #expect(result["feature"]?.number == 31)
    #expect(result["fork-branch"]?.number == 41)
  }

  private func decodeResponse(_ json: String) throws -> GithubGraphQLPullRequestResponse {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try decoder.decode(GithubGraphQLPullRequestResponse.self, from: Data(json.utf8))
  }
}
