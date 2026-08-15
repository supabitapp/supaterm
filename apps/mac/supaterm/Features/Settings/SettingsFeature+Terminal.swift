import ComposableArchitecture
import Foundation

extension SettingsFeature {
  func reduceTerminal(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .terminalSettingsLoadRequested,
      .terminalSettingsLoadResponse,
      .terminalSettingsApplyResponse:
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
      guard state.terminal.operation == .idle else {
        return .none
      }
      state.terminal.errorMessage = nil
      state.terminal.operation = .loading
      return .run { [ghosttyTerminalSettingsClient] send in
        do {
          await send(
            .terminalSettingsLoadResponse(
              .success(try await ghosttyTerminalSettingsClient.load())
            )
          )
        } catch is CancellationError {
          return
        } catch {
          await send(.terminalSettingsLoadResponse(.failure(error)))
        }
      }
      .cancellable(id: SettingsFeatureCancelID.terminalOperation, cancelInFlight: true)

    case .terminalSettingsLoadResponse(.success(let snapshot)):
      guard state.terminal.operation == .loading else { return .none }
      updateTerminalState(&state.terminal, with: snapshot)
      return .none

    case .terminalSettingsApplyResponse(.success(let values)):
      guard state.terminal.operation == .applying else { return .none }
      updateTerminalState(&state.terminal, with: values)
      return .none

    case .terminalSettingsLoadResponse(.failure(let error)):
      guard state.terminal.operation == .loading else { return .none }
      state.terminal.errorMessage = error.localizedDescription
      state.terminal.operation = .idle
      return .none

    case .terminalSettingsApplyResponse(.failure(let error)):
      guard state.terminal.operation == .applying else { return .none }
      state.terminal.errorMessage = error.localizedDescription
      state.terminal.operation = .idle
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
    state = SettingsTerminalState(snapshot: snapshot)
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
    state.lightTheme = values.lightTheme
    state.operation = .idle
    state.warningMessage = values.warningMessage
  }

  func prepareTerminalSettingsApply(_ state: inout SettingsTerminalState) -> Bool {
    guard !state.isBusy else {
      return false
    }
    state.errorMessage = nil
    state.operation = .applying
    return true
  }

  func applyTerminalSettings(_ settings: GhosttyTerminalSettingsDraft) -> Effect<Action> {
    .run { [ghosttyTerminalSettingsClient] send in
      do {
        await send(
          .terminalSettingsApplyResponse(
            .success(
              try await ghosttyTerminalSettingsClient.apply(settings)
            )
          )
        )
      } catch is CancellationError {
        return
      } catch {
        await send(.terminalSettingsApplyResponse(.failure(error)))
      }
    }
    .cancellable(id: SettingsFeatureCancelID.terminalOperation, cancelInFlight: true)
  }
}

extension SettingsTerminalState {
  init(
    snapshot: GhosttyTerminalSettingsSnapshot,
    errorMessage: String? = nil
  ) {
    availableFontFamilies = snapshot.availableFontFamilies
    availableDarkThemes = snapshot.availableDarkThemes
    availableLightThemes = snapshot.availableLightThemes
    confirmCloseSurface = snapshot.confirmCloseSurface
    configPath = snapshot.configPath
    darkTheme = snapshot.darkTheme
    self.errorMessage = errorMessage
    fontFamily = snapshot.fontFamily
    fontSize = snapshot.fontSize
    lightTheme = snapshot.lightTheme
    operation = .idle
    warningMessage = snapshot.warningMessage
  }

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
