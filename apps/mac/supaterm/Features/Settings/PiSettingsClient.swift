import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct PiSettingsClient: Sendable {
  var hasSupatermIntegration: @Sendable () async throws -> Bool
  var installSupatermIntegration: @Sendable () async throws -> Void
  var isPiAvailable: @Sendable () async throws -> Bool
  var removeSupatermIntegration: @Sendable () async throws -> Void
}

extension PiSettingsClient: DependencyKey {
  static let liveValue = Self(
    hasSupatermIntegration: {
      try PiSettingsInstaller().hasSupatermPackageInstalled()
    },
    installSupatermIntegration: {
      try PiSettingsInstaller().installSupatermPackage()
    },
    isPiAvailable: {
      try PiSettingsInstaller().isPiAvailable()
    },
    removeSupatermIntegration: {
      try PiSettingsInstaller().removeSupatermPackage()
    }
  )

  static let testValue = Self(
    hasSupatermIntegration: { false },
    installSupatermIntegration: {},
    isPiAvailable: { true },
    removeSupatermIntegration: {}
  )
}

extension DependencyValues {
  var piSettingsClient: PiSettingsClient {
    get { self[PiSettingsClient.self] }
    set { self[PiSettingsClient.self] = newValue }
  }
}
