import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

@MainActor
func installedServiceRootGuardController(
  environment: [String: String]
) -> SupatermHostController {
  SupatermHostController(
    environment: environment,
    registerService: {
      Issue.record("service registration should not run")
      return .enabled
    },
    paths: {
      Issue.record("default paths should not be resolved")
      throw SupatermHostControllerTestError.unexpectedRequest
    },
    connect: { _, _ in
      Issue.record("connection should not start")
      throw SupatermHostControllerTestError.unexpectedRequest
    }
  )
}

@MainActor
func hostConnection(
  identity: SupatermHostIdentity,
  identityRequest: (@MainActor @Sendable () async throws -> SupatermHostIdentity)? = nil,
  reserve:
    @escaping @MainActor @Sendable (
      LaunchTicketID,
      TerminalID,
      SupatermHostTerminalSize,
      String,
      SupatermHostStartupInputDelivery
    ) async throws -> Void = { _, _, _, _, _ in
      throw SupatermHostControllerTestError.unexpectedRequest
    },
  cancelReservation:
    @escaping @MainActor @Sendable (
      LaunchTicketID,
      TerminalID
    ) async throws -> Void = { _, _ in
      throw SupatermHostControllerTestError.unexpectedRequest
    },
  get:
    @escaping @MainActor @Sendable (
      TerminalID
    ) async throws -> SupatermHostTerminalInfo = { _ in
      throw SupatermHostControllerTestError.unexpectedRequest
    },
  list: @escaping @MainActor @Sendable () async throws -> [SupatermHostTerminalInfo] = {
    throw SupatermHostControllerTestError.unexpectedRequest
  },
  end: @escaping @MainActor @Sendable (TerminalID) async throws -> Void = { _ in
    throw SupatermHostControllerTestError.unexpectedRequest
  },
  close: @escaping @MainActor @Sendable () async -> Void = {}
) -> SupatermHostController.Connection {
  SupatermHostController.Connection(
    identity: identityRequest ?? { identity },
    reserve: reserve,
    cancelReservation: cancelReservation,
    get: get,
    list: list,
    end: end,
    close: close
  )
}

func hostTerminal(
  id: TerminalID,
  bootID: BootID,
  size: SupatermHostTerminalSize = SupatermHostTerminalSize(),
  status: SupatermHostTerminalStatus = .running
) -> SupatermHostTerminalInfo {
  SupatermHostTerminalInfo(
    id: id,
    bootID: bootID,
    argv: ["/bin/zsh"],
    cwd: "/tmp",
    size: size,
    status: status,
    inputState: .ready
  )
}

enum SupatermHostControllerTestError: Error {
  case unexpectedRequest
}

actor HostConnectionGate {
  private var isOpen = false
  private var waiters: [CheckedContinuation<Void, Never>] = []

  func wait() async {
    guard !isOpen else { return }
    await withCheckedContinuation { continuation in
      waiters.append(continuation)
    }
  }

  func open() {
    isOpen = true
    let waiters = self.waiters
    self.waiters.removeAll()
    for waiter in waiters {
      waiter.resume()
    }
  }
}
