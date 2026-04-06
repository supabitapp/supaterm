import AppKit
import ComposableArchitecture
import Foundation

struct GhosttyTerminalSettingsSnapshot: Equatable, Sendable {
  var availableFontFamilies: [String]
  var configPath: String
  var fontFamily: String?
  var fontSize: Double
  var warningMessage: String?
}

struct GhosttyTerminalSettingsClient: Sendable {
  var load: @Sendable () async throws -> GhosttyTerminalSettingsSnapshot
  var apply: @Sendable (_ fontFamily: String?, _ fontSize: Double) async throws -> GhosttyTerminalSettingsSnapshot
}

extension GhosttyTerminalSettingsClient: DependencyKey {
  static let liveValue = Self(
    load: {
      try await MainActor.run {
        try GhosttyTerminalConfigFile().load()
      }
    },
    apply: { fontFamily, fontSize in
      try await MainActor.run {
        try GhosttyTerminalConfigFile().apply(fontFamily: fontFamily, fontSize: fontSize)
      }
    }
  )

  static let testValue = Self(
    load: {
      .init(
        availableFontFamilies: ["JetBrains Mono", "SF Mono"],
        configPath: "/tmp/ghostty/config",
        fontFamily: nil,
        fontSize: 15,
        warningMessage: nil
      )
    },
    apply: { fontFamily, fontSize in
      .init(
        availableFontFamilies: ["JetBrains Mono", "SF Mono"],
        configPath: "/tmp/ghostty/config",
        fontFamily: fontFamily,
        fontSize: fontSize,
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
