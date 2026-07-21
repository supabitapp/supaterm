import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

struct TerminalSidebarGroupSurfaceTests {
  @Test @MainActor
  func hoverStateGuardsRepeatedAndStaleTransitions() {
    let first = TerminalTabGroupID()
    let second = TerminalTabGroupID()
    let state = TerminalSidebarGroupHoverState()
    var changes: [(TerminalTabGroupID?, TerminalTabGroupID?)] = []
    state.onChange = { changes.append(($0, $1)) }

    state.enter(first)
    state.enter(first)
    state.enter(second)
    state.exit(first)
    state.exit(second)

    #expect(state.groupID == nil)
    #expect(changes.count == 3)
    #expect(changes[0].0 == nil && changes[0].1 == first)
    #expect(changes[1].0 == first && changes[1].1 == second)
    #expect(changes[2].0 == second && changes[2].1 == nil)
  }

  @Test @MainActor
  func removalDragClearAndReuseLeaveNoStaleHover() {
    let first = TerminalTabGroupID()
    let second = TerminalTabGroupID()
    let state = TerminalSidebarGroupHoverState()

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
          hoverOpacity: 1,
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
  func hoverTokenMatchesLightAndDarkValues() {
    let light = Palette(colorScheme: .light).sidebarGroupHoverFillValue
    let dark = Palette(colorScheme: .dark).sidebarGroupHoverFillValue

    #expect(light.red == 1)
    #expect(light.green == 1)
    #expect(light.blue == 1)
    #expect(light.alpha == 0.40)
    #expect(dark.red == 1)
    #expect(dark.green == 1)
    #expect(dark.blue == 1)
    #expect(dark.alpha == 0.12)
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
