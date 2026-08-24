import Foundation
import Sharing
import SupatermSupport

struct LicenseNoticeAcknowledgement: Codable, Equatable, Sendable {
  let licenseID: String
  let revision: Int
}

struct LicenseSession: Equatable, Sendable {
  var entitlement: LicenseEntitlement?
  var hasLicenseKey: Bool
  var noticeAcknowledgement: LicenseNoticeAcknowledgement?
  var phase: LicenseFeaturePhase
}

private actor LicenseRefreshCoordinator {
  private struct Operation {
    let id: UUID
    let task: Task<Void, any Error>
  }

  private var operation: Operation?

  func run(
    _ work: @escaping @Sendable () async throws -> Void
  ) async throws {
    if let operation {
      return try await operation.task.value
    }
    let operation = Operation(
      id: UUID(),
      task: Task<Void, any Error> {
        try await work()
      }
    )
    self.operation = operation
    defer {
      if self.operation?.id == operation.id {
        self.operation = nil
      }
    }
    return try await operation.task.value
  }
}

public final class LicenseRuntime: Sendable {
  let session: Shared<LicenseSession>
  private let client: LicenseClient
  private let onTombstone: @MainActor @Sendable () -> Void
  private let refreshCoordinator = LicenseRefreshCoordinator()

  init(
    client: LicenseClient,
    onTombstone: @escaping @MainActor @Sendable () -> Void = {}
  ) {
    self.client = client
    self.onTombstone = onTombstone
    let snapshot = client.load()
    session = Shared(
      value: LicenseSession(
        entitlement: snapshot.entitlement,
        hasLicenseKey: snapshot.hasLicenseKey,
        noticeAcknowledgement: snapshot.noticeAcknowledgement,
        phase: .idle
      )
    )
  }

  public static func live(
    onTombstone: @escaping @MainActor @Sendable () -> Void = {}
  ) -> Self {
    Self(
      client: AppBuild.usesStubServices ? .debugValue : .liveValue,
      onTombstone: onTombstone
    )
  }

  public static func preview(entitlement: LicenseEntitlement? = nil) -> Self {
    var client = LicenseClient.testValue
    client.load = {
      LicenseClient.Snapshot(
        entitlement: entitlement,
        hasLicenseKey: entitlement != nil
      )
    }
    return Self(client: client)
  }

  func beginActivation() -> Bool {
    begin(.activating)
  }

  func beginDeactivation() -> Bool {
    begin(.deactivating)
  }

  func beginRefresh() -> Bool {
    session.withLock { session in
      guard session.hasLicenseKey, session.phase == .idle else { return false }
      session.phase = .refreshing
      return true
    }
  }

  func activateAndApply(_ key: String) async throws {
    let entitlement = try await client.activate(key)
    guard entitlement.status == .active else {
      throw LicenseClientError.inactiveLicense
    }
    session.withLock { session in
      session.entitlement = entitlement
      session.hasLicenseKey = true
    }
  }

  func deactivateAndApply() async throws {
    try await client.deactivate()
    session.withLock { session in
      session.entitlement = nil
      session.hasLicenseKey = false
      session.noticeAcknowledgement = nil
    }
  }

  func acknowledgeNotice() {
    let acknowledgement = session.withLock { session -> LicenseNoticeAcknowledgement? in
      guard
        let entitlement = session.entitlement,
        LicenseNotice(
          entitlement: entitlement,
          acknowledgement: session.noticeAcknowledgement
        ) != nil
      else { return nil }
      let acknowledgement = LicenseNoticeAcknowledgement(
        licenseID: entitlement.licenseID,
        revision: entitlement.revision
      )
      session.noticeAcknowledgement = acknowledgement
      return acknowledgement
    }
    guard let acknowledgement else { return }
    try? client.acknowledgeNotice(acknowledgement)
  }

  func cancelOperations() {
    session.withLock { $0.phase = .idle }
  }

  func refreshInterval() -> Duration {
    client.refreshInterval()
  }

  @MainActor
  public func access(releaseDay: LicenseDay) -> LicenseAccess {
    LicenseAccess(entitlement: session.wrappedValue.entitlement, releaseDay: releaseDay)
  }

  @MainActor
  public func refreshAndApply() async throws {
    let ownsPhase = beginRefresh()
    guard ownsPhase || session.wrappedValue.phase == .refreshing else { return }
    defer {
      if ownsPhase {
        finish(.refreshing)
      }
    }
    try await refreshStartedAndApply()
  }

  @MainActor
  func refreshStartedAndApply() async throws {
    try await refreshCoordinator.run { [client, onTombstone, session] in
      let entitlement = try await client.refresh()
      let transitioned = session.withLock { session in
        let transitioned =
          session.entitlement?.status == .active
          && entitlement.status != .active
        session.entitlement = entitlement
        return transitioned
      }
      if transitioned {
        await onTombstone()
      }
    }
  }

  func finishActivation() {
    finish(.activating)
  }

  func finishDeactivation() {
    finish(.deactivating)
  }

  func finishRefresh() {
    finish(.refreshing)
  }

  private func begin(_ phase: LicenseFeaturePhase) -> Bool {
    session.withLock { session in
      guard session.phase == .idle else { return false }
      session.phase = phase
      return true
    }
  }

  private func finish(_ phase: LicenseFeaturePhase) {
    session.withLock {
      if $0.phase == phase {
        $0.phase = .idle
      }
    }
  }
}
