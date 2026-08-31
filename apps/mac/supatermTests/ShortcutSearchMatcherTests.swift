import Carbon.HIToolbox
import SupatermSupport
import Testing

@testable import SupatermSettingsFeature

@MainActor
struct ShortcutSearchMatcherTests {
  @Test(arguments: [
    "cmd option p",
    "command alt p",
    "cmd+alt+p",
    "command+option+p",
    "⌘⌥P",
    "⌘ ⌥ P",
  ])
  func equivalentBindingSpellingsMatch(_ query: String) {
    #expect(
      ShortcutSearchMatcher(query: query).matches(
        SupatermShortcuts.openPullRequest,
        overrides: [:]
      )
    )
  }

  @Test
  func configuredOverrideReplacesDefaultBinding() {
    let overrides: [SupatermShortcutID: SupatermShortcutOverride] = [
      .toggleSidebar: SupatermShortcutOverride(
        keyCode: UInt16(kVK_ANSI_B),
        modifiers: [.command, .shift]
      )
    ]

    #expect(
      ShortcutSearchMatcher(query: "cmd shift b").matches(
        SupatermShortcuts.toggleSidebar,
        overrides: overrides
      )
    )
    #expect(
      !ShortcutSearchMatcher(query: "cmd s").matches(
        SupatermShortcuts.toggleSidebar,
        overrides: overrides
      )
    )
  }

  @Test(arguments: ["cmd shift p", "cmd alt b", "toggle terminal"])
  func unrelatedQueriesDoNotMatch(_ query: String) {
    #expect(
      !ShortcutSearchMatcher(query: query).matches(
        SupatermShortcuts.openPullRequest,
        overrides: [:]
      )
    )
  }

  @Test
  func disabledShortcutDoesNotMatchItsDefaultBinding() {
    #expect(
      !ShortcutSearchMatcher(query: "cmd s").matches(
        SupatermShortcuts.toggleSidebar,
        overrides: [.toggleSidebar: .disabled]
      )
    )
  }

  @Test
  func displayNameStillMatches() {
    #expect(
      ShortcutSearchMatcher(query: "pull request").matches(
        SupatermShortcuts.openPullRequest,
        overrides: [:]
      )
    )
  }
}
