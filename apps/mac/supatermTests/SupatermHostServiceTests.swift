import Foundation
import ServiceManagement
import SupatermCLIShared
import Testing

@testable import supaterm

struct SupatermHostServiceTests {
  @Test
  func socketOverrideSkipsServiceLookup() throws {
    var serviceLookups = 0
    let service = SupatermHostService(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/e2e-host.sock"],
      makeRegistration: {
        serviceLookups += 1
        return registration(status: { .notRegistered })
      }
    )

    #expect(try service.registerIfNeeded() == .skippedForSocketOverride)
    #expect(serviceLookups == 0)
  }

  @Test
  func emptySocketOverrideDoesNotSkipRegistration() throws {
    var status = SMAppService.Status.notRegistered
    let service = SupatermHostService(
      environment: [SupatermHostEnvironment.socketPathKey: "  "],
      makeRegistration: {
        registration(
          status: { status },
          register: {
            status = .enabled
          }
        )
      }
    )

    #expect(try service.registerIfNeeded() == .registered)
  }

  @Test
  func notRegisteredServiceRegistersOnce() throws {
    var status = SMAppService.Status.notRegistered
    let service = SupatermHostService(
      environment: [:],
      makeRegistration: {
        registration(
          status: { status },
          register: {
            status = .enabled
          }
        )
      }
    )

    #expect(try service.registerIfNeeded() == .registered)
  }

  @Test
  func enabledServiceIsNotRegisteredAgain() throws {
    let service = SupatermHostService(
      environment: [:],
      makeRegistration: {
        registration(
          status: { .enabled },
          register: { throw SupatermHostServiceTestError.unexpectedRegistration }
        )
      }
    )

    #expect(try service.registerIfNeeded() == .enabled)
  }

  @Test
  func approvalStateDoesNotRegisterAgain() throws {
    let service = SupatermHostService(
      environment: [:],
      makeRegistration: {
        registration(
          status: { .requiresApproval },
          register: { throw SupatermHostServiceTestError.unexpectedRegistration }
        )
      }
    )

    #expect(try service.registerIfNeeded() == .requiresApproval)
  }

  @Test
  func registrationCanFinishAwaitingApproval() throws {
    var status = SMAppService.Status.notRegistered
    let service = SupatermHostService(
      environment: [:],
      makeRegistration: {
        registration(
          status: { status },
          register: { status = .requiresApproval }
        )
      }
    )

    #expect(try service.registerIfNeeded() == .requiresApproval)
  }

  @Test
  func registrationDeniedByUserRequiresApproval() throws {
    var status = SMAppService.Status.notRegistered
    let service = SupatermHostService(
      environment: [:],
      makeRegistration: {
        registration(
          status: { status },
          register: {
            status = .requiresApproval
            throw NSError(
              domain: SMAppServiceErrorDomain,
              code: Int(kSMErrorLaunchDeniedByUser)
            )
          }
        )
      }
    )

    #expect(try service.registerIfNeeded() == .requiresApproval)
  }

  @Test
  func registrationRaceUsesRegisteredServiceStatus() throws {
    var status = SMAppService.Status.notRegistered
    let service = SupatermHostService(
      environment: [:],
      makeRegistration: {
        registration(
          status: { status },
          register: {
            status = .enabled
            throw NSError(
              domain: SMAppServiceErrorDomain,
              code: Int(kSMErrorAlreadyRegistered)
            )
          }
        )
      }
    )

    #expect(try service.registerIfNeeded() == .enabled)
  }

  @Test
  func missingServiceFailsWithoutRegistration() {
    let service = SupatermHostService(
      environment: [:],
      makeRegistration: {
        registration(
          status: { .notFound },
          register: { throw SupatermHostServiceTestError.unexpectedRegistration }
        )
      }
    )

    #expect(throws: SupatermHostServiceError.serviceNotFound) {
      try service.registerIfNeeded()
    }
  }

  @Test
  func registrationErrorIsPreserved() {
    let service = SupatermHostService(
      environment: [:],
      makeRegistration: {
        registration(
          status: { .notRegistered },
          register: { throw SupatermHostServiceTestError.registrationFailed }
        )
      }
    )

    #expect(throws: SupatermHostServiceTestError.registrationFailed) {
      try service.registerIfNeeded()
    }
  }

  @Test
  func incompleteRegistrationFailsWithFinalStatus() {
    let service = SupatermHostService(
      environment: [:],
      makeRegistration: {
        registration(status: { .notRegistered })
      }
    )

    #expect(
      throws: SupatermHostServiceError.registrationDidNotComplete(
        status: SMAppService.Status.notRegistered.rawValue
      )
    ) {
      try service.registerIfNeeded()
    }
  }
}

private enum SupatermHostServiceTestError: Error {
  case registrationFailed
  case unexpectedRegistration
}

private func registration(
  status: @escaping () -> SMAppService.Status,
  register: @escaping () throws -> Void = {}
) -> SupatermHostService.Registration {
  SupatermHostService.Registration(status: status, register: register)
}
