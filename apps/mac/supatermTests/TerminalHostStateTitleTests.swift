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
  func sidebarTabTitleUsesRuntimeTitleWhenItDoesNotDescribeWorkingDirectory() {
    let title = TerminalHostState.sidebarTabTitle(
      runtimeTitle: "nvim",
      workingDirectory: "/tmp/project",
      fallbackTitle: "Terminal"
    )

    #expect(title == "nvim")
  }

  @Test
  func sidebarTabTitleFallsBackWhenRuntimeTitleMatchesAbbreviatedWorkingDirectory() {
    let title = TerminalHostState.sidebarTabTitle(
      runtimeTitle: "~/code/github.com/supabitapp/supaterm",
      workingDirectory: "/Users/Developer/code/github.com/supabitapp/supaterm",
      fallbackTitle: "Terminal"
    )

    #expect(title == "Terminal")
  }

  @Test
  func sidebarTabTitleFallsBackWhenRuntimeTitleMatchesEllipsizedWorkingDirectory() {
    let title = TerminalHostState.sidebarTabTitle(
      runtimeTitle: "\u{2026}/Terminal/Views/Sidebar",
      workingDirectory: "/Users/Developer/code/github.com/supabitapp/supaterm/Features/Terminal/Views/Sidebar",
      fallbackTitle: "Terminal 2"
    )

    #expect(title == "Terminal 2")
  }

  @Test
  func sidebarWorkingDirectoryTextAbbreviatesHomeDirectory() {
    let text = TerminalHostState.sidebarWorkingDirectoryText(
      "/Users/Developer/code/github.com/supabitapp/supaterm"
    )

    #expect(text == "~/code/github.com/supabitapp/supaterm")
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
