import AppKit
import ComposableArchitecture
import Foundation

struct GhosttyTerminalSettingsSnapshot: Equatable, Sendable {
  var availableFontFamilies: [String]
  var availableDarkThemes: [String]
  var availableLightThemes: [String]
  var configPath: String
  var darkTheme: String?
  var fontFamily: String?
  var fontSize: Double
  var lightTheme: String?
  var warningMessage: String?
}

struct GhosttyTerminalSettingsValues: Equatable, Sendable {
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
      _ darkTheme: String?
    ) async throws -> GhosttyTerminalSettingsValues
}

extension GhosttyTerminalSettingsClient: DependencyKey {
  static let liveValue = Self(
    load: {
      try await MainActor.run {
        try GhosttyTerminalConfigFile().load()
      }
    },
    apply: { fontFamily, fontSize, lightTheme, darkTheme in
      try await MainActor.run {
        try GhosttyTerminalConfigFile().apply(
          fontFamily: fontFamily,
          fontSize: fontSize,
          lightTheme: lightTheme,
          darkTheme: darkTheme
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
        configPath: "/tmp/ghostty/config",
        darkTheme: "Zenbones Dark",
        fontFamily: nil,
        fontSize: 15,
        lightTheme: "Zenbones Light",
        warningMessage: nil
      )
    },
    apply: { fontFamily, fontSize, lightTheme, darkTheme in
      .init(
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
