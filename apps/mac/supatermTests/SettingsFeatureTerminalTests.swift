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
      $0.terminal.operation = .applying
    }
    await store.receive(\.terminalSettingsApplyResponse) {
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
      $0.terminal.lightTheme = "Builtin Light"
      $0.terminal.operation = .applying
    }
    await store.receive(\.terminalSettingsApplyResponse) {
      $0.terminal.lightTheme = "Builtin Light"
      $0.terminal.operation = .idle
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
      $0.terminal.operation = .applying
    }
    await store.receive(\.terminalSettingsApplyResponse) {
      $0.terminal.darkTheme = "Builtin Dark"
      $0.terminal.operation = .idle
    }
  }

  @Test
  func terminalSettingsLoadFailureSurfacesError() async {
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.load = {
        throw NSError(
          domain: "SettingsFeatureTerminalTests", code: 1,
          userInfo: [
            NSLocalizedDescriptionKey: "Broken config"
          ])
      }
    }

    await store.send(SettingsFeature.Action.terminalSettingsLoadRequested) {
      $0.terminal.errorMessage = nil
      $0.terminal.operation = .loading
    }
    await store.receive(\.terminalSettingsLoadResponse, timeout: Duration.zero) {
      $0.terminal.errorMessage = "Broken config"
      $0.terminal.operation = .idle
    }
  }

  @Test
  func terminalSettingsApplyFailureSurfacesError() async {
    var state = SettingsFeature.State()
    state.terminal = terminalSettingsState()
    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.apply = { _ in
        throw NSError(
          domain: "SettingsFeatureTerminalTests",
          code: 2,
          userInfo: [NSLocalizedDescriptionKey: "Cannot write config"]
        )
      }
    }

    await store.send(.terminalFontSizeChanged(16)) {
      $0.terminal.errorMessage = nil
      $0.terminal.fontSize = 16
      $0.terminal.operation = .applying
    }
    await store.receive(\.terminalSettingsApplyResponse) {
      $0.terminal.errorMessage = "Cannot write config"
      $0.terminal.operation = .idle
    }
  }

  @Test
  func repeatedLoadKeepsOneOperation() async {
    let gate = SettingsTestGate<GhosttyTerminalSettingsSnapshot>()
    let loadCount = LockIsolated(0)
    let store = TestStore(initialState: SettingsFeature.State()) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.load = {
        loadCount.withValue { $0 += 1 }
        return await gate.next()
      }
    }

    await store.send(.terminalSettingsLoadRequested) {
      $0.terminal.errorMessage = nil
      $0.terminal.operation = .loading
    }
    await store.send(.terminalSettingsLoadRequested)
    #expect(await waitUntil { loadCount.value == 1 })

    await gate.send(terminalSettingsSnapshot())
    await store.receive(\.terminalSettingsLoadResponse) {
      $0.terminal = terminalSettingsState()
    }
  }

  @Test
  func loadAndEditsDoNotOverlap() async {
    let loadCount = LockIsolated(0)
    var state = SettingsFeature.State()
    state.terminal = terminalSettingsState(operation: .applying)
    let store = TestStore(initialState: state) {
      SettingsFeature()
    } withDependencies: {
      $0.ghosttyTerminalSettingsClient.load = {
        loadCount.withValue { $0 += 1 }
        return terminalSettingsSnapshot()
      }
    }

    await store.send(.terminalSettingsLoadRequested)
    await store.send(.terminalFontSizeChanged(16))

    #expect(loadCount.value == 0)
    #expect(store.state.terminal.fontSize == 15)
    #expect(store.state.terminal.operation == .applying)
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
      $0.terminal.operation = .applying
    }
    await store.receive(\.terminalSettingsApplyResponse) {
      $0.terminal = terminalSettingsState(confirmCloseSurface: .always)
    }
  }
}
