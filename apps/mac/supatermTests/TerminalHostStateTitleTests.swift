import AppKit
import Testing

@testable import supaterm

struct TerminalHostStateTitleTests {
  @Test
  func resolvedPaneDisplayTitlePrefersExplicitTitle() {
    let title = TerminalHostState.resolvedPaneDisplayTitle(
      title: "  zsh  ",
      pwd: "/tmp/project",
      defaultValue: "Pane 1"
    )

    #expect(title == "zsh")
  }

  @Test
  func resolvedPaneDisplayTitleFallsBackToWorkingDirectory() {
    let title = TerminalHostState.resolvedPaneDisplayTitle(
      title: "   ",
      pwd: "  /tmp/project  ",
      defaultValue: "Pane 1"
    )

    #expect(title == "/tmp/project")
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
      title: \.paneTitle,
      pwd: \.workingDirectory
    )

    #expect(title == "Pane 2")
  }

  @Test
  func selectedPaneDisplayTitleUsesFocusedPaneWhenAvailable() throws {
    let first = PaneTitleTestView(paneTitle: "shell")
    let second = PaneTitleTestView(paneTitle: "logs")
    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)

    let title = TerminalHostState.selectedPaneDisplayTitle(
      focusedSurfaceID: second.id,
      in: tree,
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
  let paneTitle: String?
  let workingDirectory: String?

  init(
    paneTitle: String? = nil,
    workingDirectory: String? = nil
  ) {
    self.paneTitle = paneTitle
    self.workingDirectory = workingDirectory
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }
}
