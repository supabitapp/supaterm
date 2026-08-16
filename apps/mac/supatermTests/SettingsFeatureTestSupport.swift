import ComposableArchitecture
import Foundation
import SupatermSupport
import SupatermUpdateFeature
import Testing

@testable import SupatermSettingsFeature

actor SettingsTestGate<Value: Sendable> {
  private var values: [Value] = []
  private var waiters: [CheckedContinuation<Value, Never>] = []

  func next() async -> Value {
    if !values.isEmpty {
      return values.removeFirst()
    }
    return await withCheckedContinuation { continuation in
      waiters.append(continuation)
    }
  }

  func send(_ value: Value) {
    if !waiters.isEmpty {
      waiters.removeFirst().resume(returning: value)
    } else {
      values.append(value)
    }
  }
}

nonisolated func terminalSettingsSnapshot() -> GhosttyTerminalSettingsSnapshot {
  GhosttyTerminalSettingsSnapshot(
    availableFontFamilies: ["JetBrains Mono", "SF Mono"],
    availableDarkThemes: ["Zenbones Dark", "Builtin Dark"],
    availableLightThemes: ["Zenbones Light", "Builtin Light"],
    confirmCloseSurface: .whenNotAtPrompt,
    configPath: "/tmp/ghostty/config",
    darkTheme: "Zenbones Dark",
    fontFamily: nil,
    fontSize: 15,
    lightTheme: "Zenbones Light",
    warningMessage: nil
  )
}

nonisolated func terminalSettingsState(
  confirmCloseSurface: GhosttyTerminalCloseConfirmation = .whenNotAtPrompt,
  darkTheme: String? = "Zenbones Dark",
  errorMessage: String? = nil,
  fontFamily: String? = nil,
  fontSize: Double = 15,
  lightTheme: String? = "Zenbones Light",
  operation: SettingsTerminalOperation = .idle,
  warningMessage: String? = nil
) -> SettingsTerminalState {
  SettingsTerminalState(
    availableFontFamilies: ["JetBrains Mono", "SF Mono"],
    availableDarkThemes: ["Zenbones Dark", "Builtin Dark"],
    availableLightThemes: ["Zenbones Light", "Builtin Light"],
    confirmCloseSurface: confirmCloseSurface,
    configPath: "/tmp/ghostty/config",
    darkTheme: darkTheme,
    errorMessage: errorMessage,
    fontFamily: fontFamily,
    fontSize: fontSize,
    lightTheme: lightTheme,
    operation: operation,
    warningMessage: warningMessage
  )
}

nonisolated func terminalSettingsValues(
  confirmCloseSurface: GhosttyTerminalCloseConfirmation = .whenNotAtPrompt,
  darkTheme: String? = "Zenbones Dark",
  fontFamily: String? = nil,
  fontSize: Double = 15,
  lightTheme: String? = "Zenbones Light",
  warningMessage: String? = nil
) -> GhosttyTerminalSettingsValues {
  GhosttyTerminalSettingsValues(
    confirmCloseSurface: confirmCloseSurface,
    configPath: "/tmp/ghostty/config",
    darkTheme: darkTheme,
    fontFamily: fontFamily,
    fontSize: fontSize,
    lightTheme: lightTheme,
    warningMessage: warningMessage
  )
}

func terminalSettingsValues(
  from settings: GhosttyTerminalSettingsDraft,
  warningMessage: String? = nil
) -> GhosttyTerminalSettingsValues {
  terminalSettingsValues(
    confirmCloseSurface: settings.confirmCloseSurface,
    darkTheme: settings.darkTheme,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lightTheme: settings.lightTheme,
    warningMessage: warningMessage
  )
}

nonisolated func notificationPermissionAlert(_ message: String) -> AlertState<SettingsFeature.Alert> {
  AlertState {
    TextState("Enable Notifications in System Settings")
  } actions: {
    ButtonState(action: .openSystemNotificationSettings) {
      TextState("Open System Settings")
    }
    ButtonState(role: .cancel, action: .dismiss) {
      TextState("Cancel")
    }
  } message: {
    TextState(message)
  }
}

actor SettingsNotificationPermissionRecorder {
  private var openCountValue = 0
  private var requestCountValue = 0

  func openCount() -> Int {
    openCountValue
  }

  func recordOpen() {
    openCountValue += 1
  }

  func recordRequest() {
    requestCountValue += 1
  }

  func requestCount() -> Int {
    requestCountValue
  }
}

actor SettingsUpdateActionRecorder {
  private var recordedActions: [UpdateUserAction] = []

  func actions() -> [UpdateUserAction] {
    recordedActions
  }

  func record(_ action: UpdateUserAction) {
    recordedActions.append(action)
  }
}

enum SettingsUpdateClientCommand: Equatable {
  case setAutomaticallyChecksForUpdates(Bool)
  case setAutomaticallyDownloadsUpdates(Bool)
  case setUpdateChannel(UpdateChannel)
}

actor SettingsUpdateClientCommandRecorder {
  private var commands: [SettingsUpdateClientCommand] = []

  func recorded() -> [SettingsUpdateClientCommand] {
    commands
  }

  func record(_ command: SettingsUpdateClientCommand) {
    commands.append(command)
  }
}

nonisolated func makeSettingsStream() -> (
  AsyncStream<UpdateClient.Snapshot>,
  AsyncStream<UpdateClient.Snapshot>.Continuation
) {
  AsyncStream.makeStream(of: UpdateClient.Snapshot.self)
}
