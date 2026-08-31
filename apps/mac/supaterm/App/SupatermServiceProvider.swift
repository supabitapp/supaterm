import AppKit
import Foundation
import SupatermCLIShared

final class SupatermServiceProvider: NSObject {
  private enum OpenTarget {
    case tab
    case window
  }

  private static let errorNoPaths = NSString(string: "Could not load any file paths from the pasteboard.")

  private let openTabs: ([String]) -> Void
  private let openWindows: ([String]) -> Void

  init(
    openTabs: @escaping ([String]) -> Void,
    openWindows: @escaping ([String]) -> Void
  ) {
    self.openTabs = openTabs
    self.openWindows = openWindows
    super.init()
  }

  @objc func openTab(
    _ pasteboard: NSPasteboard,
    userData: String?,
    error: AutoreleasingUnsafeMutablePointer<NSString>
  ) {
    openTerminal(from: pasteboard, target: .tab, error: error)
  }

  @objc func openWindow(
    _ pasteboard: NSPasteboard,
    userData: String?,
    error: AutoreleasingUnsafeMutablePointer<NSString>
  ) {
    openTerminal(from: pasteboard, target: .window, error: error)
  }

  static func directoryPaths(from pasteboard: NSPasteboard) -> [String] {
    guard
      let urls = pasteboard.readObjects(
        forClasses: [NSURL.self],
        options: [.urlReadingFileURLsOnly: true]
      ) as? [URL]
    else {
      return []
    }

    let directoryPaths = urls.compactMap { url -> String? in
      guard (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
        return nil
      }
      return SupatermWorkingDirectory.normalizedPath(url.standardizedFileURL)
    }
    return Array(Set(directoryPaths)).sorted()
  }

  private func openTerminal(
    from pasteboard: NSPasteboard,
    target: OpenTarget,
    error: AutoreleasingUnsafeMutablePointer<NSString>
  ) {
    let paths = Self.directoryPaths(from: pasteboard)
    guard !paths.isEmpty else {
      error.pointee = Self.errorNoPaths
      return
    }

    switch target {
    case .tab:
      openTabs(paths)
    case .window:
      openWindows(paths)
    }
  }
}
