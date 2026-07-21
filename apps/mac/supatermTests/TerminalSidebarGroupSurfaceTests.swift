import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

struct TerminalSidebarGroupSurfaceTests {
  @Test @MainActor
  func hoverStateTracksWholeGroupTransitions() {
    let first = TerminalTabGroupID()
    let second = TerminalTabGroupID()
    let state = TerminalSidebarGroupHoverState()

    state.set(first)
    #expect(state.groupID == first)
    state.set(first)
    state.set(second)
    #expect(state.groupID == second)
    state.set(nil)

    #expect(state.groupID == nil)
  }

  @Test @MainActor
  func removalResetAndReuseLeaveNoStaleHover() {
    let first = TerminalTabGroupID()
    let second = TerminalTabGroupID()
    let state = TerminalSidebarGroupHoverState()

    state.set(first)
    state.retain([second])
    #expect(state.groupID == nil)
    state.set(second)
    state.set(nil)
    #expect(state.groupID == nil)
    state.set(first)
    #expect(state.groupID == first)
  }

  @Test
  func dropTargetTakesPriorityOverHover() {
    #expect(
      TerminalSidebarGroupSurfaceState.resolve(isHovered: false, isDropTarget: false) == .resting
    )
    #expect(
      TerminalSidebarGroupSurfaceState.resolve(isHovered: true, isDropTarget: false) == .hovered
    )
    #expect(
      TerminalSidebarGroupSurfaceState.resolve(isHovered: true, isDropTarget: true) == .dropTarget
    )
  }

  @Test
  func neutralGroupIsFlatUntilInteraction() {
    let resting = TerminalSidebarGroupSurfaceStyle.resolve(color: .neutral, state: .resting)
    let hovered = TerminalSidebarGroupSurfaceStyle.resolve(color: .neutral, state: .hovered)
    let dropTarget = TerminalSidebarGroupSurfaceStyle.resolve(color: .neutral, state: .dropTarget)

    #expect(resting == TerminalSidebarGroupSurfaceStyle(fill: .clear, showsStroke: false))
    #expect(hovered == TerminalSidebarGroupSurfaceStyle(fill: .neutral, showsStroke: true))
    #expect(dropTarget == hovered)
  }

  @Test
  func coloredGroupsStrengthenOnInteraction() {
    for color in TerminalTabGroupColor.allCases where color != .neutral {
      let resting = TerminalSidebarGroupSurfaceStyle.resolve(color: color, state: .resting)
      let hovered = TerminalSidebarGroupSurfaceStyle.resolve(color: color, state: .hovered)
      let dropTarget = TerminalSidebarGroupSurfaceStyle.resolve(color: color, state: .dropTarget)

      #expect(
        resting
          == TerminalSidebarGroupSurfaceStyle(fill: .group(opacity: 0.15), showsStroke: true)
      )
      #expect(
        hovered
          == TerminalSidebarGroupSurfaceStyle(fill: .group(opacity: 0.25), showsStroke: true)
      )
      #expect(dropTarget == hovered)
    }
  }

  @Test
  func neutralSurfaceTokensMatchEachScheme() {
    let light = Palette(colorScheme: .light)
    let dark = Palette(colorScheme: .dark)

    #expect(
      light.sidebarGroupNeutralHoverFillValue
        == ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.05)
    )
    #expect(
      dark.sidebarGroupNeutralHoverFillValue
        == ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.10)
    )
    #expect(light.sidebarGroupStrokeValue == ThemeColor(red: 0, green: 0, blue: 0, alpha: 0.10))
    #expect(dark.sidebarGroupStrokeValue == ThemeColor(red: 1, green: 1, blue: 1, alpha: 0.10))
  }

  @Test
  func everyGroupColorKeepsItsBaseTintAcrossSchemes() {
    for scheme in [ColorScheme.light, .dark] {
      let palette = Palette(colorScheme: scheme)
      for color in TerminalTabGroupColor.allCases {
        let resolved = color.sidebarNSColor(palette: palette)
        #expect(resolved.alphaComponent == 1)
      }
    }
  }

  @Test
  func accessibilityIDsAreStableAtBothViewLayers() {
    let tabID = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let tab = tabID.rawValue.uuidString.lowercased()
    let group = groupID.rawValue.uuidString.lowercased()

    #expect(
      TerminalSidebarAccessibilityIdentifier.tab(tabID, groupID: nil) == "sidebar.tab-row.\(tab)"
    )
    #expect(
      TerminalSidebarAccessibilityIdentifier.tab(tabID, groupID: groupID)
        == "sidebar.group.\(group).tab.\(tab)"
    )
    #expect(
      TerminalSidebarAccessibilityIdentifier.group(groupID) == "sidebar.group-header.\(group)"
    )
  }
}
