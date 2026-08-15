import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

@MainActor
struct SupatermHostControllerConfigurationTests {
  @Test
  func socketOverrideConnectsAsAppWithoutStartingDefaultService() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    var connectedSocket: URL?
    var connectedRole: SupatermHostClientRole?
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "  /tmp/supaterm-test.sock  "],
      registerService: {
        Issue.record("service registration should be skipped")
        return .enabled
      },
      paths: {
        Issue.record("default paths should not be resolved")
        throw SupatermHostControllerTestError.unexpectedRequest
      },
      connect: { socket, role in
        connectedSocket = socket
        connectedRole = role
        return hostConnection(identity: identity)
      }
    )

    #expect(try await controller.identity() == identity)
    #expect(connectedSocket?.path == "/tmp/supaterm-test.sock")
    #expect(connectedRole == .app)
  }

  @Test
  func socketOverrideBypassesInstalledServiceRootGuard() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    var connections = 0
    let controller = SupatermHostController(
      environment: [
        SupatermHostEnvironment.socketPathKey: "/tmp/supaterm-test.sock",
        SupatermCLIEnvironment.stateHomeKey: "/tmp/custom-state",
        "XDG_RUNTIME_DIR": "/tmp/custom-runtime",
        "HOME": "/tmp/custom-home",
        "TMPDIR": "/tmp/custom-temporary",
      ],
      registerService: {
        Issue.record("service registration should be skipped")
        return .enabled
      },
      paths: {
        Issue.record("default paths should not be resolved")
        throw SupatermHostControllerTestError.unexpectedRequest
      },
      connect: { _, _ in
        connections += 1
        return hostConnection(identity: identity)
      }
    )

    #expect(try await controller.identity() == identity)
    #expect(connections == 1)
  }

  @Test
  func installedServiceRejectsStateHomeBeforePathResolution() async throws {
    let controller = installedServiceRootGuardController(
      environment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/custom-state"]
    )

    await #expect(
      throws: SupatermHostControllerError.unsupportedServiceRoot(.stateHome)
    ) {
      try await controller.identity()
    }
  }

  @Test
  func installedServiceRejectsXDGRuntimeDirectoryBeforePathResolution() async throws {
    let controller = installedServiceRootGuardController(
      environment: ["XDG_RUNTIME_DIR": "/tmp/custom-runtime"]
    )

    await #expect(
      throws: SupatermHostControllerError.unsupportedServiceRoot(.runtimeDirectory)
    ) {
      try await controller.identity()
    }
  }

  @Test
  func installedServiceRejectsDifferentHomeBeforePathResolution() async throws {
    let controller = installedServiceRootGuardController(
      environment: ["HOME": "/tmp/custom-home"]
    )

    await #expect(
      throws: SupatermHostControllerError.unsupportedServiceRoot(.homeDirectory)
    ) {
      try await controller.identity()
    }
  }

  @Test
  func installedServiceRejectsDifferentTemporaryDirectoryBeforePathResolution() async throws {
    let controller = installedServiceRootGuardController(
      environment: ["TMPDIR": "/tmp/custom-temporary"]
    )

    await #expect(
      throws: SupatermHostControllerError.unsupportedServiceRoot(.temporaryDirectory)
    ) {
      try await controller.identity()
    }
  }

  @Test
  func installedServiceUsesMatchingHomeAndLaunchdTemporaryDirectory() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let environment = [
      "HOME": NSHomeDirectory() + "/.",
      "TMPDIR": NSTemporaryDirectory(),
    ]
    let expectedPaths = try SupatermHostPaths(
      homeDirectoryPath: NSHomeDirectory(),
      environment: environment
    )
    var registered = false
    var connectedSocket: URL?
    let controller = SupatermHostController(
      environment: environment,
      registerService: {
        registered = true
        return .enabled
      },
      connect: { socket, _ in
        connectedSocket = socket
        return hostConnection(identity: identity)
      }
    )

    #expect(try await controller.identity() == identity)
    #expect(registered)
    #expect(connectedSocket == expectedPaths.socket.standardizedFileURL)
  }

  @Test
  func installedServiceDerivesLaunchdTemporaryDirectoryWhenMissing() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let expectedPaths = try SupatermHostPaths(
      homeDirectoryPath: NSHomeDirectory(),
      environment: ["TMPDIR": NSTemporaryDirectory()]
    )
    var connectedSocket: URL?
    let controller = SupatermHostController(
      environment: ["HOME": NSHomeDirectory()],
      registerService: { .enabled },
      connect: { socket, _ in
        connectedSocket = socket
        return hostConnection(identity: identity)
      }
    )

    #expect(try await controller.identity() == identity)
    #expect(connectedSocket == expectedPaths.socket.standardizedFileURL)
  }

  @Test
  func installedServiceFallsBackToTmpWhenTemporaryDirectoryIsUnavailable() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let expectedPaths = try SupatermHostPaths(
      homeDirectoryPath: NSHomeDirectory(),
      environment: ["TMPDIR": "/tmp"]
    )
    var connectedSocket: URL?
    let controller = SupatermHostController(
      environment: ["HOME": NSHomeDirectory()],
      registerService: { .enabled },
      connect: { socket, _ in
        connectedSocket = socket
        return hostConnection(identity: identity)
      },
      installedServiceTemporaryDirectory: { nil }
    )

    #expect(try await controller.identity() == identity)
    #expect(connectedSocket == expectedPaths.socket.standardizedFileURL)
  }

  @Test
  func defaultPathRegistersServiceBeforeConnecting() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let paths = try SupatermHostPaths(
      homeDirectoryPath: "/Users/test",
      environment: [:],
      runtimeBase: URL(fileURLWithPath: "/tmp/supaterm-runtime", isDirectory: true),
      userID: 501
    )
    var events: [String] = []
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "  \n"],
      registerService: {
        events.append("service")
        return .enabled
      },
      paths: {
        events.append("path")
        return paths
      },
      connect: { socket, _ in
        events.append("connect:\(socket.path)")
        return hostConnection(identity: identity)
      }
    )

    #expect(try await controller.identity() == identity)
    #expect(events == ["path", "service", "connect:\(paths.socket.path)"])
  }

  @Test
  func defaultPathFailureStopsBeforeServiceRegistration() async throws {
    var events: [String] = []
    let controller = SupatermHostController(
      environment: [:],
      registerService: {
        events.append("service")
        return .enabled
      },
      paths: {
        events.append("path")
        throw SupatermHostPathsError.homeDirectoryNotSet
      },
      connect: { _, _ in
        events.append("connect")
        throw SupatermHostControllerTestError.unexpectedRequest
      }
    )

    await #expect(throws: SupatermHostPathsError.homeDirectoryNotSet) {
      try await controller.identity()
    }
    #expect(events == ["path"])
  }

  @Test
  func defaultConnectionRetriesWhileServiceStarts() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let retryPolicy = try #require(
      SupatermHostConnectionRetryPolicy(attempts: 3, delay: .milliseconds(25))
    )
    var attempts = 0
    var delays: [Duration] = []
    let controller = SupatermHostController(
      environment: [:],
      registerService: { .registered },
      connect: { _, _ in
        attempts += 1
        guard attempts == 3 else {
          throw SupatermHostSocketSecurityError.missing("/tmp/host.sock")
        }
        return hostConnection(identity: identity)
      },
      sleep: { delays.append($0) },
      retryPolicy: retryPolicy
    )

    #expect(try await controller.identity() == identity)
    #expect(attempts == 3)
    #expect(delays == [.milliseconds(25), .milliseconds(25)])
  }

  @Test
  func defaultConnectionStopsAtRetryBound() async throws {
    let retryPolicy = try #require(
      SupatermHostConnectionRetryPolicy(attempts: 3, delay: .milliseconds(25))
    )
    let failure = SupatermHostSocketSecurityError.missing("/tmp/host.sock")
    var attempts = 0
    var delays = 0
    let controller = SupatermHostController(
      environment: [:],
      registerService: { .registered },
      connect: { _, _ in
        attempts += 1
        throw failure
      },
      sleep: { _ in delays += 1 },
      retryPolicy: retryPolicy
    )

    await #expect(throws: failure) {
      try await controller.identity()
    }
    #expect(attempts == 3)
    #expect(delays == 2)
  }

  @Test
  func protocolFailureIsNotRetried() async throws {
    let retryPolicy = try #require(
      SupatermHostConnectionRetryPolicy(attempts: 3, delay: .milliseconds(25))
    )
    let failure = SupatermHostConnectionError.protocolViolation("host epoch mismatch")
    var attempts = 0
    var delays = 0
    let controller = SupatermHostController(
      environment: [:],
      registerService: { .enabled },
      connect: { _, _ in
        attempts += 1
        throw failure
      },
      sleep: { _ in delays += 1 },
      retryPolicy: retryPolicy
    )

    await #expect(throws: failure) {
      try await controller.identity()
    }
    #expect(attempts == 1)
    #expect(delays == 0)
  }

  @Test
  func refusedConnectionRetriesWhileServiceStarts() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let retryPolicy = try #require(
      SupatermHostConnectionRetryPolicy(attempts: 2, delay: .milliseconds(10))
    )
    var attempts = 0
    var delays: [Duration] = []
    let controller = SupatermHostController(
      environment: [:],
      registerService: { .enabled },
      connect: { _, _ in
        attempts += 1
        guard attempts == 2 else {
          throw SupatermHostConnectionError.transport(.posix(.ECONNREFUSED))
        }
        return hostConnection(identity: identity)
      },
      sleep: { delays.append($0) },
      retryPolicy: retryPolicy
    )

    #expect(try await controller.identity() == identity)
    #expect(attempts == 2)
    #expect(delays == [.milliseconds(10)])
  }

  @Test
  func vanishedSocketRetriesWhileServiceStarts() async throws {
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let retryPolicy = try #require(
      SupatermHostConnectionRetryPolicy(attempts: 2, delay: .milliseconds(10))
    )
    var attempts = 0
    let controller = SupatermHostController(
      environment: [:],
      registerService: { .enabled },
      connect: { _, _ in
        attempts += 1
        guard attempts == 2 else {
          throw SupatermHostConnectionError.transport(.posix(.ENOENT))
        }
        return hostConnection(identity: identity)
      },
      sleep: { _ in },
      retryPolicy: retryPolicy
    )

    #expect(try await controller.identity() == identity)
    #expect(attempts == 2)
  }

  @Test
  func sameOwnerPermissionWindowsRetryWhileServiceStarts() async throws {
    let retryPolicy = try #require(
      SupatermHostConnectionRetryPolicy(attempts: 3, delay: .milliseconds(25))
    )
    let identity = SupatermHostIdentity(machineID: MachineID(), bootID: BootID())
    let failures = [
      SupatermHostSocketSecurityError.runtimeRootPermissions(
        "/tmp/supaterm",
        0o755
      ),
      SupatermHostSocketSecurityError.socketPermissions(
        "/tmp/supaterm/host.sock",
        0o755
      ),
    ]
    var attempts = 0
    var delays: [Duration] = []
    let controller = SupatermHostController(
      environment: [:],
      registerService: { .enabled },
      connect: { _, _ in
        attempts += 1
        guard attempts > failures.count else {
          throw failures[attempts - 1]
        }
        return hostConnection(identity: identity)
      },
      sleep: { delays.append($0) },
      retryPolicy: retryPolicy
    )

    #expect(try await controller.identity() == identity)
    #expect(attempts == 3)
    #expect(delays == [.milliseconds(25), .milliseconds(25)])
  }

  @Test(
    arguments: [
      SupatermHostSocketSecurityError.runtimeRootOwner(
        "/tmp/supaterm",
        expected: 501,
        actual: 502
      ),
      SupatermHostSocketSecurityError.notSocket("/tmp/supaterm/host.sock"),
    ]
  )
  func wrongOwnerAndTypeFailuresAreNotRetried(
    failure: SupatermHostSocketSecurityError
  ) async throws {
    let retryPolicy = try #require(
      SupatermHostConnectionRetryPolicy(attempts: 3, delay: .milliseconds(25))
    )
    var attempts = 0
    let controller = SupatermHostController(
      environment: [:],
      registerService: { .enabled },
      connect: { _, _ in
        attempts += 1
        throw failure
      },
      sleep: { _ in Issue.record("terminal security failure should not sleep") },
      retryPolicy: retryPolicy
    )

    await #expect(throws: failure) {
      try await controller.identity()
    }
    #expect(attempts == 1)
  }

  @Test
  func connectionConfigurationFailureIsNotRetried() async throws {
    let retryPolicy = try #require(
      SupatermHostConnectionRetryPolicy(attempts: 3, delay: .milliseconds(25))
    )
    let failure = SupatermHostConnectionError.invalidRequestCapacity(0)
    var attempts = 0
    let controller = SupatermHostController(
      environment: [:],
      registerService: { .enabled },
      connect: { _, _ in
        attempts += 1
        throw failure
      },
      sleep: { _ in Issue.record("configuration failure should not sleep") },
      retryPolicy: retryPolicy
    )

    await #expect(throws: failure) {
      try await controller.identity()
    }
    #expect(attempts == 1)
  }

  @Test
  func cancellationReturnsWhileControllerOwnsStartupRetry() async throws {
    let retryPolicy = try #require(
      SupatermHostConnectionRetryPolicy(attempts: 2, delay: .milliseconds(25))
    )
    let gate = HostConnectionGate()
    let (sleeps, sleepsContinuation) = AsyncStream.makeStream(of: Void.self)
    var sleepsIterator = sleeps.makeAsyncIterator()
    let (connectionAttempts, connectionAttemptsContinuation) = AsyncStream.makeStream(
      of: Void.self
    )
    var connectionAttemptsIterator = connectionAttempts.makeAsyncIterator()
    var attempts = 0
    let controller = SupatermHostController(
      environment: [:],
      registerService: { .enabled },
      connect: { _, _ in
        attempts += 1
        connectionAttemptsContinuation.yield()
        throw SupatermHostSocketSecurityError.missing("/tmp/host.sock")
      },
      sleep: { _ in
        sleepsContinuation.yield()
        await gate.wait()
      },
      retryPolicy: retryPolicy
    )
    let task = Task { try await controller.identity() }
    _ = await connectionAttemptsIterator.next()
    _ = await sleepsIterator.next()

    task.cancel()

    await #expect(throws: CancellationError.self) {
      try await task.value
    }
    #expect(attempts == 1)
    await gate.open()
    _ = await connectionAttemptsIterator.next()
    #expect(attempts == 2)
  }

  @Test
  func retryPolicyRejectsNonpositiveAttemptCounts() {
    #expect(SupatermHostConnectionRetryPolicy(attempts: 0, delay: .zero) == nil)
    #expect(SupatermHostConnectionRetryPolicy(attempts: -1, delay: .zero) == nil)
    #expect(
      SupatermHostConnectionRetryPolicy(attempts: 1, delay: .milliseconds(-1)) == nil
    )
  }

  @Test
  func serviceApprovalStopsBeforeConnection() async throws {
    var connections = 0
    let controller = SupatermHostController(
      environment: [:],
      registerService: { .requiresApproval },
      connect: { _, _ in
        connections += 1
        throw SupatermHostControllerTestError.unexpectedRequest
      }
    )

    await #expect(throws: SupatermHostControllerError.serviceRequiresApproval) {
      try await controller.identity()
    }
    #expect(connections == 0)
  }

  @Test
  func relativeSocketOverrideIsRejectedBeforeConnection() async throws {
    var connections = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "var/run/host.sock"],
      connect: { _, _ in
        connections += 1
        throw SupatermHostControllerTestError.unexpectedRequest
      }
    )

    await #expect(
      throws: SupatermHostControllerError.relativeSocketOverride("var/run/host.sock")
    ) {
      try await controller.identity()
    }
    #expect(connections == 0)
  }

  @Test
  func socketOverrideFailureIsNotRetried() async throws {
    let retryPolicy = try #require(
      SupatermHostConnectionRetryPolicy(attempts: 3, delay: .milliseconds(25))
    )
    let failure = SupatermHostSocketSecurityError.missing("/tmp/host.sock")
    var attempts = 0
    let controller = SupatermHostController(
      environment: [SupatermHostEnvironment.socketPathKey: "/tmp/host.sock"],
      connect: { _, _ in
        attempts += 1
        throw failure
      },
      sleep: { _ in Issue.record("socket override failure should not sleep") },
      retryPolicy: retryPolicy
    )

    await #expect(throws: failure) {
      try await controller.identity()
    }
    #expect(attempts == 1)
  }

}
