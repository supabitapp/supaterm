import AppKit
import GhosttyKit
import UniformTypeIdentifiers

private nonisolated final class GhosttyClipboardDataProvider: NSObject,
  NSPasteboardItemDataProvider
{
  private let dataByType: [NSPasteboard.PasteboardType: Data]

  init(dataByType: [NSPasteboard.PasteboardType: Data]) {
    self.dataByType = dataByType
  }

  func pasteboard(
    _ pasteboard: NSPasteboard?,
    item: NSPasteboardItem,
    provideDataForType type: NSPasteboard.PasteboardType
  ) {
    guard let data = dataByType[type] else { return }
    item.setData(data, forType: type)
  }
}

nonisolated enum GhosttyPasteboard {
  @MainActor static func normalizedContents(
    _ contents: [GhosttyClipboardContent]
  ) -> [GhosttyClipboardContent] {
    var seen = Set<String>()
    return contents.filter { content in
      let type = NSPasteboard.PasteboardType(mimeType: content.mime)
      return seen.insert(type.rawValue).inserted
    }
  }

  @MainActor static func writeNormalized(
    _ contents: [GhosttyClipboardContent],
    to pasteboard: NSPasteboard,
    dataProvider: (any NSPasteboardItemDataProvider)? = nil
  ) -> Bool {
    let types = contents.map { NSPasteboard.PasteboardType(mimeType: $0.mime) }
    guard !types.isEmpty else { return false }
    let dataByType = Dictionary(uniqueKeysWithValues: zip(types, contents.map(\.data)))
    let item = NSPasteboardItem()
    guard
      item.setDataProvider(
        dataProvider ?? GhosttyClipboardDataProvider(dataByType: dataByType),
        forTypes: types
      )
    else { return false }
    pasteboard.clearContents()
    return pasteboard.writeObjects([item])
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
    let pasteboard = NSPasteboard(name: NSPasteboard.Name("app.supabit.supaterm.selection"))
    pasteboard.clearContents()
    return pasteboard
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
