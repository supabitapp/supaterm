import AppKit
import Foundation
import Sparkle
import SupatermCLIShared

@MainActor
final class UpdateRuntime: NSObject, @unchecked Sendable {
  static let shared = UpdateRuntime()

  enum Interaction {
    case none
    case permissionRequest((SUUpdatePermissionResponse) -> Void)
    case checking(() -> Void)
    case updateAvailable((SPUUserUpdateChoice) -> Void)
    case notFound(() -> Void)
    case error(retry: () -> Void)
    case downloading(() -> Void)
    case installing(() -> Void)
  }

  enum SessionOrigin {
    case idle
    case interactive
  }

  enum PreparedInstallChoice {
    case nextRestart
    case relaunch
  }

  #if !DEBUG
    private var automaticallyChecksForUpdatesObservation: NSKeyValueObservation?
    private var automaticallyDownloadsUpdatesObservation: NSKeyValueObservation?
    private var canCheckForUpdatesObservation: NSKeyValueObservation?
  #endif
  private var continuations: [UUID: AsyncStream<UpdateClient.Snapshot>.Continuation] = [:]
  var hidesNextManualInstallPrompt = false
  var interaction: Interaction = .none
  var phase: UpdatePhase = .idle
  var preparedInstallChoice: PreparedInstallChoice = .relaunch
  var sessionOrigin: SessionOrigin = .idle
  private var started = false
  var stubAutomaticallyChecksForUpdates = true
  var stubAutomaticallyDownloadsUpdates = true
  var updateAvailableStage: SPUUserUpdateStage?
  private let userDriver: UpdateDriver?
  let updater: SPUUpdater?

  private override init() {
    #if DEBUG
      userDriver = UpdateDriver(hostBundle: Bundle.main)
      updater = nil
      super.init()
    #else
      let hostBundle = Bundle.main
      let userDriver = UpdateDriver(hostBundle: hostBundle)
      self.userDriver = userDriver
      updater = SPUUpdater(
        hostBundle: hostBundle,
        applicationBundle: hostBundle,
        userDriver: userDriver,
        delegate: userDriver
      )
      super.init()
      userDriver.runtime = self
      canCheckForUpdatesObservation = updater?.observe(
        \.canCheckForUpdates, options: [.new]
      ) { [weak self] _, _ in
        MainActor.assumeIsolated {
          self?.publish()
        }
      }
      automaticallyChecksForUpdatesObservation = updater?.observe(
        \.automaticallyChecksForUpdates, options: [.new]
      ) { [weak self] _, _ in
        MainActor.assumeIsolated {
          self?.publish()
        }
      }
      automaticallyDownloadsUpdatesObservation = updater?.observe(
        \.automaticallyDownloadsUpdates, options: [.new]
      ) { [weak self] _, _ in
        MainActor.assumeIsolated {
          self?.publish()
        }
      }
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(handleWindowWillClose),
        name: NSWindow.willCloseNotification,
        object: nil
      )
    #endif
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
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

  func perform(_ action: UpdateUserAction) {
    switch action {
    case .checkForUpdates:
      performCheckForUpdates()

    case .allowAutomaticChecks:
      respondToPermissionRequest(automaticChecks: true)

    case .declineAutomaticChecks:
      respondToPermissionRequest(automaticChecks: false)

    case .cancel:
      cancelInteraction()

    case .dismiss:
      dismissInteraction()

    case .install:
      installUpdate()

    case .installAfterNextRestart:
      installAfterNextRestart()

    case .restartLater:
      restartLater()

    case .restartNow:
      restartNow()

    case .retry:
      retryUpdate()

    case .skipVersion:
      skipVersion()
    }
  }

  func setAutomaticallyChecksForUpdates(_ isEnabled: Bool) {
    if let updater {
      updater.automaticallyChecksForUpdates = isEnabled
      if !isEnabled {
        updater.automaticallyDownloadsUpdates = false
      }
    } else {
      stubAutomaticallyChecksForUpdates = isEnabled
      if !isEnabled {
        stubAutomaticallyDownloadsUpdates = false
      }
    }
    publish()
  }

  func setAutomaticallyDownloadsUpdates(_ isEnabled: Bool) {
    if let updater {
      updater.automaticallyDownloadsUpdates =
        updater.automaticallyChecksForUpdates && isEnabled
    } else {
      stubAutomaticallyDownloadsUpdates =
        stubAutomaticallyChecksForUpdates && isEnabled
    }
    publish()
  }

  func setUpdateChannel(_ updateChannel: UpdateChannel) {
    configureUpdater(updateChannel: updateChannel)
  }

  func start(updateChannel: UpdateChannel) {
    configureUpdater(updateChannel: updateChannel)
    guard !started else {
      publish()
      return
    }

    guard let updater else {
      started = true
      publish()
      return
    }

    do {
      try updater.start()
      started = true
      publish()
    } catch {
      interaction = .error(retry: { [weak self] in
        Task { @MainActor in
          self?.start(updateChannel: updateChannel)
        }
      })
      phase = .error(UpdatePhase.Failure(message: error.localizedDescription))
      publish()
    }
  }

  private var snapshot: UpdateClient.Snapshot {
    UpdateClient.Snapshot(
      automaticallyChecksForUpdates: updater?.automaticallyChecksForUpdates ?? stubAutomaticallyChecksForUpdates,
      automaticallyDownloadsUpdates: updater?.automaticallyDownloadsUpdates ?? stubAutomaticallyDownloadsUpdates,
      canCheckForUpdates: updater?.canCheckForUpdates ?? false,
      phase: phase
    )
  }

  func publish() {
    let snapshot = snapshot
    for continuation in continuations.values {
      continuation.yield(snapshot)
    }
  }

  private func configureUpdater(updateChannel: UpdateChannel) {
    userDriver?.updateChannel = updateChannel
    updater?.updateCheckInterval = updateChannel.updateCheckInterval
    publish()
  }
}
