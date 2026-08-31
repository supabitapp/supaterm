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
    let objectURLs: [URL] =
      pasteboard.readObjects(
        forClasses: [NSURL.self],
        options: [.urlReadingFileURLsOnly: true]
      ) as? [URL] ?? []
    let textURLs: [URL] =
      pasteboard.string(forType: .string)?.split(whereSeparator: \.isNewline).compactMap {
        let path = String($0)
        guard path.hasPrefix("/"), FileManager.default.fileExists(atPath: path) else { return nil }
        return URL(fileURLWithPath: path)
      } ?? []

    let directoryPaths = (objectURLs + textURLs).map { url in
      let isDirectory =
        (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory)
        ?? url.hasDirectoryPath
      let directory = isDirectory ? url : url.deletingLastPathComponent()
      return SupatermWorkingDirectory.normalizedPath(directory.standardizedFileURL)
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
