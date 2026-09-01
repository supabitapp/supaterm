import ArgumentParser
import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPGroupIconTests {
  @Test
  func resolvesWellKnownIconsInOrder() throws {
    let fixture = try SPGroupIconFixture()
    defer { fixture.remove() }
    let expectedURL = try fixture.write("public/favicon.svg")
    _ = try fixture.write("assets/logo.svg")

    #expect(SupatermGroupIconResolver.resolve(in: fixture.rootURL) == expectedURL)
  }

  @Test
  func resolvesDeclaredIconsBeforeWellKnownIcons() throws {
    let fixture = try SPGroupIconFixture()
    defer { fixture.remove() }
    _ = try fixture.write("favicon.svg")
    try fixture.writeText("index.html", #"<link rel="icon" href="/brand/icon.svg">"#)
    let expectedURL = try fixture.write("public/brand/icon.svg")

    #expect(SupatermGroupIconResolver.resolve(in: fixture.rootURL) == expectedURL)
  }

  @Test
  func resolvesHTMLIconMetadataFromPublic() throws {
    let fixture = try SPGroupIconFixture()
    defer { fixture.remove() }
    try fixture.writeText("index.html", #"<link href="/brand/logo.svg?v=1" rel="icon">"#)
    let expectedURL = try fixture.write("public/brand/logo.svg")

    #expect(SupatermGroupIconResolver.resolve(in: fixture.rootURL) == expectedURL)
  }

  @Test
  func resolvesRouteIconMetadataWithEitherFieldOrder() throws {
    let fixture = try SPGroupIconFixture()
    defer { fixture.remove() }
    try fixture.writeText(
      "src/routes/__root.tsx",
      #"const links = [{ href: "/brand/logo.png", rel: "shortcut icon" }];"#
    )
    let expectedURL = try fixture.write("public/brand/logo.png")

    #expect(SupatermGroupIconResolver.resolve(in: fixture.rootURL) == expectedURL)
  }

  @Test
  func resolvesVectorIconsFromLinkedWebManifests() throws {
    let fixture = try SPGroupIconFixture()
    defer { fixture.remove() }
    try fixture.writeText(
      "index.html",
      #"<link href="/site.webmanifest" rel="manifest">"#
    )
    try fixture.writeText(
      "public/site.webmanifest",
      #"{"icons":[{"src":"icons/app.png","sizes":"512x512"},{"src":"icons/mark.svg","sizes":"any"}]}"#
    )
    _ = try fixture.write("public/icons/app.png")
    let expectedURL = try fixture.write("public/icons/mark.svg")

    #expect(SupatermGroupIconResolver.resolve(in: fixture.rootURL) == expectedURL)
  }

  @Test
  func resolvesLargestSquareRasterFromLinkedWebManifests() throws {
    let fixture = try SPGroupIconFixture()
    defer { fixture.remove() }
    try fixture.writeText(
      "index.html",
      #"<link rel="manifest" href="/site.webmanifest">"#
    )
    try fixture.writeText(
      "public/site.webmanifest",
      #"{"icons":[{"src":"icons/small.png","sizes":"128x128"},{"src":"icons/large.png","sizes":"512x512"}]}"#
    )
    _ = try fixture.write("public/icons/small.png")
    let expectedURL = try fixture.write("public/icons/large.png")

    #expect(SupatermGroupIconResolver.resolve(in: fixture.rootURL) == expectedURL)
  }

  @Test
  func ignoresNestedMetadata() throws {
    let fixture = try SPGroupIconFixture()
    defer { fixture.remove() }
    try fixture.writeText(
      "packages/app/index.html",
      #"<link rel="icon" href="icon.svg">"#
    )
    _ = try fixture.write("packages/app/icon.svg")

    #expect(SupatermGroupIconResolver.resolve(in: fixture.rootURL) == nil)
  }

  @Test
  func ignoresRemoteIconDeclarations() throws {
    let fixture = try SPGroupIconFixture()
    defer { fixture.remove() }
    try fixture.writeText(
      "index.html",
      #"<link rel="icon" href="https://example.com/icon.svg">"#
    )
    let expectedURL = try fixture.write("favicon.svg")

    #expect(SupatermGroupIconResolver.resolve(in: fixture.rootURL) == expectedURL)
  }

  @Test
  func ignoresOversizedMetadata() throws {
    let fixture = try SPGroupIconFixture()
    defer { fixture.remove() }
    var source = Data(#"<link rel="icon" href="/brand/icon.svg">"#.utf8)
    source.append(Data(repeating: 0x20, count: 1024 * 1024))
    try fixture.writeData("index.html", source)
    _ = try fixture.write("public/brand/icon.svg")
    let expectedURL = try fixture.write("favicon.svg")

    #expect(SupatermGroupIconResolver.resolve(in: fixture.rootURL) == expectedURL)
  }

  @Test
  func rejectsIconsOutsideTheDirectory() throws {
    let fixture = try SPGroupIconFixture()
    defer { fixture.remove() }
    let outsideURL = fixture.rootURL
      .deletingLastPathComponent()
      .appendingPathComponent("\(UUID().uuidString).svg", isDirectory: false)
    defer { try? FileManager.default.removeItem(at: outsideURL) }
    try Data("outside".utf8).write(to: outsideURL)
    let iconURL = fixture.rootURL.appendingPathComponent("assets/logo.svg", isDirectory: false)
    try FileManager.default.createDirectory(
      at: iconURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try FileManager.default.createSymbolicLink(at: iconURL, withDestinationURL: outsideURL)

    #expect(SupatermGroupIconResolver.resolve(in: fixture.rootURL) == nil)
  }

  @Test
  func rejectsNonImageIconMetadata() throws {
    let fixture = try SPGroupIconFixture()
    defer { fixture.remove() }
    try fixture.writeText("index.html", #"<link rel="icon" href="/secret.txt">"#)
    try fixture.writeText("public/secret.txt", "secret")

    #expect(SupatermGroupIconResolver.resolve(in: fixture.rootURL) == nil)
  }

  @Test
  func commandParsesDefaultPathAndJSONOutput() throws {
    let defaultCommand = try #require(
      try SP.parseAsRoot(["group", "icon"]) as? SP.GroupIcon
    )
    let explicitCommand = try #require(
      try SP.parseAsRoot(["group", "icon", "~/code/workspace", "--json"])
        as? SP.GroupIcon
    )

    #expect(defaultCommand.path == nil)
    #expect(explicitCommand.path == "~/code/workspace")
    #expect(explicitCommand.output.json)
  }

  @Test
  func projectCommandIsUnavailable() {
    #expect(throws: (any Error).self) {
      try SP.parseAsRoot(["project", "icon"])
    }
  }

  @Test
  func missingIconJSONIncludesNullPath() throws {
    #expect(try jsonString(SPGroupIconResult(path: nil)) == #"{"path":null}"#)
  }
}

private struct SPGroupIconFixture {
  let rootURL: URL

  init() throws {
    rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(
      "supaterm-group-icon-\(UUID().uuidString)",
      isDirectory: true
    )
    try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: false)
  }

  func write(_ relativePath: String) throws -> URL {
    let url = rootURL.appendingPathComponent(relativePath, isDirectory: false)
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(relativePath.utf8).write(to: url)
    return url.standardizedFileURL.resolvingSymlinksInPath()
  }

  func writeText(_ relativePath: String, _ text: String) throws {
    try writeData(relativePath, Data(text.utf8))
  }

  func writeData(_ relativePath: String, _ data: Data) throws {
    let url = rootURL.appendingPathComponent(relativePath, isDirectory: false)
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try data.write(to: url)
  }

  func remove() {
    try? FileManager.default.removeItem(at: rootURL)
  }
}
