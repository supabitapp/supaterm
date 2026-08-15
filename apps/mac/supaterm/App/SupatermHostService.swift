import Foundation
import ServiceManagement
import SupatermCLIShared

enum SupatermHostServiceRegistrationResult: Equatable {
  case skippedForSocketOverride
  case registered
  case enabled
  case requiresApproval
}

enum SupatermHostServiceError: Error, Equatable, LocalizedError {
  case serviceNotFound
  case registrationDidNotComplete(status: Int)

  var errorDescription: String? {
    switch self {
    case .serviceNotFound:
      "The bundled Supaterm host service was not found."
    case .registrationDidNotComplete(let status):
      "The Supaterm host service registration ended with status \(status)."
    }
  }
}

struct SupatermHostService {
  static let plistName = "app.supabit.supaterm.host.plist"

  struct Registration {
    let status: () -> SMAppService.Status
    let register: () throws -> Void
  }

  private let environment: [String: String]
  private let makeRegistration: @MainActor () -> Registration

  init(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    makeRegistration: @escaping @MainActor () -> Registration = Self.liveRegistration
  ) {
    self.environment = environment
    self.makeRegistration = makeRegistration
  }

  func registerIfNeeded() throws -> SupatermHostServiceRegistrationResult {
    if let socketPath = environment[SupatermHostEnvironment.socketPathKey],
      !socketPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    {
      return .skippedForSocketOverride
    }

    let registration = makeRegistration()
    let status = registration.status()
    switch status {
    case .notRegistered:
      return try register(registration)
    case .enabled:
      return .enabled
    case .requiresApproval:
      return .requiresApproval
    case .notFound:
      throw SupatermHostServiceError.serviceNotFound
    @unknown default:
      throw SupatermHostServiceError.registrationDidNotComplete(
        status: status.rawValue
      )
    }
  }

  private func register(
    _ registration: Registration
  ) throws -> SupatermHostServiceRegistrationResult {
    do {
      try registration.register()
    } catch {
      let serviceError = error as NSError
      guard serviceError.domain == SMAppServiceErrorDomain else {
        throw error
      }
      switch serviceError.code {
      case Int(kSMErrorLaunchDeniedByUser):
        return .requiresApproval
      case Int(kSMErrorAlreadyRegistered):
        return try result(
          for: registration.status(),
          enabledResult: .enabled,
          unresolvedError: error
        )
      default:
        throw error
      }
    }
    let status = registration.status()
    return try result(
      for: status,
      enabledResult: .registered,
      unresolvedError: SupatermHostServiceError.registrationDidNotComplete(
        status: status.rawValue
      )
    )
  }

  private func result(
    for status: SMAppService.Status,
    enabledResult: SupatermHostServiceRegistrationResult,
    unresolvedError: any Error
  ) throws -> SupatermHostServiceRegistrationResult {
    switch status {
    case .enabled:
      return enabledResult
    case .requiresApproval:
      return .requiresApproval
    case .notFound:
      throw SupatermHostServiceError.serviceNotFound
    case .notRegistered:
      throw unresolvedError
    @unknown default:
      throw unresolvedError
    }
  }

  private static func liveRegistration() -> Registration {
    let service = SMAppService.agent(plistName: plistName)
    return Registration(
      status: { service.status },
      register: { try service.register() }
    )
  }
}
