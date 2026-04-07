import AppKit
import ComposableArchitecture
import Foundation

enum GhosttyTerminalCloseConfirmation: String, CaseIterable, Equatable, Sendable, Identifiable {
  case never = "false"
  case whenNotAtPrompt = "true"
  case always

  var id: Self {
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

struct GhosttyTerminalSettingsSnapshot: Equatable, Sendable {
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

struct GhosttyTerminalSettingsValues: Equatable, Sendable {
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
  var apply:
    @Sendable (
      _ fontFamily: String?,
      _ fontSize: Double,
      _ lightTheme: String?,
      _ darkTheme: String?,
      _ confirmCloseSurface: GhosttyTerminalCloseConfirmation
    ) async throws -> GhosttyTerminalSettingsValues
}

extension GhosttyTerminalSettingsClient: DependencyKey {
  static let liveValue = Self(
    load: {
      try await MainActor.run {
        try GhosttyTerminalConfigFile().load()
      }
    },
    apply: { fontFamily, fontSize, lightTheme, darkTheme, confirmCloseSurface in
      try await MainActor.run {
        try GhosttyTerminalConfigFile().apply(
          fontFamily: fontFamily,
          fontSize: fontSize,
          lightTheme: lightTheme,
          darkTheme: darkTheme,
          confirmCloseSurface: confirmCloseSurface
        )
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
    apply: { fontFamily, fontSize, lightTheme, darkTheme, confirmCloseSurface in
      .init(
        confirmCloseSurface: confirmCloseSurface,
        configPath: "/tmp/ghostty/config",
        darkTheme: darkTheme,
        fontFamily: fontFamily,
        fontSize: fontSize,
        lightTheme: lightTheme,
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
