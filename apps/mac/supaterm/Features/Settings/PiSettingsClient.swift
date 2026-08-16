import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSupport

struct PiSettingsClient: Sendable {
  var integrationHealth: @Sendable () async throws -> CodingAgentIntegrationHealth
  var installSupatermIntegration: @Sendable () async throws -> Void
  var removeSupatermIntegration: @Sendable () async throws -> Void
}

extension PiSettingsClient: DependencyKey {
  static let liveValue = Self(
    integrationHealth: {
      try PiSettingsInstaller().integrationHealth()
    },
    installSupatermIntegration: {
      try PiSettingsInstaller().installSupatermPackage()
    },
    removeSupatermIntegration: {
      try PiSettingsInstaller().removeSupatermPackage()
    }
  )

  static let testValue = Self(
    integrationHealth: unimplemented("PiSettingsClient.integrationHealth"),
    installSupatermIntegration: unimplemented("PiSettingsClient.installSupatermIntegration"),
    removeSupatermIntegration: unimplemented("PiSettingsClient.removeSupatermIntegration")
  )
}

extension DependencyValues {
  var piSettingsClient: PiSettingsClient {
    get { self[PiSettingsClient.self] }
    set { self[PiSettingsClient.self] = newValue }
  }
}
