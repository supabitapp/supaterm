import AppKit
import ComposableArchitecture
import Foundation

public enum GhosttyTerminalCloseConfirmation: String, CaseIterable, Equatable, Sendable, Identifiable {
  case never = "false"
  case whenNotAtPrompt = "true"
  case always

  public var id: Self {
    self
  }

  var title: String {
    switch self {
    case .never:
      "Never"
    case .whenNotAtPrompt:
      "When Not at Prompt"
    case .always:
      "Always"
    }
  }
}

public struct GhosttyTerminalSettingsDraft: Equatable, Sendable {
  var confirmCloseSurface: GhosttyTerminalCloseConfirmation
  var darkTheme: String?
  var fontFamily: String?
  var fontSize: Double
  var lightTheme: String?
}

public struct GhosttyTerminalSettingsSnapshot: Equatable, Sendable {
  var availableFontFamilies: [String]
  var availableDarkThemes: [String]
  var availableLightThemes: [String]
  var confirmCloseSurface: GhosttyTerminalCloseConfirmation
  var configPath: String
  var darkTheme: String?
  var fontFamily: String?
  var fontSize: Double
  var lightTheme: String?
  var warningMessage: String?
}

public struct GhosttyTerminalSettingsValues: Equatable, Sendable {
  var confirmCloseSurface: GhosttyTerminalCloseConfirmation
  var configPath: String
  var darkTheme: String?
  var fontFamily: String?
  var fontSize: Double
  var lightTheme: String?
  var warningMessage: String?
}

struct GhosttyTerminalSettingsClient: Sendable {
  var load: @Sendable () async throws -> GhosttyTerminalSettingsSnapshot
  var apply: @Sendable (_ settings: GhosttyTerminalSettingsDraft) async throws -> GhosttyTerminalSettingsValues
}

extension GhosttyTerminalSettingsClient: DependencyKey {
  static let liveValue = Self(
    load: {
      try await MainActor.run {
        try GhosttyTerminalConfigFile().load()
      }
    },
    apply: { settings in
      try await MainActor.run {
        try GhosttyTerminalConfigFile().apply(settings: settings)
      }
    }
  )

  static let testValue = Self(
    load: {
      .init(
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
    },
    apply: { settings in
      .init(
        confirmCloseSurface: settings.confirmCloseSurface,
        configPath: "/tmp/ghostty/config",
        darkTheme: settings.darkTheme,
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize,
        lightTheme: settings.lightTheme,
        warningMessage: nil
      )
    }
  )
}

extension DependencyValues {
  var ghosttyTerminalSettingsClient: GhosttyTerminalSettingsClient {
    get { self[GhosttyTerminalSettingsClient.self] }
    set { self[GhosttyTerminalSettingsClient.self] = newValue }
  }
}
