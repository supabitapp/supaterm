import Foundation
import Testing

@testable import supaterm

struct TerminalTabGroupTitleSuggesterTests {
  @Test
  func lockedSingleTabTitleBeatsRepositoryName() {
    let title = TerminalTabGroupTitleSuggester.title(
      for: [input("Release checks", isTitleLocked: true)],
      sharedRepositoryName: "supaterm",
      existingTitles: []
    )

    #expect(title == "Release checks")
  }

  @Test
  func sharedLockedTitleStemBeatsRepositoryName() {
    let title = TerminalTabGroupTitleSuggester.title(
      for: [
        input("Release Web", isTitleLocked: true),
        input("Release API", isTitleLocked: true),
      ],
      sharedRepositoryName: "supaterm",
      existingTitles: []
    )

    #expect(title == "Release")
  }

  @Test
  func sharedRepositoryNamesUnrelatedLiveTitles() {
    let title = TerminalTabGroupTitleSuggester.title(
      for: [
        input("Socket routing"),
        input("Release notes"),
      ],
      sharedRepositoryName: "supaterm",
      existingTitles: []
    )

    #expect(title == "supaterm")
  }

  @Test
  func sharedDisplayTitleStemNamesTabsWithoutRepository() {
    let title = TerminalTabGroupTitleSuggester.title(
      for: [
        input("supaterm/mac"),
        input("supaterm/web"),
        input("supaterm/api"),
      ],
      sharedRepositoryName: nil,
      existingTitles: []
    )

    #expect(title == "supaterm")
  }

  @Test
  func unrelatedTabsUseFirstTitleAndRemainingCount() {
    let title = TerminalTabGroupTitleSuggester.title(
      for: [
        input("Socket routing"),
        input("Release notes"),
        input("Smoke test"),
      ],
      sharedRepositoryName: nil,
      existingTitles: []
    )

    #expect(title == "Socket routing + 2")
  }

  @Test
  func generatedTitlesAvoidCaseInsensitiveDuplicates() {
    let title = TerminalTabGroupTitleSuggester.title(
      for: [
        input("supaterm/mac"),
        input("supaterm/web"),
      ],
      sharedRepositoryName: nil,
      existingTitles: ["Supaterm", "supaterm 2"]
    )

    #expect(title == "supaterm 3")
  }

  @Test
  func generatedTitlesStayWithinMaximumLengthWhenAddingSuffix() {
    let longTitle = String(repeating: "a", count: 60)
    let first = TerminalTabGroupTitleSuggester.title(
      for: [input(longTitle, isTitleLocked: true)],
      sharedRepositoryName: nil,
      existingTitles: []
    )
    let second = TerminalTabGroupTitleSuggester.title(
      for: [input(longTitle, isTitleLocked: true)],
      sharedRepositoryName: nil,
      existingTitles: [first]
    )

    #expect(first.count == TerminalTabGroupTitleSuggester.maximumLength)
    #expect(second.count == TerminalTabGroupTitleSuggester.maximumLength)
    #expect(second.hasSuffix(" 2"))
  }

  @Test
  func sharedRepositoryRequiresEveryTabPathToResolveToOneRoot() {
    let roots = [
      "/work/supaterm/apps/mac": "/work/supaterm",
      "/work/supaterm/docs": "/work/supaterm",
      "/work/other": "/work/other",
    ]

    let shared = TerminalTabGroupTitleSuggester.sharedRepositoryName(
      workingDirectoryPathsByTab: [
        ["/work/supaterm/apps/mac"],
        ["/work/supaterm/docs"],
      ],
      repositoryRoot: { roots[$0] }
    )
    let mixed = TerminalTabGroupTitleSuggester.sharedRepositoryName(
      workingDirectoryPathsByTab: [
        ["/work/supaterm/apps/mac"],
        ["/work/other"],
      ],
      repositoryRoot: { roots[$0] }
    )
    let unresolved = TerminalTabGroupTitleSuggester.sharedRepositoryName(
      workingDirectoryPathsByTab: [
        ["/work/supaterm/apps/mac"],
        ["/work/missing"],
      ],
      repositoryRoot: { roots[$0] }
    )

    #expect(shared == "supaterm")
    #expect(mixed == nil)
    #expect(unresolved == nil)
  }

  @Test
  func sharedRepositoryFindsNearestGitRoot() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory.appending(
      path: UUID().uuidString,
      directoryHint: .isDirectory
    )
    let repository = temporaryDirectory.appending(path: "supaterm", directoryHint: .isDirectory)
    let mac = repository.appending(path: "apps/mac", directoryHint: .isDirectory)
    let docs = repository.appending(path: "docs", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    try FileManager.default.createDirectory(
      at: repository.appending(path: ".git", directoryHint: .isDirectory),
      withIntermediateDirectories: true
    )
    try FileManager.default.createDirectory(at: mac, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)

    let title = TerminalTabGroupTitleSuggester.sharedRepositoryName(
      workingDirectoryPathsByTab: [
        [mac.path(percentEncoded: false)],
        [docs.path(percentEncoded: false)],
      ]
    )

    #expect(title == "supaterm")
  }

  @MainActor
  @Test
  func hostBuildsSuggestionFromCanonicalTabs() throws {
    let terminal = TerminalHostState(managesTerminalSurfaces: false)
    let manager = terminal.spaceManager.tabCollection
    let first = manager.createTab(title: "Release Web", isTitleLocked: true)
    let second = manager.createTab(title: "Release API", isTitleLocked: true)

    let title = terminal.suggestedGroupTitle(containing: [first, second])

    #expect(title == "Release")
  }

  private func input(
    _ title: String,
    isTitleLocked: Bool = false
  ) -> TerminalTabGroupTitleInput {
    TerminalTabGroupTitleInput(title: title, isTitleLocked: isTitleLocked)
  }
}
