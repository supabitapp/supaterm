import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct SupatermSkillClient: Sendable {
  var installSupatermSkill: @Sendable () async throws -> Void
}

extension SupatermSkillClient: DependencyKey {
  static let liveValue = Self(
    installSupatermSkill: {
      try SupatermSkills().install()
    }
  )

  static let testValue = Self(
    installSupatermSkill: {}
  )
}

extension DependencyValues {
  var supatermSkillClient: SupatermSkillClient {
    get { self[SupatermSkillClient.self] }
    set { self[SupatermSkillClient.self] = newValue }
  }
}
