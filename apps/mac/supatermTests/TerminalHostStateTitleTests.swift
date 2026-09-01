import AppKit
import Testing

@testable import supaterm

struct TerminalHostStateTitleTests {
  @Test
  func resolvedPaneDisplayTitlePrefersManualOverride() {
    let title = TerminalHostState.resolvedPaneDisplayTitle(
      titleOverride: "Pinned",
      title: "  zsh  ",
      pwd: "/tmp/project",
      defaultValue: "Pane 1"
    )

    #expect(title == "Pinned")
  }

  @Test
  func resolvedPaneDisplayTitlePreservesLiteralWhitespaceOverride() {
    let title = TerminalHostState.resolvedPaneDisplayTitle(
      titleOverride: "  ",
      title: "shell",
      pwd: "/tmp/project",
      defaultValue: "Pane 1"
    )

    #expect(title == "  ")
  }

  @Test
  func resolvedPaneDisplayTitleFallsBackToWorkingDirectory() {
    let title = TerminalHostState.resolvedPaneDisplayTitle(
      titleOverride: nil,
      title: "",
      pwd: "  /tmp/project  ",
      defaultValue: "Pane 1"
    )

    #expect(title == "/tmp/project")
  }

  @Test
  func resolvedPaneDisplayTitleStripsAnimatedActivityIndicator() {
    let title = TerminalHostState.resolvedPaneDisplayTitle(
      titleOverride: nil,
      title: "⠋ Working",
      pwd: "/tmp/project",
      defaultValue: "Pane 1"
    )

    #expect(title == "Working")
  }

  @Test
  func resolvedPaneDisplayTitlePreservesManualActivityIndicator() {
    let title = TerminalHostState.resolvedPaneDisplayTitle(
      titleOverride: "⠋ Pinned",
      title: "⠙ Working",
      pwd: "/tmp/project",
      defaultValue: "Pane 1"
    )

    #expect(title == "⠋ Pinned")
  }

  @Test
  func resolvedTabDisplayTitleStripsLeadingWorkingDirectoryPrefix() {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let pwd = "\(home)/code/github.com/supabitapp/supaterm"

    let title = TerminalHostState.resolvedTabDisplayTitle(
      titleOverride: nil,
      title: "~/code/github.com/supabitapp/supaterm - fish",
      pwd: pwd,
      defaultValue: "Terminal"
    )

    #expect(title == "fish")
  }

  @Test
  func resolvedTabDisplayTitleKeepsWorkingDirectoryWhenTitleIsOnlyPath() {
    let title = TerminalHostState.resolvedTabDisplayTitle(
      titleOverride: nil,
      title: "/tmp/project",
      pwd: "/tmp/project",
      defaultValue: "Terminal"
    )

    #expect(title == "/tmp/project")
  }

  @Test
  func resolvedTabDisplayTitlePreservesManualOverride() {
    let title = TerminalHostState.resolvedTabDisplayTitle(
      titleOverride: "Pinned",
      title: "/tmp/project - fish",
      pwd: "/tmp/project",
      defaultValue: "Terminal"
    )

    #expect(title == "Pinned")
  }

  @Test
  func resolvedTabDisplayTitleStripsExactDuplicatedCommandSuffix() {
    let title = TerminalHostState.resolvedTabDisplayTitle(
      titleOverride: nil,
      title: "codex - codex",
      pwd: nil,
      defaultValue: "Terminal"
    )

    #expect(title == "codex")
  }

  @Test
  func resolvedTabDisplayTitleStripsDuplicatedCommandSuffixAfterArguments() {
    let title = TerminalHostState.resolvedTabDisplayTitle(
      titleOverride: nil,
      title: "ping 1.1.1.1 - ping",
      pwd: nil,
      defaultValue: "Terminal"
    )

    #expect(title == "ping 1.1.1.1")
  }

  @Test
  func resolvedTabDisplayTitleKeepsDistinctTrailingCommandSuffix() {
    let title = TerminalHostState.resolvedTabDisplayTitle(
      titleOverride: nil,
      title: "codex - bash",
      pwd: nil,
      defaultValue: "Terminal"
    )

    #expect(title == "codex - bash")
  }

  @Test
  func resolvedSidebarPaneTitleDoesNotFallBackToWorkingDirectory() {
    let title = TerminalHostState.resolvedSidebarPaneTitle(
      titleOverride: nil,
      title: nil,
      pwd: "/tmp/project",
      defaultValue: "Pane 2"
    )

    #expect(title == "Pane 2")
  }

  @Test
  func resolvedSidebarPaneTitleFallsBackFromBlankOverride() {
    let title = TerminalHostState.resolvedSidebarPaneTitle(
      titleOverride: "  ",
      title: nil,
      pwd: nil,
      defaultValue: "Pane 1"
    )

    #expect(title == "Pane 1")
  }

  @Test
  func resolvedSidebarPaneTitleNormalizesTerminalTitle() {
    let title = TerminalHostState.resolvedSidebarPaneTitle(
      titleOverride: nil,
      title: "/tmp/project - codex - codex",
      pwd: "/tmp/project",
      defaultValue: "Pane 1"
    )

    #expect(title == "codex")
  }

  @Test
  func selectedPaneDisplayTitleFallsBackToFocusedPaneOrdinal() throws {
    let first = PaneTitleTestView()
    let second = PaneTitleTestView()
    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)

    let title = TerminalHostState.selectedPaneDisplayTitle(
      focusedSurfaceID: second.id,
      in: tree,
      titleOverride: \.titleOverride,
      title: \.paneTitle,
      pwd: \.workingDirectory
    )

    #expect(title == "Pane 2")
  }

  @Test
  func selectedPaneDisplayTitleUsesFocusedPaneWhenAvailable() throws {
    let first = PaneTitleTestView(paneTitle: "shell")
    let second = PaneTitleTestView(titleOverride: "logs", paneTitle: "shell")
    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)

    let title = TerminalHostState.selectedPaneDisplayTitle(
      focusedSurfaceID: second.id,
      in: tree,
      titleOverride: \.titleOverride,
      title: \.paneTitle,
      pwd: \.workingDirectory
    )

    #expect(title == "logs")
  }

  @Test
  func selectedPaneDisplayTitleFallsBackToLeftmostPaneWhenFocusIsUnset() throws {
    let first = PaneTitleTestView(paneTitle: "shell")
    let second = PaneTitleTestView(paneTitle: "logs")
    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)

    let title = TerminalHostState.selectedPaneDisplayTitle(
      focusedSurfaceID: nil,
      in: tree,
      titleOverride: \.titleOverride,
      title: \.paneTitle,
      pwd: \.workingDirectory
    )

    #expect(title == "shell")
  }

}

private final class PaneTitleTestView: NSView, Identifiable {
  let id = UUID()
  let titleOverride: String?
  let paneTitle: String?
  let workingDirectory: String?

  init(
    titleOverride: String? = nil,
    paneTitle: String? = nil,
    workingDirectory: String? = nil
  ) {
    self.titleOverride = titleOverride
    self.paneTitle = paneTitle
    self.workingDirectory = workingDirectory
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }
}
