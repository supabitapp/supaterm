import AppKit
import GhosttyKit
import ImageIO

nonisolated enum GhosttyClipboardCStringArray {
  static func copying(
    _ source: UnsafePointer<UnsafePointer<CChar>?>?,
    count: Int
  ) -> [String]? {
    guard count >= 0, count == 0 || source != nil else { return nil }
    guard let source else { return [] }
    var result: [String] = []
    result.reserveCapacity(count)
    for index in 0..<count {
      guard
        let pointer = source[index],
        let value = String(validatingCString: pointer)
      else { return nil }
      result.append(value)
    }
    return result
  }
}

nonisolated enum GhosttyClipboardDisplay {
  static let maximumPreviewBytes = 16_384
  static let maximumPromptCopyBytes = 16_384
  static let maximumTextBytesPerContent = 4_096
  static let maximumMIMEBytes = 256
  static let maximumRequesterBytes = 256
  static let maximumRepresentations = 64
  static let maximumEncodedImageBytes = 8 * 1_024 * 1_024
  static let maximumImagePixelDimension = 1_024

  struct Sanitized: Equatable, Sendable {
    let text: String
    let sourceBytes: Int
    let totalSourceBytes: Int

    var isTruncated: Bool {
      sourceBytes < totalSourceBytes
    }
  }

  static func sanitize(
    _ value: String,
    maximumBytes: Int,
    preservingLineBreaks: Bool = false
  ) -> Sanitized {
    let maximumBytes = max(maximumBytes, 0)
    var text = ""
    var outputBytes = 0
    var sourceBytes = 0
    for scalar in value.unicodeScalars {
      let replacement = replacement(
        for: scalar,
        preservingLineBreaks: preservingLineBreaks
      )
      let replacementBytes = replacement.utf8.count
      guard outputBytes + replacementBytes <= maximumBytes else { break }
      text.append(replacement)
      outputBytes += replacementBytes
      sourceBytes += scalar.utf8.count
    }
    return Sanitized(
      text: text,
      sourceBytes: sourceBytes,
      totalSourceBytes: value.utf8.count
    )
  }

  static func bounded(_ value: String, maximumBytes: Int, marker: String) -> String {
    guard value.utf8.count > maximumBytes else { return value }
    let suffix = "\n\n\(marker)"
    let prefixLimit = max(maximumBytes - suffix.utf8.count, 0)
    var prefix = ""
    var byteCount = 0
    for scalar in value.unicodeScalars {
      let scalarBytes = scalar.utf8.count
      guard byteCount + scalarBytes <= prefixLimit else { break }
      prefix.unicodeScalars.append(scalar)
      byteCount += scalarBytes
    }
    return prefix + suffix
  }

  private static func replacement(
    for scalar: Unicode.Scalar,
    preservingLineBreaks: Bool
  ) -> String {
    switch scalar.value {
    case 0x09:
      return "\\t"
    case 0x0A:
      return preservingLineBreaks ? "\\n\n" : "\\n"
    case 0x0D:
      return "\\r"
    default:
      switch scalar.properties.generalCategory {
      case .control, .format, .lineSeparator, .paragraphSeparator:
        return "\\u{\(String(scalar.value, radix: 16, uppercase: true))}"
      default:
        return String(scalar)
      }
    }
  }
}

nonisolated struct GhosttyClipboardContent: Equatable, Sendable {
  let mime: String
  let data: Data
  let originalByteCount: Int

  init(mime: String, data: Data, originalByteCount: Int? = nil) {
    self.mime = mime
    self.data = data
    self.originalByteCount = max(originalByteCount ?? data.count, data.count)
  }

  init?(copying content: ghostty_clipboard_content_s, maximumBytes: Int? = nil) {
    self.init(
      copying: content,
      maximumBytes: maximumBytes,
      copyData: { pointer, count in Data(bytes: pointer, count: count) }
    )
  }

  static func copying(
    _ contents: UnsafeBufferPointer<ghostty_clipboard_content_s>,
    maximumTotalBytes: Int? = nil,
    copyData: (UnsafePointer<CChar>, Int) -> Data = {
      Data(bytes: $0, count: $1)
    }
  ) -> [Self]? {
    struct Payload: Hashable {
      let address: Int
      let count: Int
    }

    var copiedData: [Payload: Data] = [:]
    var remainingBytes = max(maximumTotalBytes ?? 0, 0)
    var result: [Self] = []
    result.reserveCapacity(contents.count)
    for content in contents {
      let payload = Payload(
        address: content.data.map { Int(bitPattern: $0) } ?? 0,
        count: content.len
      )
      let cachedData = copiedData[payload]
      guard
        let item = Self(
          copying: content,
          maximumBytes: cachedData?.count ?? maximumTotalBytes.map { _ in remainingBytes },
          copyData: { pointer, count in
            if let data = cachedData {
              return data
            }
            let data = copyData(pointer, count)
            copiedData[payload] = data
            return data
          }
        )
      else { return nil }
      result.append(item)
      if maximumTotalBytes != nil, cachedData == nil {
        remainingBytes -= item.data.count
      }
    }
    return result
  }

  private init?(
    copying content: ghostty_clipboard_content_s,
    maximumBytes: Int? = nil,
    copyData: (UnsafePointer<CChar>, Int) -> Data
  ) {
    guard
      let mimePointer = content.mime,
      let mime = String(validatingCString: mimePointer),
      content.len >= 0,
      content.len == 0 || content.data != nil
    else { return nil }
    let copiedByteCount = min(content.len, max(maximumBytes ?? content.len, 0))
    self.init(
      mime: mime,
      data: content.data.map { copyData($0, copiedByteCount) } ?? Data(),
      originalByteCount: content.len
    )
  }

  func displaySection(maximumTextBytes: Int) -> String {
    let mime = GhosttyClipboardDisplay.sanitize(
      mime,
      maximumBytes: GhosttyClipboardDisplay.maximumMIMEBytes
    )
    let mimeSuffix = mime.isTruncated ? "… [\(mime.totalSourceBytes) MIME bytes]" : ""
    let summary = "\(mime.text)\(mimeSuffix) (\(originalByteCount) bytes)"
    guard
      !self.mime.lowercased().hasPrefix("image/"),
      let text = validTextPrefix(maximumBytes: maximumTextBytes)
    else { return summary }
    let display = GhosttyClipboardDisplay.sanitize(
      text.value,
      maximumBytes: maximumTextBytes,
      preservingLineBreaks: true
    )
    guard !display.text.isEmpty else { return summary }
    let shownBytes = min(display.sourceBytes, text.byteCount)
    let truncation =
      shownBytes < originalByteCount
      ? "\n[Preview truncated: showing \(shownBytes) of \(originalByteCount) bytes]"
      : ""
    return "\(summary)\n\(display.text)\(truncation)"
  }

  private func validTextPrefix(maximumBytes: Int) -> (value: String, byteCount: Int)? {
    let upperBound = min(data.count, max(maximumBytes, 0))
    let lowerBound = max(upperBound - 3, 0)
    for byteCount in stride(from: upperBound, through: lowerBound, by: -1) {
      if let value = String(data: data.prefix(byteCount), encoding: .utf8) {
        return (value, byteCount)
      }
    }
    return nil
  }
}

nonisolated struct GhosttyClipboardReadRequest: Sendable {
  let kind: ghostty_clipboard_request_e
  let mimes: [String]
  let listsAvailableTypes: Bool
}

nonisolated struct GhosttyClipboardConfirmationPayload: Sendable {
  let contents: [GhosttyClipboardContent]
  let available: [String]
  let programName: String?
  let canRemember: Bool

  init(
    contents: [GhosttyClipboardContent],
    available: [String],
    programName: String?,
    canRemember: Bool
  ) {
    self.contents = contents
    self.available = available
    self.programName = programName
    self.canRemember = canRemember
  }

  init?(
    copying pointer: UnsafePointer<ghostty_clipboard_confirm_s>?,
    request: ghostty_clipboard_request_e
  ) {
    guard let pointer else { return nil }
    let value = pointer.pointee
    guard
      value.contents_len >= 0,
      value.available_len >= 0,
      value.contents_len == 0 || value.contents != nil,
      value.available_len == 0 || value.available != nil
    else { return nil }
    let maximumTotalBytes =
      request == GHOSTTY_CLIPBOARD_REQUEST_KITTY_WRITE
      ? GhosttyClipboardDisplay.maximumPromptCopyBytes
      : nil
    let source = UnsafeBufferPointer(start: value.contents, count: value.contents_len)
    guard
      let copiedContents = GhosttyClipboardContent.copying(
        source,
        maximumTotalBytes: maximumTotalBytes
      )
    else { return nil }
    guard
      let copiedAvailable = GhosttyClipboardCStringArray.copying(
        value.available,
        count: value.available_len
      )
    else { return nil }
    contents = copiedContents
    available = copiedAvailable
    programName = value.name.flatMap(String.init(validatingCString:))
    canRemember = value.can_remember
  }

  var preview: String {
    var sections = contents.prefix(GhosttyClipboardDisplay.maximumRepresentations).map {
      $0.displaySection(
        maximumTextBytes: GhosttyClipboardDisplay.maximumTextBytesPerContent
      )
    }
    if contents.count > GhosttyClipboardDisplay.maximumRepresentations {
      sections.append(
        "[\(contents.count - GhosttyClipboardDisplay.maximumRepresentations) representations omitted]"
      )
    }
    if !available.isEmpty {
      let types = available.prefix(GhosttyClipboardDisplay.maximumRepresentations).map { mime in
        let sanitized = GhosttyClipboardDisplay.sanitize(
          mime,
          maximumBytes: GhosttyClipboardDisplay.maximumMIMEBytes
        )
        let suffix = sanitized.isTruncated ? "…" : ""
        return "\(sanitized.text)\(suffix) (\(sanitized.totalSourceBytes) MIME bytes)"
      }
      let omitted = available.count - types.count
      let omission = omitted > 0 ? "\n[\(omitted) MIME types omitted]" : ""
      sections.append("Available MIME types\n\(types.joined(separator: "\n"))\(omission)")
    }
    return GhosttyClipboardDisplay.bounded(
      sections.joined(separator: "\n\n"),
      maximumBytes: GhosttyClipboardDisplay.maximumPreviewBytes,
      marker: "[Preview truncated at \(GhosttyClipboardDisplay.maximumPreviewBytes) UTF-8 bytes]"
    )
  }

  @MainActor var previewImage: NSImage? {
    contents.lazy
      .filter {
        $0.mime.lowercased().hasPrefix("image/")
          && $0.originalByteCount == $0.data.count
          && $0.data.count <= GhosttyClipboardDisplay.maximumEncodedImageBytes
      }
      .compactMap { content in
        guard
          let source = CGImageSourceCreateWithData(
            content.data as CFData,
            [kCGImageSourceShouldCache: false] as CFDictionary
          ),
          let image = CGImageSourceCreateThumbnailAtIndex(
            source,
            0,
            [
              kCGImageSourceCreateThumbnailFromImageAlways: true,
              kCGImageSourceCreateThumbnailWithTransform: true,
              kCGImageSourceShouldCacheImmediately: true,
              kCGImageSourceThumbnailMaxPixelSize:
                GhosttyClipboardDisplay.maximumImagePixelDimension,
            ] as CFDictionary
          )
        else { return nil }
        return NSImage(cgImage: image, size: .zero)
      }
      .first
  }
}
