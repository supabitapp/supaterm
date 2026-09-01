import Foundation

public nonisolated enum SupatermGroupIconResolver {
  private static let maximumMetadataBytes = 1024 * 1024

  private static let candidates = [
    "favicon.svg",
    "favicon.ico",
    "favicon.png",
    "public/favicon.svg",
    "public/favicon.ico",
    "public/favicon.png",
    "app/favicon.ico",
    "app/favicon.png",
    "app/icon.svg",
    "app/icon.png",
    "app/icon.ico",
    "src/favicon.ico",
    "src/favicon.svg",
    "src/app/favicon.ico",
    "src/app/icon.svg",
    "src/app/icon.png",
    "assets/icon.svg",
    "assets/icon.png",
    "assets/logo.svg",
    "assets/logo.png",
    ".idea/icon.svg",
  ]

  private static let sourceFiles = [
    "index.html",
    "public/index.html",
    "app/routes/__root.tsx",
    "src/routes/__root.tsx",
    "app/root.tsx",
    "src/root.tsx",
    "src/index.html",
  ]

  private static let imageExtensions = Set([
    "avif",
    "gif",
    "ico",
    "jpeg",
    "jpg",
    "png",
    "svg",
    "webp",
  ])

  private struct WebManifest: Decodable {
    let icons: [WebManifestIcon]?
  }

  private struct WebManifestIcon: Decodable {
    let sizes: String?
    let src: String?
  }

  private struct RankedIcon {
    let declarationIndex: Int
    let isVector: Bool
    let squareSize: Int
    let url: URL
  }

  public static func resolve(in directoryURL: URL) -> URL? {
    let rootURL = directoryURL.standardizedFileURL.resolvingSymlinksInPath()
    var isDirectory = ObjCBool(false)
    guard
      FileManager.default.fileExists(atPath: rootURL.path, isDirectory: &isDirectory),
      isDirectory.boolValue
    else {
      return nil
    }

    for sourceFile in sourceFiles {
      guard
        let sourceURL = existingFile(relativePath: sourceFile, rootURL: rootURL),
        let source = metadataString(at: sourceURL)
      else {
        continue
      }

      for href in relationshipHrefs(in: source, relationship: "icon") {
        if let iconURL = referencedIcon(
          href,
          relativeTo: sourceURL,
          rootURL: rootURL
        ) {
          return iconURL
        }
      }

      for href in relationshipHrefs(in: source, relationship: "manifest") {
        for manifestURL in referencedFiles(
          href,
          relativeTo: sourceURL,
          rootURL: rootURL
        ) {
          if let iconURL = webManifestIcon(at: manifestURL, rootURL: rootURL) {
            return iconURL
          }
        }
      }
    }

    for candidate in candidates {
      if let iconURL = existingIcon(relativePath: candidate, rootURL: rootURL) {
        return iconURL
      }
    }

    return nil
  }

  private static func webManifestIcon(at manifestURL: URL, rootURL: URL) -> URL? {
    guard
      let data = metadataData(at: manifestURL),
      let manifest = try? JSONDecoder().decode(WebManifest.self, from: data)
    else {
      return nil
    }

    let icons: [RankedIcon] = (manifest.icons ?? []).enumerated().compactMap {
      index, icon -> RankedIcon? in
      guard
        let src = icon.src,
        let url = referencedIcon(src, relativeTo: manifestURL, rootURL: rootURL)
      else {
        return nil
      }
      return RankedIcon(
        declarationIndex: index,
        isVector: url.pathExtension.lowercased() == "svg",
        squareSize: largestSquareSize(icon.sizes),
        url: url
      )
    }

    return icons.max {
      if $0.isVector != $1.isVector {
        return !$0.isVector && $1.isVector
      }
      if $0.squareSize != $1.squareSize {
        return $0.squareSize < $1.squareSize
      }
      return $0.declarationIndex > $1.declarationIndex
    }?.url
  }

  private static func largestSquareSize(_ sizes: String?) -> Int {
    sizes?
      .lowercased()
      .split(whereSeparator: { $0.isWhitespace })
      .compactMap { size in
        let dimensions = size.split(separator: "x", omittingEmptySubsequences: false)
        guard
          dimensions.count == 2,
          let width = Int(dimensions[0]),
          let height = Int(dimensions[1]),
          width == height
        else {
          return nil
        }
        return width
      }
      .max() ?? 0
  }

  private static func referencedIcon(
    _ reference: String,
    relativeTo sourceURL: URL,
    rootURL: URL
  ) -> URL? {
    for relativePath in referencedPaths(reference, relativeTo: sourceURL, rootURL: rootURL) {
      if let iconURL = existingIcon(relativePath: relativePath, rootURL: rootURL) {
        return iconURL
      }
    }
    return nil
  }

  private static func referencedFiles(
    _ reference: String,
    relativeTo sourceURL: URL,
    rootURL: URL
  ) -> [URL] {
    referencedPaths(reference, relativeTo: sourceURL, rootURL: rootURL).compactMap {
      existingFile(relativePath: $0, rootURL: rootURL)
    }
  }

  private static func referencedPaths(
    _ reference: String,
    relativeTo sourceURL: URL,
    rootURL: URL
  ) -> [String] {
    let value = reference.trimmingCharacters(in: .whitespacesAndNewlines)
    guard
      let components = URLComponents(string: value),
      components.scheme == nil,
      components.host == nil,
      let decodedPath = components.percentEncodedPath.removingPercentEncoding,
      !decodedPath.isEmpty
    else {
      return []
    }

    let rooted = decodedPath.hasPrefix("/")
    let path = rooted ? String(decodedPath.dropFirst()) : decodedPath
    guard !path.isEmpty else {
      return []
    }

    var paths: [String] = []
    if !rooted,
      let sourceDirectory = relativePath(
        of: sourceURL.deletingLastPathComponent(),
        rootURL: rootURL
      )
    {
      paths.append(sourceDirectory.isEmpty ? path : "\(sourceDirectory)/\(path)")
    }
    paths.append("public/\(path)")
    paths.append(path)
    return paths.reduce(into: []) { result, path in
      if !result.contains(path) {
        result.append(path)
      }
    }
  }

  private static func relativePath(of url: URL, rootURL: URL) -> String? {
    let rootComponents = rootURL.pathComponents
    let components = url.pathComponents
    guard Array(components.prefix(rootComponents.count)) == rootComponents else {
      return nil
    }
    return components.dropFirst(rootComponents.count).joined(separator: "/")
  }

  private static func existingIcon(relativePath: String, rootURL: URL) -> URL? {
    guard let url = existingFile(relativePath: relativePath, rootURL: rootURL) else {
      return nil
    }
    return imageExtensions.contains(url.pathExtension.lowercased()) ? url : nil
  }

  private static func existingFile(relativePath: String, rootURL: URL) -> URL? {
    let path = relativePath.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !path.isEmpty, !NSString(string: path).isAbsolutePath else {
      return nil
    }

    let fileURL =
      rootURL
      .appendingPathComponent(path, isDirectory: false)
      .standardizedFileURL
      .resolvingSymlinksInPath()
    let rootComponents = rootURL.pathComponents
    let fileComponents = fileURL.pathComponents
    guard
      fileComponents.count > rootComponents.count,
      Array(fileComponents.prefix(rootComponents.count)) == rootComponents
    else {
      return nil
    }

    guard
      (try? fileURL.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
    else {
      return nil
    }
    return fileURL
  }

  private static func metadataData(at url: URL) -> Data? {
    guard
      let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
      size <= maximumMetadataBytes
    else {
      return nil
    }
    return try? Data(contentsOf: url, options: .mappedIfSafe)
  }

  private static func metadataString(at url: URL) -> String? {
    guard let data = metadataData(at: url) else {
      return nil
    }
    return String(data: data, encoding: .utf8)
  }

  private static func relationshipHrefs(
    in source: String,
    relationship: String
  ) -> [String] {
    htmlRelationshipHrefs(in: source, relationship: relationship)
      + routeRelationshipHrefs(in: source, relationship: relationship)
  }

  private static func htmlRelationshipHrefs(
    in source: String,
    relationship: String
  ) -> [String] {
    guard
      let expression = try? NSRegularExpression(
        pattern: #"<link\b[^>]*>"#,
        options: .caseInsensitive
      )
    else {
      return []
    }

    return expression.matches(
      in: source,
      range: NSRange(source.startIndex..., in: source)
    ).compactMap { match in
      guard let range = Range(match.range, in: source) else {
        return nil
      }
      let tag = String(source[range])
      guard
        let rel = attribute("rel", in: tag),
        relationshipTokens(rel).contains(relationship),
        let href = attribute("href", in: tag)
      else {
        return nil
      }
      return href
    }
  }

  private static func routeRelationshipHrefs(
    in source: String,
    relationship: String
  ) -> [String] {
    source.split(separator: "}", omittingEmptySubsequences: false).compactMap { run in
      let value = String(run)
      guard
        let rel = firstCapture(pattern: #"\brel\s*:\s*["']([^"']+)["']"#, source: value),
        relationshipTokens(rel).contains(relationship),
        let href = firstCapture(pattern: #"\bhref\s*:\s*["']([^"']+)["']"#, source: value)
      else {
        return nil
      }
      return href
    }
  }

  private static func relationshipTokens(_ value: String) -> Set<String> {
    Set(value.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init))
  }

  private static func attribute(_ name: String, in source: String) -> String? {
    firstCapture(
      pattern: #"\b\#(name)\s*=\s*["']([^"']+)["']"#,
      source: source
    )
  }

  private static func firstCapture(pattern: String, source: String) -> String? {
    guard
      let expression = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
      let match = expression.firstMatch(
        in: source,
        range: NSRange(source.startIndex..., in: source)
      ),
      match.numberOfRanges > 1,
      let range = Range(match.range(at: 1), in: source)
    else {
      return nil
    }
    return String(source[range])
  }
}
