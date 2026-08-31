import AppKit
import Darwin
import GhosttyKit
import ImageIO
import UniformTypeIdentifiers

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
    guard
      let mimePointer = content.mime,
      let mime = String(validatingCString: mimePointer),
      content.len == 0 || content.data != nil
    else { return nil }
    let copiedByteCount = min(content.len, max(maximumBytes ?? content.len, 0))
    self.init(
      mime: mime,
      data: content.data.map { Data(bytes: $0, count: copiedByteCount) } ?? Data(),
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
      value.contents_len == 0 || value.contents != nil,
      value.available_len == 0 || value.available != nil
    else { return nil }
    var copiedContents: [GhosttyClipboardContent] = []
    var remainingBytes =
      request == GHOSTTY_CLIPBOARD_REQUEST_KITTY_WRITE
      ? GhosttyClipboardDisplay.maximumPromptCopyBytes
      : Int.max
    if let source = value.contents {
      copiedContents.reserveCapacity(value.contents_len)
      for index in 0..<value.contents_len {
        guard
          let content = GhosttyClipboardContent(
            copying: source[index],
            maximumBytes: remainingBytes
          )
        else { return nil }
        copiedContents.append(content)
        remainingBytes -= content.data.count
      }
    }
    var copiedAvailable: [String] = []
    if let source = value.available {
      copiedAvailable.reserveCapacity(value.available_len)
      for index in 0..<value.available_len {
        guard
          let pointer = source[index],
          let mime = String(validatingCString: pointer)
        else { return nil }
        copiedAvailable.append(mime)
      }
    }
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

@MainActor
final class GhosttyClipboard {
  private let confirmations = GhosttyClipboardConfirmationCoordinator()
  private let pasteboardProvider: (ghostty_clipboard_e) -> NSPasteboard?

  init(pasteboardProvider: @escaping (ghostty_clipboard_e) -> NSPasteboard?) {
    self.pasteboardProvider = pasteboardProvider
  }

  func read(
    from view: GhosttySurfaceView,
    location: ghostty_clipboard_e,
    state: UnsafeMutableRawPointer?,
    request: GhosttyClipboardReadRequest
  ) -> ghostty_clipboard_read_result_e {
    guard
      location != GHOSTTY_CLIPBOARD_PRIMARY,
      view.surface != nil,
      state != nil
    else { return GHOSTTY_CLIPBOARD_READ_UNSUPPORTED }
    guard let pasteboard = pasteboardProvider(location) else {
      return GHOSTTY_CLIPBOARD_READ_UNSUPPORTED
    }

    var seen = Set<String>()
    let contents = request.mimes.compactMap { mime -> GhosttyClipboardContent? in
      guard seen.insert(mime).inserted else { return nil }
      guard let data = pasteboard.ghosttyData(forMime: mime, request: request.kind) else {
        return nil
      }
      return GhosttyClipboardContent(mime: mime, data: data)
    }
    let available = request.listsAvailableTypes ? pasteboard.ghosttyAvailableMimes() : []
    guard !contents.isEmpty || request.listsAvailableTypes else {
      return GHOSTTY_CLIPBOARD_READ_UNAVAILABLE
    }
    guard let surface = view.surface else { return GHOSTTY_CLIPBOARD_READ_UNSUPPORTED }
    complete(surface: surface, contents: contents, available: available, state: state)
    return GHOSTTY_CLIPBOARD_READ_STARTED
  }

  func confirmRead(
    from view: GhosttySurfaceView,
    surfaceReference: GhosttyRuntime.SurfaceReference?,
    payload: GhosttyClipboardConfirmationPayload?,
    state: UnsafeMutableRawPointer?,
    request: ghostty_clipboard_request_e
  ) {
    guard
      let state,
      let surfaceReference,
      surfaceReference.isValid,
      let payload,
      let request = GhosttyClipboardConfirmationRequest(request)
    else {
      deny(from: view, state: state)
      return
    }

    let confirmedPayload =
      request == .kittyWrite
      ? GhosttyClipboardConfirmationPayload(
        contents: Self.normalizedWriteContents(payload.contents),
        available: payload.available,
        programName: payload.programName,
        canRemember: payload.canRemember
      )
      : payload

    _ = confirmations.present(
      payload: confirmedPayload,
      request: request,
      surface: surfaceReference,
      view: view
    ) { [weak view] allowed, remember in
      guard surfaceReference.isValid else { return }
      if allowed {
        self.complete(
          surface: surfaceReference.surface,
          contents: request == .kittyWrite ? [] : confirmedPayload.contents,
          available: confirmedPayload.available,
          state: state,
          confirmed: true,
          remember: remember
        )
        if request == .paste {
          view?.confirmedPasteDidComplete()
        }
      } else {
        ghostty_surface_deny_clipboard_request(surfaceReference.surface, state)
      }
    }
  }

  func write(
    from view: GhosttySurfaceView,
    surfaceReference: GhosttyRuntime.SurfaceReference?,
    location: ghostty_clipboard_e,
    items: [GhosttyClipboardContent],
    confirm: Bool
  ) -> Bool {
    let items = Self.normalizedWriteContents(items)
    guard let pasteboard = pasteboardProvider(location), !items.isEmpty else { return false }
    guard confirm else {
      return Self.write(items, to: pasteboard)
    }
    guard let surfaceReference, surfaceReference.isValid else { return false }
    let payload = GhosttyClipboardConfirmationPayload(
      contents: items,
      available: [],
      programName: nil,
      canRemember: false
    )
    return confirmations.present(
      payload: payload,
      request: .osc52Write,
      surface: surfaceReference,
      view: view
    ) { [weak self] allowed, _ in
      guard allowed, surfaceReference.isValid else { return }
      guard self != nil else { return }
      _ = Self.write(items, to: pasteboard)
    }
  }

  func cancel(surface: GhosttyRuntime.SurfaceReference) {
    confirmations.cancel(surface: surface)
  }

  func cancelAll() {
    confirmations.cancelAll()
  }

  static func normalizedWriteContents(
    _ contents: [GhosttyClipboardContent]
  ) -> [GhosttyClipboardContent] {
    var seen = Set<String>()
    return contents.filter { content in
      let type = NSPasteboard.PasteboardType(mimeType: content.mime)
      return seen.insert(type.rawValue).inserted
    }
  }

  private func deny(from view: GhosttySurfaceView, state: UnsafeMutableRawPointer?) {
    guard let surface = view.surface, let state else { return }
    ghostty_surface_deny_clipboard_request(surface, state)
  }

  private func complete(
    surface: ghostty_surface_t,
    contents: [GhosttyClipboardContent],
    available: [String],
    state: UnsafeMutableRawPointer?,
    confirmed: Bool = false,
    remember: Bool = false
  ) {
    var strings: [UnsafeMutablePointer<CChar>] = []
    var dataBuffers: [UnsafeMutableRawPointer] = []
    defer {
      for string in strings {
        free(string)
      }
      for buffer in dataBuffers {
        buffer.deallocate()
      }
    }

    let cContents = contents.compactMap { entry -> ghostty_clipboard_content_s? in
      guard let mime = strdup(entry.mime) else { return nil }
      strings.append(mime)
      let buffer = UnsafeMutableRawPointer.allocate(
        byteCount: max(entry.data.count, 1),
        alignment: 1
      )
      dataBuffers.append(buffer)
      entry.data.withUnsafeBytes { bytes in
        guard let source = bytes.baseAddress else { return }
        buffer.copyMemory(from: source, byteCount: bytes.count)
      }
      return ghostty_clipboard_content_s(
        mime: mime,
        data: buffer.assumingMemoryBound(to: CChar.self),
        len: entry.data.count
      )
    }
    let cAvailable: [UnsafePointer<CChar>?] = available.compactMap { mime in
      guard let value = strdup(mime) else { return nil }
      strings.append(value)
      return UnsafePointer(value)
    }.map(Optional.some)
    cContents.withUnsafeBufferPointer { contentsBuffer in
      cAvailable.withUnsafeBufferPointer { availableBuffer in
        var result = ghostty_clipboard_complete_s(
          contents: contentsBuffer.baseAddress,
          contents_len: contentsBuffer.count,
          available: availableBuffer.baseAddress,
          available_len: availableBuffer.count,
          confirmed: confirmed,
          remember: remember
        )
        ghostty_surface_complete_clipboard_request(surface, &result, state)
      }
    }
  }

  static func write(
    _ items: [GhosttyClipboardContent],
    to pasteboard: NSPasteboard,
    setData: ((Data, NSPasteboard.PasteboardType) -> Bool)? = nil
  ) -> Bool {
    let values = items.map { item in
      (NSPasteboard.PasteboardType(mimeType: item.mime), item.data)
    }
    let types = values.reduce(into: [NSPasteboard.PasteboardType]()) { result, value in
      if !result.contains(value.0) {
        result.append(value.0)
      }
    }
    guard !types.isEmpty else { return false }
    pasteboard.declareTypes(types, owner: nil)
    var wroteAll = true
    for (type, data) in values {
      let wrote = setData?(data, type) ?? pasteboard.setData(data, forType: type)
      wroteAll = wrote && wroteAll
    }
    return wroteAll
  }
}

extension NSPasteboard.PasteboardType {
  static let supatermPNGImage = NSPasteboard.PasteboardType("public.png")
  static let supatermTIFFImage = NSPasteboard.PasteboardType("public.tiff")

  init(mimeType: String) {
    switch mimeType {
    case "text/plain", "text/plain;charset=utf-8", "UTF8_STRING", "TEXT", "STRING":
      self = .string
      return
    default:
      break
    }
    guard let utType = UTType(mimeType: mimeType) else {
      self.init(mimeType)
      return
    }
    self.init(utType.identifier)
  }
}

extension NSPasteboard {
  private static let ghosttyEscapeCharacters = "\\ ()[]{}<>\"'`!#$&;|*?\t"

  static func ghosttyEscape(_ str: String) -> String {
    var result = str
    for char in ghosttyEscapeCharacters {
      result = result.replacing(String(char), with: "\\\(char)")
    }
    return result
  }

  @MainActor static let ghosttySelection: NSPasteboard = {
    NSPasteboard(name: NSPasteboard.Name("com.mitchellh.ghostty.selection"))
  }()

  func getOpinionatedStringContents() -> String? {
    let strings = (pasteboardItems ?? []).compactMap { item in
      if let propertyList = item.propertyList(forType: .fileURL),
        let fileURL = NSURL(pasteboardPropertyList: propertyList, ofType: .fileURL) as URL?,
        fileURL.isFileURL
      {
        return Self.ghosttyEscape(fileURL.path)
      }
      return item.string(forType: .string)
    }

    if !strings.isEmpty {
      return strings.joined(separator: " ")
    }
    return writeImageToTempFile()
  }

  func ghosttyData(
    forMime mime: String,
    request: ghostty_clipboard_request_e
  ) -> Data? {
    if mime == "text/plain",
      request == GHOSTTY_CLIPBOARD_REQUEST_PASTE,
      let contents = getOpinionatedStringContents()
    {
      return Data(contents.utf8)
    }
    if let data = ghosttyDeclaredData(forMime: mime) {
      return data
    }
    if mime == "text/uri-list" {
      let urls = ghosttyFileURLs
      return urls.isEmpty ? nil : Data(urls.map { "\($0.absoluteString)\r\n" }.joined().utf8)
    }
    return nil
  }

  func ghosttyAvailableMimes() -> [String] {
    var result: [String] = []
    var seen = Set<String>()
    for type in ghosttyDeclaredTypes {
      let mime = type.ghosttyMIMEType
      guard let mime, seen.insert(mime).inserted else { continue }
      result.append(mime)
    }
    return result
  }

  private var ghosttyDeclaredTypes: [NSPasteboard.PasteboardType] {
    var result = (pasteboardItems ?? []).flatMap(\.types)
    for type in types ?? []
    where type.rawValue.contains("/") && !result.contains(type) {
      result.append(type)
    }
    return result
  }

  private func ghosttyDeclaredData(forMime mime: String) -> Data? {
    let declaredTypes = ghosttyDeclaredTypes
    let directType = NSPasteboard.PasteboardType(mime)
    let mappedType = NSPasteboard.PasteboardType(mimeType: mime)
    var candidates = [directType]
    if mappedType != directType {
      candidates.append(mappedType)
    }
    let matchingTypes = declaredTypes.filter {
      $0 != .fileURL && $0.ghosttyMIMEType == mime && !candidates.contains($0)
    }
    candidates.append(contentsOf: matchingTypes)
    for type in candidates where declaredTypes.contains(type) {
      if let data = data(forType: type) {
        return data
      }
    }
    return nil
  }

  func writeImageToTempFile() -> String? {
    let pngData: Data?
    if let direct = data(forType: .supatermPNGImage) {
      pngData = direct
    } else if let tiff = data(forType: .supatermTIFFImage),
      let rep = NSBitmapImageRep(data: tiff)
    {
      pngData = rep.representation(using: .png, properties: [:])
    } else {
      pngData = nil
    }

    guard let data = pngData else { return nil }

    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(
      "supaterm-pasted-images",
      isDirectory: true
    )
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let url = dir.appendingPathComponent("pasted-\(UUID().uuidString).png")
      try data.write(to: url)
      return Self.ghosttyEscape(url.path)
    } catch {
      return nil
    }
  }

  static func ghostty(_ clipboard: ghostty_clipboard_e) -> NSPasteboard? {
    switch clipboard {
    case GHOSTTY_CLIPBOARD_STANDARD:
      return Self.general
    case GHOSTTY_CLIPBOARD_SELECTION:
      return Self.ghosttySelection
    case GHOSTTY_CLIPBOARD_PRIMARY:
      return nil
    default:
      return nil
    }
  }

  private var ghosttyFileURLs: [URL] {
    (pasteboardItems ?? []).compactMap { item in
      guard
        let propertyList = item.propertyList(forType: .fileURL),
        let url = NSURL(pasteboardPropertyList: propertyList, ofType: .fileURL) as URL?,
        url.isFileURL
      else { return nil }
      return url
    }
  }
}

extension NSPasteboard.PasteboardType {
  fileprivate var ghosttyMIMEType: String? {
    if self == .fileURL {
      return "text/uri-list"
    }
    if rawValue == UTType.data.identifier {
      return "application/octet-stream"
    }
    if let preferred = UTType(rawValue)?.preferredMIMEType {
      return preferred == "text/plain;charset=utf-8" ? "text/plain" : preferred
    }
    return rawValue.contains("/") ? rawValue : nil
  }
}
