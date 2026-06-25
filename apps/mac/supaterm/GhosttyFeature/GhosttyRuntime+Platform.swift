import AppKit
import GhosttyKit
import UniformTypeIdentifiers

extension Notification.Name {
  public static let ghosttyRuntimeConfigDidChange = Notification.Name("ghosttyRuntimeConfigDidChange")
}

extension NSPasteboard.PasteboardType {
  static let supatermPNGImage = NSPasteboard.PasteboardType("public.png")
  static let supatermTIFFImage = NSPasteboard.PasteboardType("public.tiff")

  init?(mimeType: String) {
    switch mimeType {
    case "text/plain":
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

  static var ghosttySelection: NSPasteboard = {
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
