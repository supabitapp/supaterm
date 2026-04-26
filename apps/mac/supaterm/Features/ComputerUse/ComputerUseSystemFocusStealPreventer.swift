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
        queue: nil
      ) { notification in
        guard
          let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        else {
          return
        }
        MainActor.assumeIsolated {
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
    else { return nil }
    return begin(targetPid: targetPid, restoreTo: frontmost)
  }

  func begin(targetPid: pid_t, restoreTo: RunningApplication) -> Handle? {
    guard restoreTo.processIdentifier != targetPid else { return nil }
    if observer == nil {
      observer = observeActivations { [weak self] pid in
        self?.handleActivation(pid: pid)
      }
    }
    let handle = Handle(id: UUID())
    suppressions[handle.id] = .init(targetPid: targetPid, restoreTo: restoreTo)
    return handle
  }

  func end(_ handle: Handle) {
    suppressions.removeValue(forKey: handle.id)
    if suppressions.isEmpty, let observer {
      removeObserver(observer)
      self.observer = nil
    }
  }

  func end(_ handle: Handle, afterDrainingFor duration: TimeInterval) {
    drainRunLoop(for: duration)
    end(handle)
  }

  private func handleActivation(pid: pid_t) {
    guard let suppression = suppressions.values.first(where: { $0.targetPid == pid }) else {
      return
    }
    suppression.restoreTo.activate()
  }

  private func drainRunLoop(for duration: TimeInterval) {
    guard duration > 0 else { return }
    let deadline = Date().addingTimeInterval(duration)
    while Date() < deadline {
      RunLoop.current.run(mode: .default, before: min(deadline, Date().addingTimeInterval(0.01)))
    }
  }
}
