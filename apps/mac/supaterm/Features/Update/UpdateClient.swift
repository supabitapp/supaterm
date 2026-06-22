import ComposableArchitecture
import Sharing
import SupatermCLIShared
import SupatermSupport

public struct UpdateClient: Sendable {
  public struct Snapshot: Equatable, Sendable {
    public var automaticallyChecksForUpdates: Bool
    public var automaticallyDownloadsUpdates: Bool
    public var canCheckForUpdates: Bool
    public var phase: UpdatePhase

    public init(
      automaticallyChecksForUpdates: Bool,
      automaticallyDownloadsUpdates: Bool,
      canCheckForUpdates: Bool,
      phase: UpdatePhase
    ) {
      self.automaticallyChecksForUpdates = automaticallyChecksForUpdates
      self.automaticallyDownloadsUpdates = automaticallyDownloadsUpdates
      self.canCheckForUpdates = canCheckForUpdates
      self.phase = phase
    }
  }

  public var observe: @Sendable () async -> AsyncStream<Snapshot>
  public var perform: @Sendable (UpdateUserAction) async -> Void
  public var setAutomaticallyChecksForUpdates: @Sendable (Bool) async -> Void
  public var setAutomaticallyDownloadsUpdates: @Sendable (Bool) async -> Void
  public var setUpdateChannel: @Sendable (UpdateChannel) async -> Void
  public var start: @Sendable () async -> Void

  public init(
    observe: @escaping @Sendable () async -> AsyncStream<Snapshot>,
    perform: @escaping @Sendable (UpdateUserAction) async -> Void,
    setAutomaticallyChecksForUpdates: @escaping @Sendable (Bool) async -> Void,
    setAutomaticallyDownloadsUpdates: @escaping @Sendable (Bool) async -> Void,
    setUpdateChannel: @escaping @Sendable (UpdateChannel) async -> Void,
    start: @escaping @Sendable () async -> Void
  ) {
    self.observe = observe
    self.perform = perform
    self.setAutomaticallyChecksForUpdates = setAutomaticallyChecksForUpdates
    self.setAutomaticallyDownloadsUpdates = setAutomaticallyDownloadsUpdates
    self.setUpdateChannel = setUpdateChannel
    self.start = start
  }
}

extension UpdateClient: DependencyKey {
  public static let liveValue: Self = {
    let runtime = UpdateRuntime.shared
    return Self(
      observe: {
        await runtime.observe()
      },
      perform: { action in
        await runtime.perform(action)
      },
      setAutomaticallyChecksForUpdates: { isEnabled in
        await runtime.setAutomaticallyChecksForUpdates(isEnabled)
      },
      setAutomaticallyDownloadsUpdates: { isEnabled in
        await runtime.setAutomaticallyDownloadsUpdates(isEnabled)
      },
      setUpdateChannel: { updateChannel in
        await runtime.setUpdateChannel(updateChannel)
      },
      start: {
        let updateChannel = await MainActor.run {
          @Shared(.supatermSettings) var supatermSettings = .default
          return supatermSettings.updateChannel
        }
        await runtime.start(updateChannel: updateChannel)
      }
    )
  }()

  public static let testValue = Self(
    observe: {
      AsyncStream { continuation in
        continuation.finish()
      }
    },
    perform: { _ in },
    setAutomaticallyChecksForUpdates: { _ in },
    setAutomaticallyDownloadsUpdates: { _ in },
    setUpdateChannel: { _ in },
    start: {}
  )
}

extension DependencyValues {
  public var updateClient: UpdateClient {
    get { self[UpdateClient.self] }
    set { self[UpdateClient.self] = newValue }
  }
}
