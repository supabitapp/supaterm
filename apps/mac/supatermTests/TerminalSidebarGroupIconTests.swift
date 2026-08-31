import Foundation
import Synchronization
import Testing

@testable import supaterm

@MainActor
struct TerminalTabGroupIconTests {
  @Test
  func resolvesIconFromTheGroupSharedRepository() throws {
    let fixture = try RepositoryIconFixture(name: "supaterm")
    defer { fixture.remove() }
    let iconURL = try fixture.writeIcon()
    let macURL = try fixture.createDirectory("apps/mac")
    let docsURL = try fixture.createDirectory("docs")
    let request = TerminalTabGroupIconRequest(
      workingDirectoryPaths: [macURL.path, docsURL.path]
    )

    #expect(request.resolve() == iconURL)
  }

  @Test
  func resolvesFirstIconWhenTabsDoNotShareARepository() throws {
    let first = try RepositoryIconFixture(name: "first")
    let second = try RepositoryIconFixture(name: "second")
    defer {
      first.remove()
      second.remove()
    }
    let iconURL = try first.writeIcon()
    _ = try second.writeIcon()
    let request = TerminalTabGroupIconRequest(
      workingDirectoryPaths: [first.rootURL.path, second.rootURL.path]
    )

    #expect(request.resolve() == iconURL)
  }

  @Test
  func skipsPathsWithoutAnIcon() throws {
    let first = try RepositoryIconFixture(name: "first")
    let second = try RepositoryIconFixture(name: "second")
    defer {
      first.remove()
      second.remove()
    }
    let iconURL = try second.writeIcon()
    let request = TerminalTabGroupIconRequest(
      workingDirectoryPaths: [first.rootURL.path, second.rootURL.path]
    )

    #expect(request.resolve() == iconURL)
  }

  @Test
  func requestIdentityUsesItsOrderedUniqueSearchPaths() {
    let request = TerminalTabGroupIconRequest(
      workingDirectoryPaths: ["/repo", "/repo", "/other"]
    )
    let equivalent = TerminalTabGroupIconRequest(
      workingDirectoryPaths: ["/repo", "/other"]
    )
    let reversed = TerminalTabGroupIconRequest(
      workingDirectoryPaths: ["/other", "/repo"]
    )

    #expect(request == equivalent)
    #expect(request != reversed)
  }

  @Test
  func storeResolvesSharedRequestsOnce() async {
    let resolveCount = Mutex(0)
    let iconURL = URL(fileURLWithPath: "/tmp/icon.svg")
    let request = TerminalTabGroupIconRequest(workingDirectoryPaths: ["/repo"])
    let firstGroupID = TerminalTabGroupID()
    let secondGroupID = TerminalTabGroupID()
    let store = TerminalTabGroupIconStore { _ in
      resolveCount.withLock { $0 += 1 }
      return iconURL
    }
    let requests = [
      firstGroupID: request,
      secondGroupID: request,
    ]

    let firstLoad = Task { await store.load([firstGroupID: request]) }
    let secondLoad = Task { await store.load([secondGroupID: request]) }
    await firstLoad.value
    await secondLoad.value
    await store.load(requests)

    #expect(resolveCount.withLock { $0 } == 1)
    #expect(
      store.iconURLs(for: requests) == [
        firstGroupID: iconURL,
        secondGroupID: iconURL,
      ]
    )
  }

  @Test
  func storeCachesMissingIcons() async {
    let resolveCount = Mutex(0)
    let request = TerminalTabGroupIconRequest(workingDirectoryPaths: ["/repo"])
    let groupID = TerminalTabGroupID()
    let requests = [groupID: request]
    let store = TerminalTabGroupIconStore { _ in
      resolveCount.withLock { $0 += 1 }
      return nil
    }

    await store.load(requests)
    await store.load(requests)

    #expect(resolveCount.withLock { $0 } == 1)
    #expect(store.iconURLs(for: requests).isEmpty)
  }
}

private struct RepositoryIconFixture {
  let containerURL: URL
  let rootURL: URL

  init(name: String) throws {
    containerURL = FileManager.default.temporaryDirectory.appending(
      path: UUID().uuidString,
      directoryHint: .isDirectory
    )
    rootURL = containerURL.appending(path: name, directoryHint: .isDirectory)
    try FileManager.default.createDirectory(
      at: rootURL.appending(path: ".git", directoryHint: .isDirectory),
      withIntermediateDirectories: true
    )
  }

  func createDirectory(_ path: String) throws -> URL {
    let url = rootURL.appending(path: path, directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  func writeIcon() throws -> URL {
    let url = rootURL.appending(path: "assets/logo.svg", directoryHint: .notDirectory)
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(
      #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>"#
        .utf8
    ).write(to: url)
    return url.standardizedFileURL.resolvingSymlinksInPath()
  }

  func remove() {
    try? FileManager.default.removeItem(at: containerURL)
  }
}
