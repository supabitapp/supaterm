import Foundation
import Testing

@testable import supaterm

struct TerminalSidebarProjectIconTests {
  @Test
  func resolvesIconFromTheStoredProjectRoot() throws {
    let fixture = try RepositoryIconFixture(name: "supaterm")
    defer { fixture.remove() }
    let iconURL = try fixture.writeIcon()
    let request = TerminalSidebarProjectIconRequest(rootPath: fixture.rootURL.path)

    #expect(request.resolve() == iconURL)
  }

  @Test
  func rootlessProjectHasNoIcon() {
    #expect(TerminalSidebarProjectIconRequest(rootPath: nil).resolve() == nil)
  }

  @Test
  func missingStoredRootHasNoIcon() {
    let path = FileManager.default.temporaryDirectory
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
      .path

    #expect(TerminalSidebarProjectIconRequest(rootPath: path).resolve() == nil)
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
