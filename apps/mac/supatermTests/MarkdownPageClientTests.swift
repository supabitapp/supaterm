import Foundation
import Testing
import WebKit

@testable import SupatermSupport

struct MarkdownPageClientTests {
  @Test
  @MainActor
  func createsPrivateBrowserRenderedPage() async throws {
    let root = FileManager.default.temporaryDirectory.appending(
      path: UUID().uuidString,
      directoryHint: .isDirectory
    )
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: root) }
    let pageURL = try createPage(in: root)
    let rendered = try await renderedPage(at: pageURL)

    #expect(rendered.headings == ["Result", "After autolinks", "After unfinished code"])
    #expect(rendered.listItems == ["One", "Two", "Still parsed"])
    #expect(rendered.tableCells == ["Build", "Done"])
    #expect(rendered.code.contains("let value = 1\n"))
    #expect(rendered.code.contains("<https://code.example>"))
    #expect(rendered.contentScripts == 0)
    #expect(rendered.contentFrames == 0)
    #expect(
      rendered.images == [
        RenderedPage.Image(
          source: "https://example.invalid/image.png",
          loading: "lazy",
          referrerPolicy: "no-referrer"
        )
      ]
    )
    #expect(
      rendered.links == [
        RenderedPage.Link(href: "https://example.com", target: "_blank", rel: "noreferrer noopener"),
        RenderedPage.Link(href: "https://example.net", target: "_blank", rel: "noreferrer noopener"),
        RenderedPage.Link(href: "https://example.org/path", target: "_blank", rel: "noreferrer noopener"),
        RenderedPage.Link(
          href: "mailto:hello@example.com",
          target: "_blank",
          rel: "noreferrer noopener"
        ),
      ]
    )
    #expect(rendered.text.contains("<script>alert(\"unsafe\")</script>"))
    #expect(rendered.text.contains("<iframe src=\"/unsafe\"></iframe>"))
    #expect(rendered.text.contains("![Unsafe](file:///tmp/image.png)"))
    #expect(rendered.text.contains("[Unsafe](javascript:alert(\"unsafe\"))"))
    try expectPrivateFiles(for: pageURL)
  }

  @MainActor
  private func createPage(in root: URL) throws -> URL {
    let renderer = MarkdownPageRenderer(
      temporaryDirectoryURL: root,
      identifier: UUID()
    )
    return try renderer.create(
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

      <iframe src="/unsafe"></iframe>

      ![Remote](https://example.invalid/image.png)

      ![Unsafe](file:///tmp/image.png)

      [Safe](https://example.com)

      [Titled](https://example.net "Example website")

      <https://example.org/path>

      <hello@example.com>

      [Unsafe](javascript:alert("unsafe"))

      `<https://code.example>`

      ## After autolinks

      - Still parsed

      `unfinished

      ## After unfinished code
      """
    )
  }

  @MainActor
  private func renderedPage(at pageURL: URL) async throws -> RenderedPage {
    let webView = WKWebView()
    try await PageNavigation().load(pageURL, in: webView)
    let renderedJSON = try #require(
      try await webView.evaluateJavaScript(
        """
        JSON.stringify({
          headings: [...document.querySelectorAll("#content h1, #content h2")].map(node => node.textContent),
          listItems: [...document.querySelectorAll("#content ul li")].map(node => node.textContent),
          tableCells: [...document.querySelectorAll("#content td")].map(node => node.textContent),
          code: [...document.querySelectorAll("#content code")].map(node => node.textContent),
          contentScripts: document.querySelectorAll("#content script").length,
          contentFrames: document.querySelectorAll("#content iframe").length,
          images: [...document.querySelectorAll("#content img")].map(node => ({
            source: node.getAttribute("src"),
            loading: node.getAttribute("loading"),
            referrerPolicy: node.getAttribute("referrerpolicy")
          })),
          links: [...document.querySelectorAll("#content a")].map(node => ({
            href: node.getAttribute("href"),
            target: node.getAttribute("target"),
            rel: node.getAttribute("rel")
          })),
          text: document.getElementById("content").textContent
        })
        """
      ) as? String
    )
    return try JSONDecoder().decode(RenderedPage.self, from: Data(renderedJSON.utf8))
  }

  private func expectPrivateFiles(for pageURL: URL) throws {
    let page = try String(contentsOf: pageURL, encoding: .utf8)
    #expect(page.contains("default-src 'none'"))
    #expect(page.contains("script-src 'nonce-"))
    #expect(page.contains("img-src https:"))
    let rendererURL = pageURL.deletingLastPathComponent().appending(path: "markdown-it.min.js")
    #expect(FileManager.default.fileExists(atPath: rendererURL.path))

    let directoryPermissions = try permissions(at: pageURL.deletingLastPathComponent())
    let pagePermissions = try permissions(at: pageURL)
    let rendererPermissions = try permissions(at: rendererURL)
    #expect(directoryPermissions == 0o700)
    #expect(pagePermissions == 0o600)
    #expect(rendererPermissions == 0o600)
  }

  private func permissions(at url: URL) throws -> Int? {
    let value = try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions]
    return (value as? NSNumber)?.intValue
  }
}

private struct RenderedPage: Decodable {
  struct Image: Decodable, Equatable {
    let source: String
    let loading: String
    let referrerPolicy: String
  }

  struct Link: Decodable, Equatable {
    let href: String
    let target: String
    let rel: String
  }

  let headings: [String]
  let listItems: [String]
  let tableCells: [String]
  let code: [String]
  let contentScripts: Int
  let contentFrames: Int
  let images: [Image]
  let links: [Link]
  let text: String
}

@MainActor
private final class PageNavigation: NSObject, WKNavigationDelegate {
  private var continuation: CheckedContinuation<Void, any Error>?

  func load(_ pageURL: URL, in webView: WKWebView) async throws {
    try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      webView.navigationDelegate = self
      webView.loadFileURL(
        pageURL,
        allowingReadAccessTo: pageURL.deletingLastPathComponent()
      )
    }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
    resume()
  }

  func webView(
    _ webView: WKWebView,
    didFail navigation: WKNavigation?,
    withError error: any Error
  ) {
    resume(throwing: error)
  }

  func webView(
    _ webView: WKWebView,
    didFailProvisionalNavigation navigation: WKNavigation?,
    withError error: any Error
  ) {
    resume(throwing: error)
  }

  private func resume(throwing error: (any Error)? = nil) {
    guard let continuation else { return }
    self.continuation = nil
    if let error {
      continuation.resume(throwing: error)
    } else {
      continuation.resume()
    }
  }
}
