import Darwin
import Foundation
import SupatermCLIShared

nonisolated struct SupatermHostOperation<Value: Sendable>: Sendable {
  let identity: SupatermHostIdentity
  let value: Value
}

extension SupatermHostOperation: Equatable where Value: Equatable {}

nonisolated enum SupatermHostServiceRoot: Equatable, Sendable {
  case stateHome
  case runtimeDirectory
  case homeDirectory
  case temporaryDirectory
}

nonisolated enum SupatermHostControllerError: Error, Equatable, Sendable {
  case hostRestarted(previous: BootID, current: BootID)
  case machineMismatch(expected: MachineID, actual: MachineID)
  case relativeSocketOverride(String)
  case serviceRequiresApproval
  case unsupportedServiceRoot(SupatermHostServiceRoot)
}

nonisolated struct SupatermHostConnectionRetryPolicy: Equatable, Sendable {
  static let live = Self(validatedAttempts: 20, delay: .milliseconds(50))

  let attempts: Int
  let delay: Duration

  init?(attempts: Int, delay: Duration) {
    guard attempts > 0, delay >= .zero else { return nil }
    self.attempts = attempts
    self.delay = delay
  }

  private init(validatedAttempts: Int, delay: Duration) {
    attempts = validatedAttempts
    self.delay = delay
  }
}

@MainActor
final class SupatermHostController {
  struct Connection: Sendable {
    let identity: @MainActor @Sendable () async throws -> SupatermHostIdentity
    let reserve:
      @MainActor @Sendable (
        LaunchTicketID,
        TerminalID,
        SupatermHostTerminalSize,
        String,
        SupatermHostStartupInputDelivery
      ) async throws -> Void
    let cancelReservation: @MainActor @Sendable (LaunchTicketID, TerminalID) async throws -> Void
    let get: @MainActor @Sendable (TerminalID) async throws -> SupatermHostTerminalInfo
    let list: @MainActor @Sendable () async throws -> [SupatermHostTerminalInfo]
    let end: @MainActor @Sendable (TerminalID) async throws -> Void
    let close: @MainActor @Sendable () async -> Void
  }

  private struct EstablishedConnection: Sendable {
    let id: UUID
    let connection: Connection
    let identity: SupatermHostIdentity
  }

  private struct BootTransition: Sendable {
    let previous: BootID
    let current: BootID
  }

  private struct ReservationCleanup: Sendable {
    let launchTicketID: LaunchTicketID
    let terminalID: TerminalID
    let identity: SupatermHostIdentity
  }

  private struct ConnectionEstablishment: Sendable {
    let connection: EstablishedConnection
    let bootTransition: BootTransition?
  }

  typealias Connect =
    @MainActor @Sendable (
      _ socket: URL,
      _ role: SupatermHostClientRole
    ) async throws -> Connection

  typealias Sleep = @MainActor @Sendable (_ duration: Duration) async throws -> Void

  private let connect: Connect
  private let connectionWaiterDidRegister: @MainActor @Sendable () -> Void
  private let paths: @MainActor @Sendable () throws -> SupatermHostPaths
  private let registerService: @MainActor @Sendable () throws -> SupatermHostServiceRegistrationResult
  private let reservationCleanupDidFinish: @MainActor @Sendable () -> Void
  private let retryPolicy: SupatermHostConnectionRetryPolicy
  private let serviceRootOverride: SupatermHostServiceRoot?
  private let sleep: Sleep
  private let socketOverride: String?
  private var connectionTask: Task<Void, Never>?
  private var connectionWaiters: [UUID: CheckedContinuation<Void, any Error>] = [:]
  private var establishedConnection: EstablishedConnection?
  private var lastIdentity: SupatermHostIdentity?
  private var pendingBootTransition: BootTransition?
  private var reservationCleanupTask: Task<Void, Never>?
  private var reservationCleanups: [ReservationCleanup] = []

  init(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    registerService: (
      @MainActor @Sendable () throws -> SupatermHostServiceRegistrationResult
    )? = nil,
    paths: (@MainActor @Sendable () throws -> SupatermHostPaths)? = nil,
    connect: Connect? = nil,
    sleep: @escaping Sleep = { try await Task.sleep(for: $0) },
    retryPolicy: SupatermHostConnectionRetryPolicy = .live,
    installedServiceTemporaryDirectory: @escaping @MainActor @Sendable () -> String? = {
      SupatermHostController.launchdTemporaryDirectoryPath()
    },
    connectionWaiterDidRegister: @escaping @MainActor @Sendable () -> Void = {},
    reservationCleanupDidFinish: @escaping @MainActor @Sendable () -> Void = {}
  ) {
    let socketOverride = environment[SupatermHostEnvironment.socketPathKey]?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedSocketOverride = socketOverride?.isEmpty == false ? socketOverride : nil
    let launchdTemporaryDirectory: String?
    if resolvedSocketOverride == nil {
      launchdTemporaryDirectory = installedServiceTemporaryDirectory() ?? "/tmp"
    } else {
      launchdTemporaryDirectory = nil
    }
    let installedServiceEnvironment: [String: String]
    if let launchdTemporaryDirectory {
      var resolvedEnvironment = environment
      resolvedEnvironment["TMPDIR"] = launchdTemporaryDirectory
      installedServiceEnvironment = resolvedEnvironment
    } else {
      installedServiceEnvironment = environment
    }
    self.registerService =
      registerService ?? {
        try SupatermHostService(environment: environment).registerIfNeeded()
      }
    self.paths =
      paths ?? {
        try SupatermHostPaths(
          homeDirectoryPath: NSHomeDirectory(),
          environment: installedServiceEnvironment
        )
      }
    self.connect = connect ?? Self.liveConnection
    self.connectionWaiterDidRegister = connectionWaiterDidRegister
    self.reservationCleanupDidFinish = reservationCleanupDidFinish
    self.sleep = sleep
    self.retryPolicy = retryPolicy
    self.socketOverride = resolvedSocketOverride
    serviceRootOverride =
      if let launchdTemporaryDirectory {
        Self.installedServiceRootOverride(
          in: environment,
          launchdTemporaryDirectory: launchdTemporaryDirectory
        )
      } else {
        nil
      }
  }

  func identity() async throws -> SupatermHostIdentity {
    let establishedConnection = try await connection()
    try Task.checkCancellation()
    do {
      let identity = try await establishedConnection.connection.identity()
      guard identity.machineID == establishedConnection.identity.machineID else {
        await invalidate(establishedConnection)
        throw SupatermHostControllerError.machineMismatch(
          expected: establishedConnection.identity.machineID,
          actual: identity.machineID
        )
      }
      guard identity.bootID == establishedConnection.identity.bootID else {
        let previousIdentity = lastIdentity ?? establishedConnection.identity
        lastIdentity = identity
        await invalidate(establishedConnection)
        if previousIdentity.bootID != identity.bootID {
          throw SupatermHostControllerError.hostRestarted(
            previous: previousIdentity.bootID,
            current: identity.bootID
          )
        }
        return identity
      }
      return identity
    } catch {
      if Self.invalidatesConnection(error) {
        await invalidate(establishedConnection)
      }
      throw error
    }
  }

  func reserve(
    terminalID: TerminalID,
    size: SupatermHostTerminalSize = SupatermHostTerminalSize(),
    startupInput: String,
    startupInputDelivery: SupatermHostStartupInputDelivery
  ) async throws -> SupatermHostOperation<LaunchTicketID> {
    let launchTicketID = LaunchTicketID()
    var requestBegan = false
    var reservationIdentity: SupatermHostIdentity?
    do {
      let retryIdentity: SupatermHostIdentity
      do {
        return try await perform { connection, identity in
          requestBegan = true
          reservationIdentity = identity
          try await connection.reserve(
            launchTicketID,
            terminalID,
            size,
            startupInput,
            startupInputDelivery
          )
          try Task.checkCancellation()
          return launchTicketID
        }
      } catch {
        guard
          requestBegan,
          let reservationIdentity,
          Self.retriesUncertainReservation(error)
        else {
          throw error
        }
        retryIdentity = reservationIdentity
      }
      try Task.checkCancellation()
      return try await perform { connection, identity in
        try Self.validateReservationIdentity(
          retryIdentity,
          current: identity
        )
        try await connection.reserve(
          launchTicketID,
          terminalID,
          size,
          startupInput,
          startupInputDelivery
        )
        try Task.checkCancellation()
        return launchTicketID
      }
    } catch {
      if requestBegan, let reservationIdentity {
        startReservationCleanup(
          launchTicketID: launchTicketID,
          terminalID: terminalID,
          identity: reservationIdentity
        )
      }
      if error is CancellationError {
        throw CancellationError()
      }
      throw error
    }
  }

  func get(
    _ reference: TerminalReference
  ) async throws -> SupatermHostOperation<SupatermHostTerminalInfo> {
    try await perform(reference: reference) { connection, _ in
      try await connection.get(reference.terminalID)
    }
  }

  func list() async throws -> SupatermHostOperation<[SupatermHostTerminalInfo]> {
    try await perform { connection, _ in
      try await connection.list()
    }
  }

  func end(_ reference: TerminalReference) async throws -> SupatermHostIdentity {
    let operation: SupatermHostOperation<Void> = try await perform(reference: reference) {
      connection, _ in
      try await connection.end(reference.terminalID)
    }
    return operation.identity
  }

  private func connection() async throws -> EstablishedConnection {
    while true {
      try Task.checkCancellation()
      if let establishedConnection {
        if let pendingBootTransition {
          self.pendingBootTransition = nil
          throw SupatermHostControllerError.hostRestarted(
            previous: pendingBootTransition.previous,
            current: pendingBootTransition.current
          )
        }
        return establishedConnection
      }
      if connectionTask == nil {
        startConnection()
      }
      try await waitForConnection()
    }
  }

  private func startConnection() {
    connectionTask = Task { @MainActor [weak self] in
      guard let self else { return }
      do {
        finishConnection(returning: try await establishConnection())
      } catch {
        finishConnection(throwing: error)
      }
    }
  }

  private func establishConnection() async throws -> ConnectionEstablishment {
    let connection = try await makeConnection()
    let identity: SupatermHostIdentity
    do {
      try Task.checkCancellation()
      identity = try await connection.identity()
      try Task.checkCancellation()
    } catch {
      await connection.close()
      throw error
    }
    let establishedConnection = EstablishedConnection(
      id: UUID(),
      connection: connection,
      identity: identity
    )
    let bootTransition: BootTransition?
    if let lastIdentity {
      guard lastIdentity.machineID == identity.machineID else {
        await connection.close()
        throw SupatermHostControllerError.machineMismatch(
          expected: lastIdentity.machineID,
          actual: identity.machineID
        )
      }
      if lastIdentity.bootID != identity.bootID {
        bootTransition = BootTransition(
          previous: lastIdentity.bootID,
          current: identity.bootID
        )
      } else {
        bootTransition = nil
      }
    } else {
      bootTransition = nil
    }
    return ConnectionEstablishment(
      connection: establishedConnection,
      bootTransition: bootTransition
    )
  }

  private func waitForConnection() async throws {
    let id = UUID()
    try await withTaskCancellationHandler {
      try Task.checkCancellation()
      try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<Void, any Error>) in
        if Task.isCancelled {
          continuation.resume(throwing: CancellationError())
        } else {
          connectionWaiters[id] = continuation
          connectionWaiterDidRegister()
        }
      }
    } onCancel: {
      Task { @MainActor [weak self] in
        self?.cancelConnectionWaiter(id)
      }
    }
  }

  private func cancelConnectionWaiter(_ id: UUID) {
    connectionWaiters.removeValue(forKey: id)?.resume(throwing: CancellationError())
  }

  private func finishConnection(returning result: ConnectionEstablishment) {
    connectionTask = nil
    establishedConnection = result.connection
    lastIdentity = result.connection.identity
    pendingBootTransition = result.bootTransition
    resumeConnectionWaiters()
  }

  private func finishConnection(throwing error: any Error) {
    connectionTask = nil
    resumeConnectionWaiters(throwing: error)
  }

  private func resumeConnectionWaiters() {
    let waiters = connectionWaiters.values
    connectionWaiters.removeAll()
    for waiter in waiters {
      waiter.resume()
    }
  }

  private func resumeConnectionWaiters(throwing error: any Error) {
    let waiters = connectionWaiters.values
    connectionWaiters.removeAll()
    for waiter in waiters {
      waiter.resume(throwing: error)
    }
  }

  private func perform<Value: Sendable>(
    reference: TerminalReference? = nil,
    _ operation:
      @MainActor @Sendable (
        Connection,
        SupatermHostIdentity
      ) async throws -> Value
  ) async throws -> SupatermHostOperation<Value> {
    let establishedConnection = try await connection()
    try Task.checkCancellation()
    if let reference {
      try validate(reference, for: establishedConnection.identity)
    }
    do {
      let value = try await operation(
        establishedConnection.connection,
        establishedConnection.identity
      )
      return SupatermHostOperation(
        identity: establishedConnection.identity,
        value: value
      )
    } catch {
      if Self.invalidatesConnection(error) {
        await invalidate(establishedConnection)
      }
      throw error
    }
  }

  private func invalidate(_ connection: EstablishedConnection) async {
    guard establishedConnection?.id == connection.id else { return }
    establishedConnection = nil
    await connection.connection.close()
  }

  private func startReservationCleanup(
    launchTicketID: LaunchTicketID,
    terminalID: TerminalID,
    identity: SupatermHostIdentity
  ) {
    reservationCleanups.append(
      ReservationCleanup(
        launchTicketID: launchTicketID,
        terminalID: terminalID,
        identity: identity
      )
    )
    guard reservationCleanupTask == nil else { return }
    reservationCleanupTask = Task { @MainActor [self] in
      await drainReservationCleanups()
    }
  }

  private func drainReservationCleanups() async {
    while !reservationCleanups.isEmpty {
      let cleanup = reservationCleanups.removeFirst()
      await cancelReservation(cleanup)
      reservationCleanupDidFinish()
    }
    reservationCleanupTask = nil
  }

  private func cancelReservation(_ cleanup: ReservationCleanup) async {
    var remainingReconnects = 1
    while true {
      let connection: EstablishedConnection
      do {
        guard let currentConnection = try await cleanupConnection() else { return }
        connection = currentConnection
      } catch {
        return
      }
      guard connection.identity == cleanup.identity else { return }
      do {
        try await connection.connection.cancelReservation(
          cleanup.launchTicketID,
          cleanup.terminalID
        )
        return
      } catch SupatermHostConnectionError.requestBufferOverflow {
        do {
          try await sleep(retryPolicy.delay)
        } catch {
          return
        }
      } catch {
        if Self.invalidatesConnection(error) {
          await invalidate(connection)
        }
        guard remainingReconnects > 0, Self.retriesUncertainCleanup(error) else {
          return
        }
        remainingReconnects -= 1
      }
    }
  }

  private func cleanupConnection() async throws -> EstablishedConnection? {
    while true {
      try Task.checkCancellation()
      if pendingBootTransition != nil {
        return nil
      }
      if let establishedConnection {
        return establishedConnection
      }
      if connectionTask == nil {
        startConnection()
      }
      try await waitForConnection()
    }
  }

  private func makeConnection() async throws -> Connection {
    try Task.checkCancellation()
    let socket: URL
    let attempts: Int
    if let path = socketOverride {
      guard NSString(string: path).isAbsolutePath else {
        throw SupatermHostControllerError.relativeSocketOverride(path)
      }
      socket = URL(fileURLWithPath: path)
      attempts = 1
    } else {
      if let serviceRootOverride {
        throw SupatermHostControllerError.unsupportedServiceRoot(serviceRootOverride)
      }
      socket = try paths().socket
      let registration = try registerService()
      guard registration != .requiresApproval else {
        throw SupatermHostControllerError.serviceRequiresApproval
      }
      attempts = retryPolicy.attempts
    }
    var remainingAttempts = attempts
    while true {
      try Task.checkCancellation()
      do {
        return try await connect(socket.standardizedFileURL, .app)
      } catch is CancellationError {
        throw CancellationError()
      } catch {
        remainingAttempts -= 1
        guard remainingAttempts > 0, Self.isStartupTransient(error) else { throw error }
        try await sleep(retryPolicy.delay)
      }
    }
  }

  private func validate(
    _ reference: TerminalReference,
    for identity: SupatermHostIdentity
  ) throws {
    guard reference.machineID == identity.machineID else {
      throw SupatermHostControllerError.machineMismatch(
        expected: identity.machineID,
        actual: reference.machineID
      )
    }
  }

  private static func validateReservationIdentity(
    _ expected: SupatermHostIdentity,
    current: SupatermHostIdentity
  ) throws {
    guard expected.machineID == current.machineID else {
      throw SupatermHostControllerError.machineMismatch(
        expected: expected.machineID,
        actual: current.machineID
      )
    }
    guard expected.bootID == current.bootID else {
      throw SupatermHostControllerError.hostRestarted(
        previous: expected.bootID,
        current: current.bootID
      )
    }
  }

  private static func invalidatesConnection(_ error: any Error) -> Bool {
    guard let error = error as? SupatermHostConnectionError else { return false }
    return switch error {
    case .connectionClosed,
      .eventBufferOverflow,
      .attachReplayBufferOverflow,
      .transport,
      .protocolViolation,
      .unexpectedResponse:
      true
    case .invalidEventCapacity,
      .invalidRequestCapacity,
      .invalidAttachReplayCapacity,
      .requestBufferOverflow,
      .terminalDataLength,
      .startupInputLength,
      .inputUnavailable,
      .inputInFlight,
      .remote,
      .resyncRequired,
      .outputSequence:
      false
    }
  }

  private static func isStartupTransient(_ error: any Error) -> Bool {
    if let error = error as? SupatermHostSocketSecurityError {
      switch error {
      case .missing, .runtimeRootPermissions, .socketPermissions:
        return true
      case .invalidURL,
        .pathTooLong,
        .inaccessible,
        .notSocket,
        .socketOwner,
        .invalidRuntimeRoot,
        .runtimeRootOwner:
        return false
      }
    }
    let systemError = error as NSError
    if systemError.domain == NSPOSIXErrorDomain {
      return systemError.code == ENOENT || systemError.code == ECONNREFUSED
    }
    if case .transport(let failure) = error as? SupatermHostConnectionError {
      return failure.isMissingOrRefused
    }
    return false
  }

  private static func retriesUncertainReservation(_ error: any Error) -> Bool {
    guard let error = error as? SupatermHostConnectionError else { return false }
    return switch error {
    case .connectionClosed, .eventBufferOverflow, .transport:
      true
    case .invalidEventCapacity,
      .invalidRequestCapacity,
      .invalidAttachReplayCapacity,
      .requestBufferOverflow,
      .attachReplayBufferOverflow,
      .terminalDataLength,
      .startupInputLength,
      .inputUnavailable,
      .inputInFlight,
      .protocolViolation,
      .remote,
      .unexpectedResponse,
      .resyncRequired,
      .outputSequence:
      false
    }
  }

  private static func retriesUncertainCleanup(_ error: any Error) -> Bool {
    guard let error = error as? SupatermHostConnectionError else { return false }
    return switch error {
    case .connectionClosed, .transport:
      true
    case .invalidEventCapacity,
      .invalidRequestCapacity,
      .invalidAttachReplayCapacity,
      .eventBufferOverflow,
      .requestBufferOverflow,
      .attachReplayBufferOverflow,
      .terminalDataLength,
      .startupInputLength,
      .inputUnavailable,
      .inputInFlight,
      .protocolViolation,
      .remote,
      .unexpectedResponse,
      .resyncRequired,
      .outputSequence:
      false
    }
  }

  private static func installedServiceRootOverride(
    in environment: [String: String],
    launchdTemporaryDirectory: String
  ) -> SupatermHostServiceRoot? {
    if SupatermSocketPath.normalized(environment[SupatermCLIEnvironment.stateHomeKey]) != nil {
      return .stateHome
    }
    if SupatermSocketPath.normalized(environment["XDG_RUNTIME_DIR"]) != nil {
      return .runtimeDirectory
    }
    if let homeDirectory = SupatermSocketPath.normalized(environment["HOME"]),
      standardizedDirectoryPath(homeDirectory)
        != standardizedDirectoryPath(NSHomeDirectory())
    {
      return .homeDirectory
    }
    if let temporaryDirectory = SupatermSocketPath.normalized(environment["TMPDIR"]),
      standardizedDirectoryPath(temporaryDirectory)
        != standardizedDirectoryPath(launchdTemporaryDirectory)
    {
      return .temporaryDirectory
    }
    return nil
  }

  private static func launchdTemporaryDirectoryPath() -> String? {
    let capacity = confstr(_CS_DARWIN_USER_TEMP_DIR, nil, 0)
    guard capacity > 0 else { return nil }
    var buffer = [CChar](repeating: 0, count: capacity)
    let length = buffer.withUnsafeMutableBufferPointer { pointer in
      confstr(_CS_DARWIN_USER_TEMP_DIR, pointer.baseAddress, pointer.count)
    }
    guard length > 0, length <= buffer.count else { return nil }
    return buffer.withUnsafeBufferPointer { pointer in
      guard let baseAddress = pointer.baseAddress else { return nil }
      return String(cString: baseAddress)
    }
  }

  private static func standardizedDirectoryPath(_ path: String) -> String {
    URL(
      fileURLWithPath: NSString(string: path).expandingTildeInPath,
      isDirectory: true
    )
    .standardizedFileURL.path
  }

  private static func liveConnection(
    socket: URL,
    role: SupatermHostClientRole
  ) async throws -> Connection {
    let connection = try await SupatermHostConnection.connect(socketURL: socket, role: role)
    return Connection(
      identity: { try await connection.identity() },
      reserve: { launchTicketID, terminalID, size, startupInput, startupInputDelivery in
        try await connection.reserve(
          launchTicketID: launchTicketID,
          terminalID: terminalID,
          size: size,
          startupInput: startupInput,
          startupInputDelivery: startupInputDelivery
        )
      },
      cancelReservation: { launchTicketID, terminalID in
        try await connection.cancelReservation(
          launchTicketID: launchTicketID,
          terminalID: terminalID
        )
      },
      get: { terminalID in
        try await connection.get(terminalID: terminalID)
      },
      list: {
        try await connection.list()
      },
      end: { terminalID in
        try await connection.end(terminalID: terminalID)
      },
      close: { await connection.close() }
    )
  }
}
