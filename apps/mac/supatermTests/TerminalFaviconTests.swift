import AppKit
import Foundation
import Testing

@testable import supaterm

struct TerminalFaviconTests {
  @Test
  func knownCommandTakesPriorityOverProject() {
    #expect(
      resolveFavicon(
        TerminalFaviconContext(foregroundCommand: "codex", projectKind: .swift)
      ) == .command(.codex)
    )
  }

  @Test
  func projectTakesPriorityOverShellForUnknownCommand() {
    #expect(
      resolveFavicon(
        TerminalFaviconContext(foregroundCommand: "zsh", projectKind: .rust)
      ) == .project(.rust)
    )
    #expect(
      resolveFavicon(
        TerminalFaviconContext(foregroundCommand: "zsh", projectKind: nil)
      ) == .shell
    )
  }

  @Test
  func commandTableMapsAgentsAndCommonTools() {
    #expect(TerminalFaviconResolver.commandGlyphs.count == 30)
    #expect(TerminalFaviconResolver.commandGlyph(for: "/usr/local/bin/claude") == .claude)
    #expect(TerminalFaviconResolver.commandGlyph(for: "codex") == .codex)
    #expect(TerminalFaviconResolver.commandGlyph(for: "pi") == .pi)
    #expect(TerminalFaviconResolver.commandGlyph(for: "git") == .sourceControl)
    #expect(TerminalFaviconResolver.commandGlyph(for: "python3") == .code)
    #expect(TerminalFaviconResolver.commandGlyph(for: "unknown") == nil)
  }

  @Test
  func projectRuleRequiresAPositiveAndRejectsNegation() {
    let rule = ProjectKindRule(
      kind: .node,
      files: ["package.json", "!bunfig.toml"],
      extensions: ["ts"],
      folders: ["node_modules"]
    )

    #expect(rule.matches(DirectoryFingerprint(fileNames: ["package.json"])))
    #expect(rule.matches(DirectoryFingerprint(extensions: ["ts"])))
    #expect(rule.matches(DirectoryFingerprint(folderNames: ["node_modules"])))
    #expect(!rule.matches(DirectoryFingerprint()))
    #expect(
      !rule.matches(
        DirectoryFingerprint(fileNames: ["package.json", "bunfig.toml"])
      )
    )
  }

  @Test
  func projectRulesCoverTheSettledKinds() throws {
    let fingerprints: [ProjectKind: DirectoryFingerprint] = [
      .swift: DirectoryFingerprint(fileNames: ["Package.swift"]),
      .node: DirectoryFingerprint(fileNames: ["package.json"]),
      .rust: DirectoryFingerprint(fileNames: ["Cargo.toml"]),
      .go: DirectoryFingerprint(fileNames: ["go.mod"]),
      .python: DirectoryFingerprint(fileNames: ["pyproject.toml"]),
      .ruby: DirectoryFingerprint(fileNames: ["Gemfile"]),
      .zig: DirectoryFingerprint(fileNames: ["build.zig"]),
    ]

    for kind in ProjectKind.allCases {
      let fingerprint = try #require(fingerprints[kind])
      #expect(ProjectKindDetector.rules.first(where: { $0.matches(fingerprint) })?.kind == kind)
    }
  }

  @Test
  func nearestDirectoryMatchWinsAndWalkStopsAtRepositoryRoot() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory.appending(
      path: UUID().uuidString,
      directoryHint: .isDirectory
    )
    let outsidePackage = temporaryDirectory.appending(path: "Package.swift")
    let repository = temporaryDirectory.appending(path: "repo", directoryHint: .isDirectory)
    let local = repository.appending(path: "apps/web", directoryHint: .isDirectory)
    let child = local.appending(path: "src", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    try FileManager.default.createDirectory(
      at: repository.appending(path: ".git", directoryHint: .isDirectory),
      withIntermediateDirectories: true
    )
    try FileManager.default.createDirectory(at: child, withIntermediateDirectories: true)
    try Data().write(to: outsidePackage)
    try Data().write(to: repository.appending(path: "Cargo.toml"))
    try Data().write(to: local.appending(path: "package.json"))

    #expect(
      ProjectKindDetector.detect(workingDirectoryPath: child.path(percentEncoded: false)) == .node
    )
    try FileManager.default.removeItem(at: local.appending(path: "package.json"))
    try FileManager.default.removeItem(at: repository.appending(path: "Cargo.toml"))
    #expect(
      ProjectKindDetector.detect(workingDirectoryPath: child.path(percentEncoded: false)) == nil
    )
  }

  @Test
  func activePaneOwnsTheTabFavicon() throws {
    let first = FaviconTestView(favicon: .project(.swift))
    let second = FaviconTestView(favicon: .command(.codex))
    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)

    #expect(
      TerminalHostState.resolvedTabFavicon(
        focusedSurfaceID: second.id,
        in: tree,
        favicon: \.favicon
      ) == .command(.codex)
    )
    #expect(
      TerminalHostState.resolvedTabFavicon(
        focusedSurfaceID: nil,
        in: tree,
        favicon: \.favicon
      ) == .project(.swift)
    )
  }

  @Test
  func updateSequenceRejectsStaleAsyncResults() {
    var sequence = TerminalFaviconUpdateSequence()
    let stale = sequence.begin()
    let current = sequence.begin()

    #expect(!sequence.accepts(stale))
    #expect(sequence.accepts(current))
  }

  @Test
  func faviconChangesInvalidateSidebarMeasurement() {
    #expect(TerminalFavicon.shell.measurementKey != TerminalFavicon.project(.swift).measurementKey)
    #expect(
      TerminalFavicon.project(.swift).measurementKey
        != TerminalFavicon.command(.code).measurementKey
    )
  }
}

private final class FaviconTestView: NSView, Identifiable {
  let id = UUID()
  let favicon: TerminalFavicon

  init(favicon: TerminalFavicon) {
    self.favicon = favicon
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }
}
