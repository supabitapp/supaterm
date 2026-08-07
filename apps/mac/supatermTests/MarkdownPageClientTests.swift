import Foundation
import Testing

@testable import SupatermSupport

struct MarkdownPageClientTests {
  @Test
  @MainActor
  func createsPrivateStaticPage() throws {
    let root = FileManager.default.temporaryDirectory.appending(
      path: UUID().uuidString,
      directoryHint: .isDirectory
    )
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    let identifier = UUID()
    let renderer = MarkdownPageRenderer(
      temporaryDirectoryURL: root,
      identifier: identifier
    )

    let pageURL = try renderer.create(
      """
      # Result

      - One
      - Two

      | Name | State |
      | --- | --- |
      | Build | Done |

      ```swift
      let value = 1
      ```

      <script>alert("unsafe")</script>

      ![Remote](https://example.com/image.png)

      [Safe](https://example.com)

      [Titled](https://example.net "Example website")

      <https://example.org/path>

      <hello@example.com>

      [Unsafe](javascript:alert("unsafe"))

      `<https://code.example>`

      ## After autolinks

      - Still parsed

      `unfinished

      <iframe src="https://example.com"></iframe>

      ## After unfinished code
      """
    )
    let page = try String(contentsOf: pageURL, encoding: .utf8)
    let document = try XMLDocument(contentsOf: pageURL, options: .documentTidyHTML)

    #expect(page.contains("<h1>Result</h1>"))
    #expect(
      try document.nodes(forXPath: "//ul/li").compactMap(\.stringValue) == ["One", "Two", "Still parsed"]
    )
    #expect(page.contains("<td>Done</td>"))
    #expect(page.contains("<pre><code>let value = 1\n</code></pre>"))
    #expect(try document.nodes(forXPath: "//script").isEmpty)
    #expect(try document.nodes(forXPath: "//img").isEmpty)
    #expect(try document.nodes(forXPath: "//iframe").isEmpty)
    #expect(
      try document.nodes(forXPath: "//a").compactMap { node in
        (node as? XMLElement)?.attribute(forName: "href")?.stringValue
      } == [
        "https://example.com", "https://example.net", "https://example.org/path", "mailto:hello@example.com",
      ]
    )
    #expect(
      try document.nodes(forXPath: "//code").contains { $0.stringValue == "<https://code.example>" }
    )
    #expect(page.contains("<h2>After autolinks</h2><ul><li>Still parsed</li></ul>"))
    #expect(page.contains("<h2>After unfinished code</h2>"))
    #expect(document.stringValue?.contains("<script>alert(\"unsafe\")</script>") == true)
    let policy = try #require(
      document.nodes(forXPath: "//meta[@http-equiv='Content-Security-Policy']").first as? XMLElement
    )
    #expect(policy.attribute(forName: "content")?.stringValue?.contains("default-src 'none'") == true)

    let directoryPermissions =
      try FileManager.default.attributesOfItem(
        atPath: pageURL.deletingLastPathComponent().path
      )[.posixPermissions] as? NSNumber
    let pagePermissions =
      try FileManager.default.attributesOfItem(atPath: pageURL.path)[
        .posixPermissions
      ] as? NSNumber
    #expect(directoryPermissions?.intValue == 0o700)
    #expect(pagePermissions?.intValue == 0o600)
  }
}
