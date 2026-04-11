import Testing

@testable import SupatermSettingsFeature

@MainActor
struct SettingsTerminalViewTests {
  @Test
  func themeOptionsMergeLightAndDarkCatalogsForBothPickers() {
    let lightOptions = SettingsTerminalView.themeOptions(
      lightThemes: ["Zenbones Light", "Builtin Light"],
      darkThemes: ["Zenbones Dark", "Builtin Dark"],
      selectedTheme: "Zenbones Light"
    )
    let darkOptions = SettingsTerminalView.themeOptions(
      lightThemes: ["Zenbones Light", "Builtin Light"],
      darkThemes: ["Zenbones Dark", "Builtin Dark"],
      selectedTheme: "Zenbones Dark"
    )

    #expect(lightOptions == ["Builtin Dark", "Builtin Light", "Zenbones Dark", "Zenbones Light"])
    #expect(darkOptions == ["Builtin Dark", "Builtin Light", "Zenbones Dark", "Zenbones Light"])
  }
}
