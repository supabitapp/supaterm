import AppKit
import GhosttyKit
import UniformTypeIdentifiers

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
    state: UnsafeMutableRawPointer?
  ) -> Bool {
    guard
      let surface = view.surface,
      let pasteboard = pasteboardProvider(location),
      let value = pasteboard.getOpinionatedStringContents()
    else { return false }
    value.withCString { pointer in
      ghostty_surface_complete_clipboard_request(surface, pointer, state, false)
    }
    return true
  }

  func confirmRead(
    from view: GhosttySurfaceView,
    surfaceReference: GhosttyRuntime.SurfaceReference?,
    value: String?,
    state: UnsafeMutableRawPointer?,
    request: ghostty_clipboard_request_e
  ) {
    guard let surface = view.surface else { return }
    let complete: (String) -> Void = { value in
      value.withCString { pointer in
        ghostty_surface_complete_clipboard_request(surface, pointer, state, true)
      }
    }
    guard
      let value,
      let request = GhosttyClipboardConfirmationRequest(request),
      let surfaceReference,
      surfaceReference.isValid
    else {
      complete("")
      return
    }
    confirmations.present(
      contents: value,
      request: request,
      surface: surfaceReference,
      view: view
    ) { allowed in
      guard surfaceReference.isValid else { return }
      complete(allowed ? value : "")
    }
  }

  func write(
    from view: GhosttySurfaceView,
    surfaceReference: GhosttyRuntime.SurfaceReference?,
    location: ghostty_clipboard_e,
    items: [(mime: String, data: String)],
    confirm: Bool
  ) {
    guard confirm else {
      write(items, to: location)
      return
    }
    guard
      let surfaceReference,
      surfaceReference.isValid,
      let pasteboard = pasteboardProvider(location)
    else { return }
    let textItems = items.filter { $0.mime == "text/plain" }
    guard textItems.count == 1, let item = textItems.first else { return }
    confirmations.present(
      contents: item.data,
      request: .osc52Write,
      surface: surfaceReference,
      view: view
    ) { allowed in
      guard allowed, surfaceReference.isValid else { return }
      pasteboard.declareTypes([.string], owner: nil)
      pasteboard.setString(item.data, forType: .string)
    }
  }

  func cancel(surface: GhosttyRuntime.SurfaceReference) {
    confirmations.cancel(surface: surface)
  }

  func cancelAll() {
    confirmations.cancelAll()
  }

  private func write(
    _ items: [(mime: String, data: String)],
    to location: ghostty_clipboard_e
  ) {
    guard let pasteboard = pasteboardProvider(location) else { return }
    let pasteboardItems: [(type: NSPasteboard.PasteboardType, data: String)] = items.compactMap { item in
      guard let type = NSPasteboard.PasteboardType(mimeType: item.mime) else { return nil }
      return (type: type, data: item.data)
    }
    pasteboard.declareTypes(pasteboardItems.map(\.type), owner: nil)
    for item in pasteboardItems {
      pasteboard.setString(item.data, forType: item.type)
    }
  }
}

extension NSPasteboard.PasteboardType {
  static let supatermPNGImage = NSPasteboard.PasteboardType("public.png")
  static let supatermTIFFImage = NSPasteboard.PasteboardType("public.tiff")

  init?(mimeType: String) {
    if mimeType == "text/plain" {
      self = .string
      return
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
    if let urls = readObjects(forClasses: [NSURL.self]) as? [URL],
      !urls.isEmpty
    {
      return
        urls
        .map { $0.isFileURL ? Self.ghosttyEscape($0.path) : $0.absoluteString }
        .joined(separator: " ")
    }
    if let string = string(forType: .string) {
      return string
    }
    return writeImageToTempFile()
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
    default:
      return nil
    }
  }
}
