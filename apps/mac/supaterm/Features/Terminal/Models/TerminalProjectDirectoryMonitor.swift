import AppKit
import Darwin
import Foundation
import Observation

@MainActor
@Observable
final class TerminalProjectDirectoryMonitor {
  static let shared = TerminalProjectDirectoryMonitor()

  private struct Watch {
    let path: String
    let source: DispatchSourceFileSystemObject
  }

  private(set) var unavailableURLs: Set<URL> = []

  @ObservationIgnored private var urls: Set<URL> = []
  @ObservationIgnored private var refreshTasks: [URL: Task<Void, Never>] = [:]
  @ObservationIgnored private var watches: [URL: Watch] = [:]
  @ObservationIgnored private var observers: [NSObjectProtocol] = []
  @ObservationIgnored private let notificationCenter: NotificationCenter
  @ObservationIgnored private let workspaceNotificationCenter: NotificationCenter

  init(
    notificationCenter: NotificationCenter = .default,
    workspaceNotificationCenter: NotificationCenter = NSWorkspace.shared.notificationCenter
  ) {
    self.notificationCenter = notificationCenter
    self.workspaceNotificationCenter = workspaceNotificationCenter
    observers.append(
      notificationCenter.addObserver(
        forName: NSApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.refreshAll()
        }
      }
    )
    for name in [
      NSWorkspace.didMountNotification,
      NSWorkspace.didUnmountNotification,
      NSWorkspace.didRenameVolumeNotification,
    ] {
      observers.append(
        workspaceNotificationCenter.addObserver(
          forName: name,
          object: nil,
          queue: .main
        ) { [weak self] _ in
          MainActor.assumeIsolated {
            self?.refreshAll()
          }
        }
      )
    }
  }

  isolated deinit {
    refreshTasks.values.forEach { $0.cancel() }
    watches.values.forEach { $0.source.cancel() }
    for observer in observers {
      notificationCenter.removeObserver(observer)
      workspaceNotificationCenter.removeObserver(observer)
    }
    observers.removeAll()
  }

  func update<URLs: Sequence>(urls: URLs) where URLs.Element == URL {
    let urls = Set(urls)
    let removedURLs = self.urls.subtracting(urls)
    for url in removedURLs {
      refreshTasks.removeValue(forKey: url)?.cancel()
      watches.removeValue(forKey: url)?.source.cancel()
      unavailableURLs.remove(url)
    }
    let addedURLs = urls.subtracting(self.urls)
    self.urls = urls
    for url in addedURLs {
      refresh(url)
    }
  }

  func isAvailable(_ url: URL) -> Bool {
    !unavailableURLs.contains(url)
  }

  func refreshAll() {
    for url in urls {
      refresh(url)
    }
  }

  private func refresh(_ url: URL) {
    refreshTasks.removeValue(forKey: url)?.cancel()
    refreshTasks[url] = Task { [weak self] in
      let result = await Task.detached {
        (
          isAvailable: Self.isReachableDirectory(url),
          watchedPath: Self.nearestWatchablePath(for: url)
        )
      }.value
      guard !Task.isCancelled, let self, urls.contains(url) else { return }
      if result.isAvailable {
        unavailableURLs.remove(url)
      } else {
        unavailableURLs.insert(url)
      }
      configureWatch(for: url, path: result.watchedPath)
      refreshTasks.removeValue(forKey: url)
    }
  }

  private func configureWatch(for url: URL, path: String?) {
    guard let path else {
      watches.removeValue(forKey: url)?.source.cancel()
      return
    }
    guard watches[url]?.path != path else { return }
    watches.removeValue(forKey: url)?.source.cancel()
    let descriptor = open(path, O_EVTONLY)
    guard descriptor >= 0 else { return }
    let source = DispatchSource.makeFileSystemObjectSource(
      fileDescriptor: descriptor,
      eventMask: [.write, .extend, .attrib, .rename, .delete, .revoke],
      queue: DispatchQueue(label: "terminal-project-directory.\(url.path.hashValue)")
    )
    source.setEventHandler { @Sendable [weak self] in
      Task { @MainActor in
        self?.refresh(url)
      }
    }
    source.setCancelHandler { @Sendable in
      close(descriptor)
    }
    source.resume()
    watches[url] = Watch(path: path, source: source)
  }

  nonisolated static func isReachableDirectory(_ url: URL) -> Bool {
    TerminalProjectItem.reachableDirectoryURL(url) != nil
  }

  nonisolated private static func nearestWatchablePath(for url: URL) -> String? {
    var candidate = url
    while true {
      let path = candidate.path(percentEncoded: false)
      let descriptor = open(path, O_EVTONLY)
      if descriptor >= 0 {
        close(descriptor)
        return path
      }
      let parent = candidate.deletingLastPathComponent()
      guard parent != candidate else { return nil }
      candidate = parent
    }
  }
}
