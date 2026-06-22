import AppKit

extension GhosttySurfaceView {
  private static let dropTypes: Set<NSPasteboard.PasteboardType> = [
    .string,
    .fileURL,
    .URL,
    .supatermPNGImage,
    .supatermTIFFImage,
  ]

  func registerSupportedDragTypes() {
    registerForDraggedTypes(Array(Self.dropTypes))
  }

  public override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    guard let types = sender.draggingPasteboard.types else { return [] }
    if Set(types).isDisjoint(with: Self.dropTypes) {
      return []
    }
    return .copy
  }

  public override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    let pasteboard = sender.draggingPasteboard
    let content: String?
    if let url = pasteboard.string(forType: .URL) {
      content = NSPasteboard.ghosttyEscape(url)
    } else if let urls = pasteboard.readObjects(forClasses: [NSURL.self]) as? [URL],
      !urls.isEmpty
    {
      content = urls.map { NSPasteboard.ghosttyEscape($0.path) }.joined(separator: " ")
    } else if let str = pasteboard.string(forType: .string) {
      content = str
    } else {
      content = pasteboard.writeImageToTempFile()
    }

    guard let content else { return false }
    Task { @MainActor in
      self.insertText(content, replacementRange: NSRange(location: 0, length: 0))
    }
    return true
  }
}
