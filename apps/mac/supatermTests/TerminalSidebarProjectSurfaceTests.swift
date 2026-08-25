import Observation
import SupaTheme
import SwiftUI
import Synchronization
import Testing

@testable import supaterm

struct TerminalSidebarProjectSurfaceTests {
  @Test
  func projectNewTabAccessoryRevealsItsShortcutOnOptionHold() {
    let shortcut = "⌘⌥T"

    #expect(
      TerminalSidebarProjectNewTabAccessory.resolve(
        isHovered: false,
        showsShortcutHint: true,
        shortcutHint: shortcut
      ) == .hidden
    )
    #expect(
      TerminalSidebarProjectNewTabAccessory.resolve(
        isHovered: true,
        showsShortcutHint: false,
        shortcutHint: shortcut
      ) == .icon
    )
    #expect(
      TerminalSidebarProjectNewTabAccessory.resolve(
        isHovered: true,
        showsShortcutHint: true,
        shortcutHint: shortcut
      ) == .shortcut(shortcut)
    )
    #expect(
      TerminalSidebarProjectNewTabAccessory.resolve(
        isHovered: true,
        showsShortcutHint: true,
        shortcutHint: nil
      ) == .icon
    )
  }

  @Test @MainActor
  func hoverStateTracksWholeProjectTransitions() {
    let first = TerminalProjectID()
    let second = TerminalProjectID()
    let state = TerminalSidebarProjectHoverState()

    state.set(first)
    #expect(state.projectID == first)
    state.set(first)
    state.set(second)
    #expect(state.projectID == second)
    state.set(nil)

    #expect(state.projectID == nil)
  }

  @Test @MainActor
  func removalResetAndReuseLeaveNoStaleHover() {
    let first = TerminalProjectID()
    let second = TerminalProjectID()
    let state = TerminalSidebarProjectHoverState()

    state.set(first)
    state.retain([second])
    #expect(state.projectID == nil)
    state.set(second)
    state.set(nil)
    #expect(state.projectID == nil)
    state.set(first)
    #expect(state.projectID == first)
  }

  @Test
  func dropTargetTakesPriorityOverHover() {
    #expect(
      TerminalSidebarProjectSurfaceState.resolve(isHovered: false, isDropTarget: false) == .resting
    )
    #expect(
      TerminalSidebarProjectSurfaceState.resolve(isHovered: true, isDropTarget: false) == .hovered
    )
    #expect(
      TerminalSidebarProjectSurfaceState.resolve(isHovered: true, isDropTarget: true) == .dropTarget
    )
  }

  @Test
  func neutralProjectIsFlatUntilInteraction() {
    let resting = TerminalSidebarProjectSurfaceStyle.resolve(color: .neutral, state: .resting)
    let hovered = TerminalSidebarProjectSurfaceStyle.resolve(color: .neutral, state: .hovered)
    let dropTarget = TerminalSidebarProjectSurfaceStyle.resolve(color: .neutral, state: .dropTarget)

    #expect(resting == TerminalSidebarProjectSurfaceStyle(fill: .clear, showsStroke: false))
    #expect(hovered == TerminalSidebarProjectSurfaceStyle(fill: .neutral, showsStroke: true))
    #expect(dropTarget == hovered)
  }

  @Test
  func coloredProjectsStrengthenOnInteraction() {
    for color in ThemeTint.allCases where color != .neutral {
      let resting = TerminalSidebarProjectSurfaceStyle.resolve(color: color, state: .resting)
      let hovered = TerminalSidebarProjectSurfaceStyle.resolve(color: color, state: .hovered)
      let dropTarget = TerminalSidebarProjectSurfaceStyle.resolve(color: color, state: .dropTarget)

      #expect(
        resting
          == TerminalSidebarProjectSurfaceStyle(fill: .project(opacity: 0.15), showsStroke: true)
      )
      #expect(
        hovered
          == TerminalSidebarProjectSurfaceStyle(fill: .project(opacity: 0.25), showsStroke: true)
      )
      #expect(dropTarget == hovered)
    }
  }

  @Test
  func neutralSurfaceTokensMatchEachScheme() {
    let light = Palette(colorScheme: .light)
    let dark = Palette(colorScheme: .dark)

    #expect(
      light.sidebarProjectNeutralHoverFillValue
        == ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.05)
    )
    #expect(
      dark.sidebarProjectNeutralHoverFillValue
        == ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.10)
    )
    #expect(light.sidebarProjectStrokeValue == ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.10))
    #expect(dark.sidebarProjectStrokeValue == ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.10))
  }

  @Test
  func everyProjectColorKeepsItsBaseTintAcrossSchemes() {
    for scheme in [ColorScheme.light, .dark] {
      let palette = Palette(colorScheme: scheme)
      for color in ThemeTint.allCases {
        let resolved = color.sidebarNSColor(palette: palette)
        #expect(resolved.alphaComponent == 1)
      }
    }
  }

  @Test
  func accessibilityIDsAreStableAtBothViewLayers() {
    let tabID = TerminalTabID()
    let projectID = TerminalProjectID()
    let tab = tabID.rawValue.uuidString.lowercased()
    let project = projectID.rawValue.uuidString.lowercased()

    #expect(
      TerminalSidebarAccessibilityIdentifier.tab(tabID, projectID: nil) == "sidebar.tab-row.\(tab)"
    )
    #expect(
      TerminalSidebarAccessibilityIdentifier.tab(tabID, projectID: projectID)
        == "sidebar.project.\(project).tab.\(tab)"
    )
    #expect(
      TerminalSidebarAccessibilityIdentifier.project(projectID) == "sidebar.project-header.\(project)"
    )
  }

  @Test @MainActor
  func tabSelectionSpansRootsAndProjectsInVisibleOrder() {
    let primary = TerminalTabID()
    let firstChild = TerminalTabID()
    let secondChild = TerminalTabID()
    let trailing = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .blue, [firstChild, secondChild]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .unassigned([primary, trailing]),
          isPinned: false
        ),
      ],
      revision: 1
    )
    let selection = TerminalSidebarTabSelectionState()

    selection.selectRange(
      to: firstChild,
      primaryTabID: primary,
      outline: outline,
      additive: false
    )
    selection.toggle(trailing, primaryTabID: primary)

    #expect(
      selection.orderedTabIDs(primaryTabID: primary, outline: outline)
        == [firstChild, secondChild, primary, trailing]
    )
    #expect(selection.style(for: primary, primaryTabID: primary) == .primary)
    #expect(selection.style(for: firstChild, primaryTabID: primary) == .secondary)
  }

  @Test @MainActor
  func tabSelectionClearsHiddenRowsAndScopesUnselectedContextMenus() {
    let primary = TerminalTabID()
    let child = TerminalTabID()
    let unselected = TerminalTabID()
    let projectID = TerminalProjectID()
    let expanded = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .green, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .unassigned([primary, unselected]),
          isPinned: false
        ),
      ],
      revision: 1
    )
    let collapsed = TerminalSidebarTestFixture.outline(
      roots: expanded.roots,
      revision: 2,
      collapsedProjectIDs: [projectID]
    )
    let selection = TerminalSidebarTabSelectionState()

    selection.toggle(child, primaryTabID: primary)
    #expect(
      selection.contextualTabIDs(
        for: unselected,
        primaryTabID: primary,
        outline: expanded
      ) == [unselected]
    )
    selection.retainVisible(in: collapsed, primaryTabID: primary)

    #expect(selection.secondaryTabIDs.isEmpty)
  }

  @Test @MainActor
  func retainingUnchangedVisibleSelectionDoesNotInvalidateObservation() async {
    let primary = TerminalTabID()
    let secondary = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .unassigned([primary, secondary]),
          isPinned: false
        )
      ],
      revision: 1
    )
    let selection = TerminalSidebarTabSelectionState()
    selection.toggle(secondary, primaryTabID: primary)
    let invalidationCount = Mutex(0)

    withObservationTracking {
      _ = selection.secondaryTabIDs
    } onChange: {
      invalidationCount.withLock { $0 += 1 }
    }

    selection.retainVisible(in: outline, primaryTabID: primary)
    for _ in 0..<5 { await Task.yield() }

    #expect(invalidationCount.withLock { $0 } == 0)
  }
}
