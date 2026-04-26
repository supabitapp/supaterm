import AppKit
import Foundation

@MainActor
final class ComputerUseSystemFocusStealPreventer {
  struct RunningApplication {
    let processIdentifier: pid_t
    let activate: @MainActor () -> Void
  }

  struct Handle: Hashable {
    fileprivate let id: UUID
  }

  private struct Suppression {
    let targetPid: pid_t
    let restoreTo: RunningApplication
  }

  private let frontmostApplication: () -> RunningApplication?
  private let observeActivations: (@escaping @MainActor (pid_t) -> Void) -> AnyObject
  private let removeObserver: (AnyObject) -> Void
  private var suppressions: [UUID: Suppression] = [:]
  private var observer: AnyObject?

  init(
    frontmostApplication: @escaping () -> RunningApplication? = {
      NSWorkspace.shared.frontmostApplication.map { app in
        RunningApplication(processIdentifier: app.processIdentifier) {
          _ = app.activate(options: [])
        }
      }
    },
    observeActivations: @escaping (@escaping @MainActor (pid_t) -> Void) -> AnyObject = { onActivate in
      NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.didActivateApplicationNotification,
        object: nil,
        queue: .main
      ) { notification in
        guard
          let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        else {
          return
        }
        Task { @MainActor in
          onActivate(app.processIdentifier)
        }
      }
    },
    removeObserver: @escaping (AnyObject) -> Void = { observer in
      NSWorkspace.shared.notificationCenter.removeObserver(observer)
    }
  ) {
    self.frontmostApplication = frontmostApplication
    self.observeActivations = observeActivations
    self.removeObserver = removeObserver
  }

  func begin(targetPid: pid_t) -> Handle? {
    guard let frontmost = frontmostApplication(),
      frontmost.processIdentifier != targetPid
    else {
      return nil
    }
    if observer == nil {
      observer = observeActivations { [weak self] pid in
        self?.handleActivation(pid: pid)
      }
    }
    let handle = Handle(id: UUID())
    suppressions[handle.id] = .init(targetPid: targetPid, restoreTo: frontmost)
    return handle
  }

  func end(_ handle: Handle, drainInterval: TimeInterval = 0.05) {
    if drainInterval > 0 {
      let deadline = Date().addingTimeInterval(drainInterval)
      while Date() < deadline {
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01))
      }
    }
    if let suppression = suppressions[handle.id],
      frontmostApplication()?.processIdentifier == suppression.targetPid
    {
      suppression.restoreTo.activate()
    }
    suppressions.removeValue(forKey: handle.id)
    if suppressions.isEmpty, let observer {
      removeObserver(observer)
      self.observer = nil
    }
  }

  private func handleActivation(pid: pid_t) {
    guard let suppression = suppressions.values.first(where: { $0.targetPid == pid }) else {
      return
    }
    suppression.restoreTo.activate()
  }
}
