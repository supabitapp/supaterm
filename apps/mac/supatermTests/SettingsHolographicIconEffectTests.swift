import AppKit
import Testing

@testable import supaterm

struct SettingsHolographicIconEffectTests {
  @Test
  func recipeHonorsGlintAndPrismFlags() {
    let recipe = SettingsAboutIconRecipe(
      icon: NSImage(size: .init(width: 84, height: 84)),
      showsGlintLayer: false,
      showsPrismLayer: true
    )

    #expect(recipe.layerKinds == [.icon, .prismBase, .prismAccent, .lightSweep])
  }

  @Test
  func recipeOmitsOptionalLayersWhenDisabled() {
    let recipe = SettingsAboutIconRecipe(
      icon: NSImage(size: .init(width: 84, height: 84)),
      showsGlintLayer: false,
      showsPrismLayer: false
    )

    #expect(recipe.layerKinds == [.icon, .prismBase, .lightSweep])
  }

  @Test
  func viewExposesFirstPartyFlags() {
    let view = SettingsHolographicIconView(
      appName: "supaterm",
      showsGlintLayer: true,
      showsPrismLayer: false
    )

    #expect(view.showsGlintLayer)
    #expect(!view.showsPrismLayer)
  }
}
