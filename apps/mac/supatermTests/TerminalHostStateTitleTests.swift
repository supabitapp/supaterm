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

  @Test
  func paneWorkingDirectoriesDedupeNormalizedPathsInPaneOrder() throws {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let first = PaneTitleTestView(workingDirectory: "\(home)/Downloads/")
    let second = PaneTitleTestView(workingDirectory: "\(home)/Downloads")
    let third = PaneTitleTestView(workingDirectory: "\(home)/Downloads/abc/")
    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)
      .inserting(view: third, at: second, direction: .down)

    let directories = TerminalHostState.paneWorkingDirectories(
      in: tree,
      pwd: \.workingDirectory
    )

    #expect(directories == ["~/Downloads", "~/Downloads/abc"])
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
