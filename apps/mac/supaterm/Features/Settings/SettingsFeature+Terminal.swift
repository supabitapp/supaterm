import ComposableArchitecture
import Foundation

extension SettingsFeature {
  func reduceTerminal(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .terminalSettingsLoadRequested,
      .terminalSettingsLoaded,
      .terminalSettingsApplied,
      .terminalSettingsLoadFailed,
      .terminalSettingsApplyFailed:
      return reduceTerminalLoading(&state, action: action)

    case .terminalLightThemeSelected,
      .terminalDarkThemeSelected,
      .terminalFontFamilySelected,
      .terminalFontSizeChanged,
      .terminalConfirmCloseSurfaceSelected:
      return reduceTerminalControls(&state, action: action)

    default:
      return .none
    }
  }

  func reduceTerminalLoading(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .terminalSettingsLoadRequested:
      guard !state.terminal.isLoading else {
        return .none
      }
      state.terminal.errorMessage = nil
      state.terminal.isLoading = true
      return .run { [ghosttyTerminalSettingsClient] send in
        do {
          await send(.terminalSettingsLoaded(try await ghosttyTerminalSettingsClient.load()))
        } catch {
          await send(.terminalSettingsLoadFailed(error.localizedDescription))
        }
      }

    case .terminalSettingsLoaded(let snapshot):
      updateTerminalState(&state.terminal, with: snapshot)
      return .none

    case .terminalSettingsApplied(let values):
      updateTerminalState(&state.terminal, with: values)
      return .none

    case .terminalSettingsLoadFailed(let message):
      state.terminal.errorMessage = message
      state.terminal.isLoading = false
      return .none

    case .terminalSettingsApplyFailed(let message):
      state.terminal.errorMessage = message
      state.terminal.isApplying = false
      return .none

    default:
      return .none
    }
  }

  func reduceTerminalControls(_ state: inout State, action: Action) -> Effect<Action> {
    guard prepareTerminalSettingsApply(&state.terminal) else {
      return .none
    }

    switch action {
    case .terminalLightThemeSelected(let lightTheme):
      state.terminal.lightTheme = lightTheme
      if state.terminal.darkTheme == nil {
        state.terminal.darkTheme = lightTheme
      }

    case .terminalDarkThemeSelected(let darkTheme):
      state.terminal.darkTheme = darkTheme
      if state.terminal.lightTheme == nil {
        state.terminal.lightTheme = darkTheme
      }

    case .terminalFontFamilySelected(let fontFamily):
      state.terminal.fontFamily = fontFamily

    case .terminalFontSizeChanged(let fontSize):
      state.terminal.fontSize = fontSize

    case .terminalConfirmCloseSurfaceSelected(let confirmCloseSurface):
      state.terminal.confirmCloseSurface = confirmCloseSurface

    default:
      return .none
    }

    return applyTerminalSettings(state.terminal.settingsDraft)
  }

  func updateTerminalState(
    _ state: inout SettingsTerminalState,
    with snapshot: GhosttyTerminalSettingsSnapshot
  ) {
    state.availableFontFamilies = snapshot.availableFontFamilies
    state.availableDarkThemes = snapshot.availableDarkThemes
    state.availableLightThemes = snapshot.availableLightThemes
    state.confirmCloseSurface = snapshot.confirmCloseSurface
    state.configPath = snapshot.configPath
    state.darkTheme = snapshot.darkTheme
    state.errorMessage = nil
    state.fontFamily = snapshot.fontFamily
    state.fontSize = snapshot.fontSize
    state.isApplying = false
    state.isLoading = false
    state.lightTheme = snapshot.lightTheme
    state.warningMessage = snapshot.warningMessage
  }

  func updateTerminalState(
    _ state: inout SettingsTerminalState,
    with values: GhosttyTerminalSettingsValues
  ) {
    state.confirmCloseSurface = values.confirmCloseSurface
    state.configPath = values.configPath
    state.darkTheme = values.darkTheme
    state.errorMessage = nil
    state.fontFamily = values.fontFamily
    state.fontSize = values.fontSize
    state.isApplying = false
    state.isLoading = false
    state.lightTheme = values.lightTheme
    state.warningMessage = values.warningMessage
  }

  func prepareTerminalSettingsApply(_ state: inout SettingsTerminalState) -> Bool {
    guard !state.isBusy else {
      return false
    }
    state.errorMessage = nil
    state.isApplying = true
    return true
  }

  func applyTerminalSettings(_ settings: GhosttyTerminalSettingsDraft) -> Effect<Action> {
    .run { [ghosttyTerminalSettingsClient] send in
      do {
        await send(
          .terminalSettingsApplied(
            try await ghosttyTerminalSettingsClient.apply(settings)
          )
        )
      } catch {
        await send(.terminalSettingsApplyFailed(error.localizedDescription))
      }
    }
  }
}

extension SettingsTerminalState {
  var settingsDraft: GhosttyTerminalSettingsDraft {
    GhosttyTerminalSettingsDraft(
      confirmCloseSurface: confirmCloseSurface,
      darkTheme: darkTheme,
      fontFamily: fontFamily,
      fontSize: fontSize,
      lightTheme: lightTheme
    )
  }
}
