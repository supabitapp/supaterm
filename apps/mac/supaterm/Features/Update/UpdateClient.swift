import AppKit
import ComposableArchitecture
import Sparkle

struct UpdatePhase: Equatable, Sendable {
  static let idle = Self()

  var detailMessage: String { "" }
  var menuItemText: String { "Check for Updates..." }
  var bypassesQuitConfirmation: Bool { false }
}

struct UpdateClient: Sendable {
  struct Snapshot: Equatable, Sendable {
    var canCheckForUpdates: Bool
  }

  var checkForUpdates: @Sendable () async -> Void
  var observe: @Sendable () async -> AsyncStream<Snapshot>
  var start: @Sendable () async -> Void
}

extension UpdateClient: DependencyKey {
  static let liveValue: Self = {
    let runtime = UpdateRuntime.shared
    return Self(
      checkForUpdates: {
        await runtime.checkForUpdates()
      },
      observe: {
        await runtime.observe()
      },
      start: {
        await runtime.start()
      }
    )
  }()

  static let testValue = Self(
    checkForUpdates: {},
    observe: {
      AsyncStream { continuation in
        continuation.finish()
      }
    },
    start: {}
  )
}

extension DependencyValues {
  var updateClient: UpdateClient {
    get { self[UpdateClient.self] }
    set { self[UpdateClient.self] = newValue }
  }
}

@MainActor
final class UpdateRuntime: NSObject, @unchecked Sendable {
  static let shared = UpdateRuntime()

  private var canCheckForUpdatesObservation: NSKeyValueObservation?
  private var continuations: [UUID: AsyncStream<UpdateClient.Snapshot>.Continuation] = [:]
  private var started = false
  private var updater: SPUUpdater?

  private override init() {
    #if DEBUG
      updater = nil
      super.init()
    #else
      let hostBundle = Bundle.main
      let userDriver = SPUStandardUserDriver(hostBundle: hostBundle, delegate: nil)
      updater = nil
      super.init()
      updater = SPUUpdater(
        hostBundle: hostBundle,
        applicationBundle: hostBundle,
        userDriver: userDriver,
        delegate: nil
      )
      updater?.updateCheckInterval = 900
      canCheckForUpdatesObservation = updater?.observe(
        \.canCheckForUpdates, options: [.new]
      ) { [weak self] _, _ in
        MainActor.assumeIsolated {
          self?.publish()
        }
      }
    #endif
  }

  func checkForUpdates() {
    start()
    updater?.checkForUpdates()
  }

  func observe() -> AsyncStream<UpdateClient.Snapshot> {
    AsyncStream { continuation in
      let id = UUID()
      continuations[id] = continuation
      continuation.yield(snapshot)
      continuation.onTermination = { [weak self] _ in
        Task { @MainActor in
          self?.continuations.removeValue(forKey: id)
        }
      }
    }
  }

  func start() {
    guard !started else {
      publish()
      return
    }
    started = true
    guard let updater else {
      publish()
      return
    }
    do {
      try updater.start()
      if updater.automaticallyChecksForUpdates && AppBuild.allowsBackgroundUpdateCheckOnLaunch {
        updater.checkForUpdatesInBackground()
      }
    } catch {}
    publish()
  }

  private var snapshot: UpdateClient.Snapshot {
    UpdateClient.Snapshot(
      canCheckForUpdates: updater?.canCheckForUpdates ?? false
    )
  }

  private func publish() {
    let snapshot = snapshot
    for continuation in continuations.values {
      continuation.yield(snapshot)
    }
  }
}
