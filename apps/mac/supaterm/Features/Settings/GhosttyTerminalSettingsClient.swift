import ComposableArchitecture
import Foundation

public nonisolated enum GhosttyTerminalCloseConfirmation: String, CaseIterable, Equatable, Sendable, Identifiable {
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

public nonisolated struct GhosttyTerminalSettingsDraft: Equatable, Sendable {
  public var confirmCloseSurface: GhosttyTerminalCloseConfirmation
  public var darkTheme: String?
  public var fontFamily: String?
  public var fontSize: Double
  public var lightTheme: String?

  public init(
    confirmCloseSurface: GhosttyTerminalCloseConfirmation,
    darkTheme: String?,
    fontFamily: String?,
    fontSize: Double,
    lightTheme: String?
  ) {
    self.confirmCloseSurface = confirmCloseSurface
    self.darkTheme = darkTheme
    self.fontFamily = fontFamily
    self.fontSize = fontSize
    self.lightTheme = lightTheme
  }
}

public nonisolated struct GhosttyTerminalSettingsSnapshot: Equatable, Sendable {
  public var availableFontFamilies: [String]
  public var availableDarkThemes: [String]
  public var availableLightThemes: [String]
  public var confirmCloseSurface: GhosttyTerminalCloseConfirmation
  public var configPath: String
  public var darkTheme: String?
  public var fontFamily: String?
  public var fontSize: Double
  public var lightTheme: String?
  public var warningMessage: String?

  public init(
    availableFontFamilies: [String],
    availableDarkThemes: [String],
    availableLightThemes: [String],
    confirmCloseSurface: GhosttyTerminalCloseConfirmation,
    configPath: String,
    darkTheme: String?,
    fontFamily: String?,
    fontSize: Double,
    lightTheme: String?,
    warningMessage: String?
  ) {
    self.availableFontFamilies = availableFontFamilies
    self.availableDarkThemes = availableDarkThemes
    self.availableLightThemes = availableLightThemes
    self.confirmCloseSurface = confirmCloseSurface
    self.configPath = configPath
    self.darkTheme = darkTheme
    self.fontFamily = fontFamily
    self.fontSize = fontSize
    self.lightTheme = lightTheme
    self.warningMessage = warningMessage
  }
}

public nonisolated struct GhosttyTerminalSettingsValues: Equatable, Sendable {
  public var confirmCloseSurface: GhosttyTerminalCloseConfirmation
  public var configPath: String
  public var darkTheme: String?
  public var fontFamily: String?
  public var fontSize: Double
  public var lightTheme: String?
  public var warningMessage: String?

  public init(
    confirmCloseSurface: GhosttyTerminalCloseConfirmation,
    configPath: String,
    darkTheme: String?,
    fontFamily: String?,
    fontSize: Double,
    lightTheme: String?,
    warningMessage: String?
  ) {
    self.confirmCloseSurface = confirmCloseSurface
    self.configPath = configPath
    self.darkTheme = darkTheme
    self.fontFamily = fontFamily
    self.fontSize = fontSize
    self.lightTheme = lightTheme
    self.warningMessage = warningMessage
  }
}

public nonisolated enum GhosttyTerminalSettingsClientError: LocalizedError {
  case unavailable

  public var errorDescription: String? {
    switch self {
    case .unavailable:
      "Ghostty terminal settings are unavailable."
    }
  }
}

public nonisolated struct GhosttyTerminalSettingsClient: Sendable {
  var load: @Sendable () async throws -> GhosttyTerminalSettingsSnapshot
  var apply: @Sendable (_ settings: GhosttyTerminalSettingsDraft) async throws -> GhosttyTerminalSettingsValues

  public init(
    load: @escaping @Sendable () async throws -> GhosttyTerminalSettingsSnapshot,
    apply: @escaping @Sendable (_ settings: GhosttyTerminalSettingsDraft) async throws -> GhosttyTerminalSettingsValues
  ) {
    self.load = load
    self.apply = apply
  }
}

extension GhosttyTerminalSettingsClient: DependencyKey {
  public nonisolated static let liveValue = Self(
    load: {
      throw GhosttyTerminalSettingsClientError.unavailable
    },
    apply: { settings in
      _ = settings
      throw GhosttyTerminalSettingsClientError.unavailable
    }
  )

  public nonisolated static let testValue = Self(
    load: {
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
    },
    apply: { settings in
      GhosttyTerminalSettingsValues(
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
  public var ghosttyTerminalSettingsClient: GhosttyTerminalSettingsClient {
    get { self[GhosttyTerminalSettingsClient.self] }
    set { self[GhosttyTerminalSettingsClient.self] = newValue }
  }
}
