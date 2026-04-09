import Testing

@testable import supaterm

struct GithubPullRequestCheckBreakdownTests {
  @Test
  func summaryIncludesEachVisibleBucket() {
    let breakdown = GithubPullRequestCheckBreakdown(
      checks: [
        .init(name: "build", conclusion: "SUCCESS"),
        .init(name: "tests", conclusion: "FAILURE"),
        .init(name: "lint", status: "IN_PROGRESS"),
        .init(name: "deploy", state: "EXPECTED"),
        .init(name: "optional", conclusion: "SKIPPED"),
      ]
    )

    #expect(breakdown.summaryText == "1 failed, 1 pending, 1 expected, 1 skipped, 1 passed")
  }
}
