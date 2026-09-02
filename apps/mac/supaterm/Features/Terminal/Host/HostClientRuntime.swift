import Foundation
import SupatermHostClient

@MainActor
protocol HostWindowPresentation: AnyObject {
  func update(
    window: HostWindow,
    clientState: HostClientWindowState,
    projection: HostProjectionState
  )
  func detach()
}

@MainActor
final class HostWindowReconciler {
  typealias Factory = @MainActor (HostWindowID) -> any HostWindowPresentation

  private let factory: Factory
  private var presentations: [HostWindowID: any HostWindowPresentation] = [:]

  init(factory: @escaping Factory) {
    self.factory = factory
  }

  func reconcile(_ projection: HostProjectionState?) {
    guard let projection, let client = projection.clientState else {
      detachAll()
      return
    }
    let windows = Dictionary(uniqueKeysWithValues: projection.workspace.windows.values.map { ($0.id, $0) })
    let desired = Set(windows.keys)
    for windowID in presentations.keys where !desired.contains(windowID) {
      presentations.removeValue(forKey: windowID)?.detach()
    }
    for (windowID, window) in windows {
      guard let clientState = client.window(windowID) else { continue }
      let presentation = presentations[windowID] ?? factory(windowID)
      presentations[windowID] = presentation
      presentation.update(window: window, clientState: clientState, projection: projection)
    }
  }

  func detachAll() {
    let current = presentations.values
    presentations.removeAll()
    for presentation in current {
      presentation.detach()
    }
  }

  var windowIDs: Set<HostWindowID> {
    Set(presentations.keys)
  }
}

@MainActor
final class HostClientRuntime {
  let connection: HostConnection
  let projection = HostProjection()

  private let windows: HostWindowReconciler
  private var eventsTask: Task<Void, Never>?

  init(connection: HostConnection, windows: HostWindowReconciler) {
    self.connection = connection
    self.windows = windows
  }

  func start() {
    guard eventsTask == nil else { return }
    let events = connection.events
    eventsTask = Task { [weak self] in
      for await event in events {
        guard let self else { return }
        await self.receive(event)
      }
    }
    Task { await connection.start() }
  }

  func stop() {
    eventsTask?.cancel()
    eventsTask = nil
    windows.detachAll()
    projection.clear()
    Task { await connection.stop() }
  }

  private func receive(_ event: HostConnectionEvent) async {
    switch event {
    case .connecting:
      projection.connecting()
    case .welcomed(let welcome):
      projection.connected(welcome)
    case .subscription(let subscription):
      do {
        try projection.apply(subscription)
        windows.reconcile(projection.state)
      } catch {
        projection.clear()
        windows.reconcile(nil)
        await connection.resync()
      }
    case .epochChanged, .resyncRequired:
      projection.clear()
      windows.reconcile(nil)
    case .disconnected(let message):
      projection.clear()
      projection.failed(message)
      windows.reconcile(nil)
    }
  }

  isolated deinit {
    eventsTask?.cancel()
  }
}

extension HostClientState {
  fileprivate func window(_ id: HostWindowID) -> HostClientWindowState? {
    windows[id.uuidString.lowercased()] ?? windows[id.uuidString.uppercased()]
  }
}
