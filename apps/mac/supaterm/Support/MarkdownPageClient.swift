import ComposableArchitecture
import Foundation

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
  case rendererMissing
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
    var succeeded = false
    defer {
      if !succeeded {
        try? fileManager.removeItem(at: directoryURL)
      }
    }

    guard
      let bundledRendererURL = Bundle.module.url(
        forResource: "markdown-it-15.0.0.min",
        withExtension: "js"
      )
    else {
      throw MarkdownPageError.rendererMissing
    }
    let rendererURL = directoryURL.appending(
      path: "markdown-it.min.js",
      directoryHint: .notDirectory
    )
    try fileManager.copyItem(at: bundledRendererURL, to: rendererURL)
    try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: rendererURL.path)

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
    succeeded = true
    return pageURL
  }

  private func pageData(_ markdown: String) -> Data {
    let encodedMarkdown = Data(markdown.utf8).base64EncodedString()
    let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")
    return Data(Self.document(encodedMarkdown: encodedMarkdown, nonce: nonce).utf8)
  }

  private static func document(encodedMarkdown: String, nonce: String) -> String {
    """
    <!doctype html>
    <html>
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'nonce-\(nonce)'; style-src 'unsafe-inline';
      img-src https:; media-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none';
      object-src 'none'; form-action 'none'; base-uri 'none'">
    <title>Agent message — Supaterm</title>
    <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html { min-height: 100%; background: #12100b; }
    body {
      max-width: 880px;
      min-height: 100%;
      margin: 0 auto;
      padding: 48px 32px 80px;
      background: #12100b;
      color: #ebe8df;
      font: 16px/1.6 -apple-system, BlinkMacSystemFont, sans-serif;
    }
    h1, h2, h3, h4, h5, h6 {
      margin: 1.5em 0 0.55em;
      color: #f5f1e7;
      line-height: 1.25;
    }
    h1 { font-size: 2em; }
    h2 { padding-bottom: 0.3em; border-bottom: 1px solid #403b32; font-size: 1.5em; }
    h3 { font-size: 1.25em; }
    h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
    p, ul, ol, pre, blockquote, table, hr { margin: 0 0 1em; }
    ul, ol { padding-left: 2em; }
    li + li { margin-top: 0.25em; }
    li > ul, li > ol { margin: 0.25em 0 0; }
    a { color: #82aaff; overflow-wrap: anywhere; }
    code, pre { background: #24211c; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
    code { padding: 0.15em 0.35em; border-radius: 4px; }
    pre { overflow-x: auto; padding: 16px; border: 1px solid #403b32; border-radius: 8px; }
    pre code { padding: 0; border-radius: 0; background: none; }
    blockquote { padding-left: 16px; border-left: 3px solid #5d5548; color: #b7b1a5; }
    blockquote > :last-child { margin-bottom: 0; }
    table { display: block; width: 100%; overflow-x: auto; border-collapse: collapse; }
    td, th { padding: 8px 12px; border: 1px solid #403b32; text-align: left; white-space: nowrap; }
    th { background: #24211c; }
    img { display: block; max-width: 100%; height: auto; border-radius: 8px; }
    hr { height: 1px; border: 0; background: #5d5548; }
    s { color: #8f897e; }
    @media (max-width: 640px) { body { padding: 28px 20px 56px; } }
    </style>
    </head>
    <body>
    <main id="content"></main>
    <script nonce="\(nonce)" src="markdown-it.min.js"></script>
    <script nonce="\(nonce)">
    try {
      const bytes = Uint8Array.from(atob("\(encodedMarkdown)"), character => character.charCodeAt(0));
      const markdown = new TextDecoder().decode(bytes);
      const renderer = markdownit({ html: false, linkify: true });
      renderer.validateLink = value => /^(https?:|mailto:)/i.test(value);
      renderer.renderer.rules.link_open = (tokens, index, options, environment, self) => {
        tokens[index].attrSet("target", "_blank");
        tokens[index].attrSet("rel", "noreferrer noopener");
        return self.renderToken(tokens, index, options);
      };
      const renderImage = renderer.renderer.rules.image;
      renderer.renderer.rules.image = (tokens, index, options, environment, self) => {
        const source = tokens[index].attrGet("src");
        if (!source || !source.toLowerCase().startsWith("https://")) {
          return renderer.utils.escapeHtml(tokens[index].content);
        }
        tokens[index].attrSet("loading", "lazy");
        tokens[index].attrSet("referrerpolicy", "no-referrer");
        return renderImage(tokens, index, options, environment, self);
      };
      document.getElementById("content").innerHTML = renderer.render(markdown);
    } catch {
      document.getElementById("content").textContent = "Could not render this message.";
    }
    </script>
    </body>
    </html>
    """
  }
}
