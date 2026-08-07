import ComposableArchitecture
import Foundation
import Ink

public struct MarkdownPageClient: Sendable {
  public var create: @MainActor @Sendable (String) throws -> URL

  public init(create: @escaping @MainActor @Sendable (String) throws -> URL) {
    self.create = create
  }
}

extension MarkdownPageClient: DependencyKey {
  public static let liveValue = Self(
    create: { markdown in
      try MarkdownPageRenderer().create(markdown)
    }
  )

  public static let testValue = Self(
    create: { _ in
      throw MarkdownPageError.creationFailed
    }
  )
}

extension DependencyValues {
  public var markdownPageClient: MarkdownPageClient {
    get { self[MarkdownPageClient.self] }
    set { self[MarkdownPageClient.self] = newValue }
  }
}

enum MarkdownPageError: Error {
  case creationFailed
}

@MainActor
struct MarkdownPageRenderer {
  private let directoryURL: URL
  private let fileManager: FileManager

  init(
    fileManager: FileManager = .default,
    temporaryDirectoryURL: URL = FileManager.default.temporaryDirectory,
    identifier: UUID = UUID()
  ) {
    self.fileManager = fileManager
    directoryURL = temporaryDirectoryURL.appending(
      path: "app.supabit.supaterm-markdown-\(identifier.uuidString)",
      directoryHint: .isDirectory
    )
  }

  func create(_ markdown: String) throws -> URL {
    try fileManager.createDirectory(
      at: directoryURL,
      withIntermediateDirectories: false,
      attributes: [.posixPermissions: 0o700]
    )
    let pageURL = directoryURL.appending(path: "last-agent-message.html", directoryHint: .notDirectory)
    guard
      fileManager.createFile(
        atPath: pageURL.path,
        contents: pageData(markdown),
        attributes: [.posixPermissions: 0o600]
      )
    else {
      throw MarkdownPageError.creationFailed
    }
    return pageURL
  }

  private func pageData(_ markdown: String) -> Data {
    let body = MarkdownParser(modifiers: [
      Modifier(target: .html) { input in
        Self.escapeHTML(input.markdown)
      },
      Modifier(target: .images) { input in
        Self.escapeHTML(input.markdown)
      },
      Modifier(target: .links) { input in
        Self.linkHTML(input)
      },
      Modifier(target: .codeBlocks) { input in
        Self.codeBlockHTML(input)
      },
    ]).html(from: markdown)
    return Data(Self.document(body).utf8)
  }

  private static func linkHTML(_ input: Modifier.Input) -> String {
    guard
      let document = try? XMLDocument(
        data: Data(input.html.utf8),
        options: .documentTidyHTML
      ),
      let element = try? document.nodes(forXPath: "//a").first as? XMLElement,
      let href = element.attribute(forName: "href")?.stringValue,
      let url = URL(string: href),
      let scheme = url.scheme?.lowercased(),
      ["http", "https"].contains(scheme),
      url.host != nil
    else {
      return escapeHTML(input.markdown)
    }
    return "<a href=\"\(escapeHTML(url.absoluteString))\">\(escapeHTML(element.stringValue ?? ""))</a>"
  }

  private static func codeBlockHTML(_ input: Modifier.Input) -> String {
    guard
      let document = try? XMLDocument(
        data: Data(input.html.utf8),
        options: .documentTidyHTML
      ),
      let code = try? document.nodes(forXPath: "//pre/code").first?.stringValue
    else {
      return escapeHTML(input.markdown)
    }
    return "<pre><code>\(escapeHTML(code))</code></pre>"
  }

  private static func escapeHTML<S: StringProtocol>(_ source: S) -> String {
    source.reduce(into: "") { result, character in
      switch character {
      case "&": result += "&amp;"
      case "<": result += "&lt;"
      case ">": result += "&gt;"
      case "\"": result += "&quot;"
      default: result.append(character)
      }
    }
  }

  private static func document(_ body: String) -> String {
    """
    <!doctype html>
    <html>
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; media-src 'none';
      font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none';
      form-action 'none'; base-uri 'none'">
    <title>Agent message — Supaterm</title>
    <style>
    html { min-height: 100%; background: #12100b; color-scheme: dark; }
    body {
      box-sizing: border-box;
      max-width: 880px;
      min-height: 100%;
      margin: 0 auto;
      padding: 48px 32px 80px;
      background: #12100b;
      color: #ebe8df;
      font: 16px -apple-system, BlinkMacSystemFont, sans-serif;
    }
    p { margin: 0 0 1em; line-height: 1.6; }
    h1, h2, h3, h4, h5, h6 {
      margin: 1.5em 0 0.55em;
      color: #f5f1e7;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
    p, li, blockquote, td, th {
      color: #ebe8df;
      font: 16px -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.6;
    }
    a { color: #82aaff; }
    code, pre {
      color: #ebe8df;
      background: #24211c;
      font: 14px ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    table { width: 100%; border-collapse: collapse; margin: 1.25em 0; }
    td, th { padding: 8px 12px; border: 1px solid #403b32; text-align: left; }
    blockquote { margin: 1.25em 0; padding-left: 16px; border-left: 3px solid #5d5548; color: #b7b1a5; }
    @media (max-width: 640px) { body { padding: 28px 20px 56px; } }
    </style>
    </head>
    <body>
    \(body)
    </body>
    </html>
    """
  }
}
