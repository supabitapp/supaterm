import Foundation
import Testing

@testable import supaterm

struct TerminalSidebarGroupIconTests {
  @Test
  func resolvesIconFromTheGroupSharedRepository() throws {
    let fixture = try RepositoryIconFixture(name: "supaterm")
    defer { fixture.remove() }
    let iconURL = try fixture.writeIcon()
    let macURL = try fixture.createDirectory("apps/mac")
    let docsURL = try fixture.createDirectory("docs")
    let request = TerminalSidebarGroupIconRequest(
      workingDirectoryPathsByTab: [[macURL.path], [docsURL.path]]
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
    let request = TerminalSidebarGroupIconRequest(
      workingDirectoryPathsByTab: [[first.rootURL.path], [second.rootURL.path]]
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
    let request = TerminalSidebarGroupIconRequest(
      workingDirectoryPathsByTab: [[first.rootURL.path], [second.rootURL.path]]
    )

    #expect(request.resolve() == iconURL)
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
      #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>"#.utf8
    ).write(to: url)
    return url.standardizedFileURL.resolvingSymlinksInPath()
  }

  func remove() {
    try? FileManager.default.removeItem(at: containerURL)
  }
}
