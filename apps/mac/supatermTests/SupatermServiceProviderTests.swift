import AppKit
import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

@MainActor
struct SupatermServiceProviderTests {
  @Test
  func directorySelectionUsesDirectoryPath() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }

    let pasteboard = makePasteboard([root])

    #expect(
      SupatermServiceProvider.directoryPaths(from: pasteboard) == [
        SupatermWorkingDirectory.normalizedPath(root)
      ]
    )
  }

  @Test
  func urlTextDoesNotProduceDirectoryPath() {
    let pasteboard = makePasteboard()
    #expect(pasteboard.setString("https://supaterm.com/docs", forType: .URL))

    #expect(SupatermServiceProvider.directoryPaths(from: pasteboard).isEmpty)
  }

  @Test
  func fileSelectionUsesParentDirectoryPath() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let fileURL = root.appendingPathComponent("file.txt")
    try "x".write(to: fileURL, atomically: true, encoding: .utf8)

    let pasteboard = makePasteboard([fileURL])

    #expect(
      SupatermServiceProvider.directoryPaths(from: pasteboard) == [
        SupatermWorkingDirectory.normalizedPath(root)
      ]
    )
  }

  @Test
  func plainTextFileSelectionUsesParentDirectoryPath() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let fileURL = root.appendingPathComponent("file.txt")
    try "x".write(to: fileURL, atomically: true, encoding: .utf8)
    let pasteboard = makePasteboard()
    #expect(pasteboard.setString(fileURL.path, forType: .string))

    #expect(
      SupatermServiceProvider.directoryPaths(from: pasteboard) == [
        SupatermWorkingDirectory.normalizedPath(root)
      ]
    )
  }

  @Test
  func selectedPathsAreDedupedAndSorted() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let first = root.appendingPathComponent("a", isDirectory: true)
    let second = root.appendingPathComponent("b", isDirectory: true)
    try FileManager.default.createDirectory(at: first, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: second, withIntermediateDirectories: true)

    let pasteboard = makePasteboard([second, first, second])

    #expect(
      SupatermServiceProvider.directoryPaths(from: pasteboard) == [
        SupatermWorkingDirectory.normalizedPath(first),
        SupatermWorkingDirectory.normalizedPath(second),
      ]
    )
  }

  @Test
  func equivalentDottedPathsAreDeduped() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let parent = root.appendingPathComponent("parent", isDirectory: true)
    let directory = root.appendingPathComponent("directory", isDirectory: true)
    try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let dotted = URL(
      fileURLWithPath: "\(parent.path)/../\(directory.lastPathComponent)",
      isDirectory: true
    )

    let pasteboard = makePasteboard([dotted, directory])

    #expect(
      SupatermServiceProvider.directoryPaths(from: pasteboard) == [
        SupatermWorkingDirectory.normalizedPath(directory)
      ]
    )
  }

  @Test
  func openTabDispatchesTabPaths() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let pasteboard = makePasteboard([root])
    var openedTabs: [[String]] = []
    var openedWindows: [[String]] = []
    let provider = SupatermServiceProvider(
      openTabs: { openedTabs.append($0) },
      openWindows: { openedWindows.append($0) }
    )
    var error = NSString()

    provider.openTab(pasteboard, userData: nil, error: &error)

    #expect(openedTabs == [[SupatermWorkingDirectory.normalizedPath(root)]])
    #expect(openedWindows.isEmpty)
    #expect(error.length == 0)
  }

  @Test
  func openWindowDispatchesWindowPaths() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let pasteboard = makePasteboard([root])
    var openedTabs: [[String]] = []
    var openedWindows: [[String]] = []
    let provider = SupatermServiceProvider(
      openTabs: { openedTabs.append($0) },
      openWindows: { openedWindows.append($0) }
    )
    var error = NSString()

    provider.openWindow(pasteboard, userData: nil, error: &error)

    #expect(openedTabs.isEmpty)
    #expect(openedWindows == [[SupatermWorkingDirectory.normalizedPath(root)]])
    #expect(error.length == 0)
  }

  @Test
  func emptyPasteboardSetsError() {
    let pasteboard = makePasteboard()
    var openedTabs: [[String]] = []
    var openedWindows: [[String]] = []
    let provider = SupatermServiceProvider(
      openTabs: { openedTabs.append($0) },
      openWindows: { openedWindows.append($0) }
    )
    var error = NSString()

    provider.openTab(pasteboard, userData: nil, error: &error)

    #expect(openedTabs.isEmpty)
    #expect(openedWindows.isEmpty)
    #expect((error as String).contains("file paths"))
  }

  private func temporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-service-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private func makePasteboard(_ urls: [URL] = []) -> NSPasteboard {
    let pasteboard = NSPasteboard(name: NSPasteboard.Name("supaterm-service-\(UUID().uuidString)"))
    pasteboard.clearContents()
    _ = pasteboard.writeObjects(urls.map { $0 as NSURL })
    return pasteboard
  }
}
