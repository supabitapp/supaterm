import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermSettingsFeature

@MainActor
struct SettingsFeatureTerminalTests {
  @Test
  func terminalFontFamilySelectionAppliesImmediately() async {
    var state = SettingsFeature.State()
    state.terminal = terminalSettingsState()

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.apply = { settings in
        await terminalSettingsValues(from: settings)
      }
    }

    await store.send(.terminalFontFamilySelected("JetBrains Mono")) {
      $0.terminal.errorMessage = nil
      $0.terminal.fontFamily = "JetBrains Mono"
      $0.terminal.isApplying = true
    }
    await store.receive(
      .terminalSettingsApplied(
        terminalSettingsValues(fontFamily: "JetBrains Mono")
      )
    ) {
      $0.terminal = terminalSettingsState(fontFamily: "JetBrains Mono")
    }
  }

  @Test
  func terminalLightThemeSelectionAppliesImmediately() async {
    var state = SettingsFeature.State()
    state.terminal = terminalSettingsState()

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.apply = { settings in
        await terminalSettingsValues(from: settings)
      }
    }

    await store.send(.terminalLightThemeSelected("Builtin Light")) {
      $0.terminal.errorMessage = nil
      $0.terminal.isApplying = true
      $0.terminal.lightTheme = "Builtin Light"
    }
    await store.receive(
      .terminalSettingsApplied(
        terminalSettingsValues(lightTheme: "Builtin Light")
      )
    ) {
      $0.terminal.isApplying = false
      $0.terminal.lightTheme = "Builtin Light"
    }
  }

  @Test
  func terminalDarkThemeSelectionAppliesImmediately() async {
    var state = SettingsFeature.State()
    state.terminal = terminalSettingsState()

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.apply = { settings in
        await terminalSettingsValues(from: settings)
      }
    }

    await store.send(.terminalDarkThemeSelected("Builtin Dark")) {
      $0.terminal.darkTheme = "Builtin Dark"
      $0.terminal.errorMessage = nil
      $0.terminal.isApplying = true
    }
    await store.receive(
      .terminalSettingsApplied(
        terminalSettingsValues(darkTheme: "Builtin Dark")
      )
    ) {
      $0.terminal.darkTheme = "Builtin Dark"
      $0.terminal.isApplying = false
    }
  }

  @Test
  func terminalSettingsLoadFailureSurfacesError() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.load = {
        throw NSError(domain: "SettingsFeatureTerminalTests", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "Broken config"
        ])
      }
    }

    await store.send(SettingsFeature.Action.terminalSettingsLoadRequested) {
      $0.terminal.errorMessage = nil
      $0.terminal.isLoading = true
    }
    await store.receive(SettingsFeature.Action.terminalSettingsLoadFailed("Broken config"), timeout: 0) {
      $0.terminal.errorMessage = "Broken config"
      $0.terminal.isLoading = false
    }
  }

  @Test
  func terminalCloseConfirmationSelectionAppliesImmediately() async {
    var state = SettingsFeature.State()
    state.terminal = terminalSettingsState()

    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.apply = { settings in
        await terminalSettingsValues(from: settings)
      }
    }

    await store.send(.terminalConfirmCloseSurfaceSelected(.always)) {
      $0.terminal.confirmCloseSurface = .always
      $0.terminal.errorMessage = nil
      $0.terminal.isApplying = true
    }
    await store.receive(
      .terminalSettingsApplied(
        terminalSettingsValues(confirmCloseSurface: .always)
      )
    ) {
      $0.terminal = terminalSettingsState(confirmCloseSurface: .always)
    }
  }
}
