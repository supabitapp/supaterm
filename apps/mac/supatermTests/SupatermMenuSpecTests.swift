import AppKit
import Testing

@testable import SupatermAppFeature
@testable import SupatermMenuFeature
@testable import supaterm

@MainActor
struct SupatermMenuSpecTests {
  @Test
  func menuItemSpecsHaveUniqueIdentifiers() {
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())

    let identifiers = controller.menuItemSpecs().compactMap(\.id?.rawValue)

    #expect(identifiers.count == Set(identifiers).count)
    #expect(identifiers.count >= 60)
  }

  @Test
  func everySpecCarriesAnIdentifier() {
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())

    #expect(controller.menuItemSpecs().allSatisfy { $0.id != nil })
  }

  @Test
  func slotSpecsCoverTabsAndSpaces() {
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    let specs = controller.menuItemSpecs()

    let tabSlots = specs.filter {
      $0.id?.rawValue.hasPrefix("app.supabit.supaterm.tabs.select.") == true
    }
    let spaceSlots = specs.filter {
      $0.id?.rawValue.hasPrefix("app.supabit.supaterm.spaces.select.") == true
    }

    #expect(tabSlots.compactMap(\.slot) == Array(1...10))
    #expect(spaceSlots.compactMap(\.slot) == Array(1...10))
  }

  @Test
  func layoutCoversEverySpecExactlyOnce() {
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    let specIdentifiers = controller.menuItemSpecs().compactMap(\.id?.rawValue)
    let layoutIdentifiers = identifiers(
      in: controller.menuLayout().flatMap(\.entries),
      specIdentifiers: specIdentifiers
    )

    #expect(counts(layoutIdentifiers) == counts(specIdentifiers))
  }

  @Test
  func layoutBuildsExpectedTopLevelMenus() {
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    let mainMenu = controller.builtMainMenu()

    #expect(mainMenu.items.map(\.title).count == 8)
    #expect(
      Array(mainMenu.items.map(\.title).suffix(7)) == ["File", "Edit", "View", "Tabs", "Spaces", "Window", "Help"])
    #expect(mainMenu.items.map(\.title) == controller.menuLayout().map(\.title))
  }

  @Test
  func layoutBuildsExpectedNestedMenus() throws {
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    let mainMenu = controller.builtMainMenu()
    let editMenu = try #require(mainMenu.items.first(where: { $0.title == "Edit" })?.submenu)
    let findMenu = try #require(editMenu.items.last?.submenu)

    #expect(findMenu.title == "Find")
    #expect(
      findMenu.items.map(\.title) == [
        "Find...",
        "Find Next",
        "Find Previous",
        "",
        "Hide Find Bar",
        "",
        "Use Selection for Find",
      ])

    let windowMenu = try #require(mainMenu.items.first(where: { $0.title == "Window" })?.submenu)
    let selectSplitMenu = try #require(windowMenu.items.first(where: { $0.title == "Select Split" })?.submenu)
    #expect(
      selectSplitMenu.items.map(\.title) == [
        "Select Split Above",
        "Select Split Below",
        "Select Split Left",
        "Select Split Right",
      ])

    let resizeSplitMenu = try #require(windowMenu.items.first(where: { $0.title == "Resize Split" })?.submenu)
    #expect(
      resizeSplitMenu.items.map(\.title) == [
        "Equalize Panes",
        "",
        "Move Divider Up",
        "Move Divider Down",
        "Move Divider Left",
        "Move Divider Right",
      ])
  }

  private func identifiers(
    in entries: [SupatermMenuEntrySpec],
    specIdentifiers: [String]
  ) -> [String] {
    entries.flatMap { entry -> [String] in
      switch entry {
      case .item(let identifier):
        [identifier.rawValue]
      case .separator, .system, .services:
        []
      case .submenu(_, let entries):
        identifiers(in: entries, specIdentifiers: specIdentifiers)
      case .slots(let prefix):
        specIdentifiers.filter { $0.hasPrefix(prefix) }
      }
    }
  }

  private func counts(_ values: [String]) -> [String: Int] {
    values.reduce(into: [:]) { counts, value in
      counts[value, default: 0] += 1
    }
  }
}
