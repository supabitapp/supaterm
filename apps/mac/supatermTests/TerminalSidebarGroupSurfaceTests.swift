import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

struct TerminalSidebarGroupSurfaceTests {
  @Test @MainActor
  func hoverStateGuardsRepeatedAndStaleTransitions() {
    let first = TerminalTabGroupID()
    let second = TerminalTabGroupID()
    let state = TerminalSidebarGroupHeaderHoverState()

    state.enter(first)
    #expect(state.groupID == first)
    state.enter(first)
    state.enter(second)
    #expect(state.groupID == second)
    state.exit(first)
    #expect(state.groupID == second)
    state.exit(second)

    #expect(state.groupID == nil)
  }

  @Test @MainActor
  func removalDragClearAndReuseLeaveNoStaleHover() {
    let first = TerminalTabGroupID()
    let second = TerminalTabGroupID()
    let state = TerminalSidebarGroupHeaderHoverState()

    state.enter(first)
    state.retain([second])
    #expect(state.groupID == nil)
    state.enter(second)
    state.clear()
    #expect(state.groupID == nil)
    state.enter(first)
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
    #expect(
      TerminalSidebarGroupSurfaceStyle.resolve(.resting)
        == TerminalSidebarGroupSurfaceStyle(
          fillOpacity: 0.10,
          hoverOpacity: 0,
          strokeOpacity: 0.18
        )
    )
    #expect(
      TerminalSidebarGroupSurfaceStyle.resolve(.hovered)
        == TerminalSidebarGroupSurfaceStyle(
          fillOpacity: 0.10,
          hoverOpacity: 0.10,
          strokeOpacity: 0.18
        )
    )
    #expect(
      TerminalSidebarGroupSurfaceStyle.resolve(.dropTarget)
        == TerminalSidebarGroupSurfaceStyle(
          fillOpacity: 0.10,
          hoverOpacity: 0,
          strokeOpacity: 0.85
        )
    )
  }

  @Test
  func hoverBlendStrengthensContrastForEachScheme() {
    #expect(TerminalSidebarGroupSurfaceBlendMode.resolve(colorScheme: .light) == .plusDarker)
    #expect(TerminalSidebarGroupSurfaceBlendMode.resolve(colorScheme: .dark) == .plusLighter)
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
