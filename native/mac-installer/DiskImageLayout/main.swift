import AppKit

// Lays out the installer's Finder window: a titled background, one large
// centered app icon, and the volume icon. Finder reads all of it from the
// volume's .DS_Store, which this writes in the same shape dmgbuild does.

// The window is the size of the background, title bar included, so its bottom
// is cropped. The spare height keeps the icon's label clear of Finder's path
// and status bars for people who show them.
let backgroundSize = NSSize(width: 560, height: 432)
let backgroundFileName = ".background.tiff"
let iconSize = 128.0
let iconCenter = (x: 280, y: 230)

func bigEndian<Value: FixedWidthInteger>(_ value: Value) -> Data {
  withUnsafeBytes(of: value.bigEndian) { Data($0) }
}

struct Bytes {
  var data = Data()

  mutating func u8(_ value: UInt8) { data.append(value) }
  mutating func u16(_ value: UInt16) { data.append(bigEndian(value)) }
  mutating func u32(_ value: UInt32) { data.append(bigEndian(value)) }
  mutating func ascii(_ value: String) { data.append(contentsOf: value.utf8) }
  mutating func zeros(_ count: Int) { data.append(Data(count: count)) }

  mutating func pascal(_ value: String, size: Int) {
    let bytes = Array(value.utf8.prefix(size - 1))
    u8(UInt8(bytes.count))
    data.append(contentsOf: bytes)
    zeros(size - 1 - bytes.count)
  }

  mutating func tag(_ id: UInt16, _ payload: Data) {
    u16(id)
    u16(UInt16(payload.count))
    data.append(payload)
    if payload.count % 2 == 1 { u8(0) }
  }
}

struct LayoutError: Error, CustomStringConvertible {
  let description: String
}

func drawCentered(_ text: String, font: NSFont, white: CGFloat, baselineFromTop: CGFloat) {
  let string = NSAttributedString(
    string: text,
    attributes: [.font: font, .foregroundColor: NSColor(srgbRed: white, green: white, blue: white, alpha: 1)])
  let x = (backgroundSize.width - string.size().width) / 2
  string.draw(with: NSRect(x: x, y: backgroundSize.height - baselineFromTop, width: 0, height: 0))
}

func backgroundRep(scale: Int) -> NSBitmapImageRep {
  let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: Int(backgroundSize.width) * scale,
    pixelsHigh: Int(backgroundSize.height) * scale,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0)!
  rep.size = backgroundSize
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSColor.white.setFill()
  NSRect(origin: .zero, size: backgroundSize).fill()
  drawCentered("Install Supaterm", font: .systemFont(ofSize: 28, weight: .semibold), white: 0.15, baselineFromTop: 80)
  drawCentered("Double-click the icon below", font: .systemFont(ofSize: 15), white: 0.5, baselineFromTop: 112)
  NSGraphicsContext.restoreGraphicsState()
  return rep
}

func writeBackground(into folder: URL) throws {
  guard
    let tiff = NSBitmapImageRep.tiffRepresentationOfImageReps(
      in: [backgroundRep(scale: 1), backgroundRep(scale: 2)], using: .lzw, factor: 0)
  else { throw LayoutError(description: "Could not encode the background image.") }
  try tiff.write(to: folder.appending(path: backgroundFileName))
}

func macTime(_ date: Date) -> Double {
  date.timeIntervalSince1970 + 2_082_844_800
}

func unicodeName(_ value: String) -> Data {
  var bytes = Bytes()
  let units = Array(value.utf16)
  bytes.u16(UInt16(units.count))
  units.forEach { bytes.u16($0) }
  return bytes.data
}

// A version 2 alias record, as mac_alias builds it. Finder resolves the
// background through this, so it has to describe the mounted volume itself.
func aliasRecord(volume: URL, file: URL) throws -> Data {
  let manager = FileManager.default
  let volumeAttributes = try manager.attributesOfItem(atPath: volume.path)
  let fileAttributes = try manager.attributesOfItem(atPath: file.path)
  guard
    let volumeName = try volume.resourceValues(forKeys: [.volumeNameKey]).volumeName,
    let volumeCreated = volumeAttributes[.creationDate] as? Date,
    let volumeID = volumeAttributes[.systemFileNumber] as? NSNumber,
    let fileCreated = fileAttributes[.creationDate] as? Date,
    let fileID = fileAttributes[.systemFileNumber] as? NSNumber
  else { throw LayoutError(description: "Could not read \(file.path) for its alias.") }
  let fileName = file.lastPathComponent
  let carbonVolumeName = volumeName.replacingOccurrences(of: ":", with: "/")
  let carbonFileName = fileName.replacingOccurrences(of: ":", with: "/")

  var alias = Bytes()
  alias.zeros(4)
  alias.u16(0)
  alias.u16(2)
  alias.u16(0)
  alias.pascal(carbonVolumeName, size: 28)
  alias.u32(UInt32(macTime(volumeCreated)))
  alias.ascii("H+")
  alias.u16(0)
  alias.u32(volumeID.uint32Value)
  alias.pascal(carbonFileName, size: 64)
  alias.u32(fileID.uint32Value)
  alias.u32(UInt32(macTime(fileCreated)))
  alias.zeros(8)
  alias.u16(0xFFFF)
  alias.u16(0xFFFF)
  alias.zeros(16)
  alias.tag(0, Data(carbonVolumeName.utf8))
  alias.tag(16, bigEndian(UInt64(macTime(volumeCreated) * 65536)))
  alias.tag(17, bigEndian(UInt64(macTime(fileCreated) * 65536)))
  alias.tag(2, Data("\(carbonVolumeName):\(carbonFileName)".utf8))
  alias.tag(14, unicodeName(fileName))
  alias.tag(15, unicodeName(volumeName))
  alias.tag(18, Data("/\(fileName)".utf8))
  alias.tag(19, Data("/Volumes/\(volumeName)".utf8))
  alias.u16(0xFFFF)
  alias.u16(0)
  alias.data.replaceSubrange(4..<6, with: bigEndian(UInt16(alias.data.count)))
  return alias.data
}

enum RecordValue {
  case blob(Data)
  case type(String)
  case long(UInt32)
}

// A Bud1 store holding one B-tree leaf, laid out at the offsets dmgbuild uses.
// Blocks come from a buddy allocator over 2^31 bytes; the first 32 bytes are
// the file header, so every other power-of-two block not in use is free.
func dsStore(records: [(name: String, code: String, value: RecordValue)]) -> Data {
  var node = Bytes()
  node.u32(0)
  node.u32(UInt32(records.count))
  for record in records {
    let units = Array(record.name.utf16)
    node.u32(UInt32(units.count))
    units.forEach { node.u16($0) }
    node.ascii(record.code)
    switch record.value {
    case .blob(let data):
      node.ascii("blob")
      node.u32(UInt32(data.count))
      node.data.append(data)
    case .type(let code):
      node.ascii("type")
      node.ascii(code)
    case .long(let value):
      node.ascii("long")
      node.u32(value)
    }
  }
  precondition(node.data.count <= 0x1000, "Finder view records overflow the single B-tree page.")

  var database = Bytes()
  database.u32(2)
  database.u32(0)
  database.u32(UInt32(records.count))
  database.u32(1)
  database.u32(0x1000)

  let blocks = [(offset: 0x800, log2Size: 11), (offset: 0x20, log2Size: 5), (offset: 0x2000, log2Size: 13)]
  var allocator = Bytes()
  allocator.u32(UInt32(blocks.count))
  allocator.u32(0)
  for index in 0..<256 {
    allocator.u32(index < blocks.count ? UInt32(blocks[index].offset | blocks[index].log2Size) : 0)
  }
  allocator.u32(1)
  allocator.u8(4)
  allocator.ascii("DSDB")
  allocator.u32(1)
  for log2Size in 0..<32 {
    let used = log2Size < 5 || blocks.contains { $0.offset >> log2Size == 1 }
    allocator.u32(used ? 0 : 1)
    if !used { allocator.u32(UInt32(1) << log2Size) }
  }

  var header = Bytes()
  header.u32(1)
  header.ascii("Bud1")
  header.u32(0x800)
  header.u32(0x800)
  header.u32(0x800)
  [0x100C, 0x87, 0x200B, 0].forEach { header.u32($0) }

  var store = Data(count: 4 + 0x4000)
  for (offset, data) in [(0, header.data), (4 + 0x20, database.data), (4 + 0x800, allocator.data), (4 + 0x2000, node.data)] {
    store.replaceSubrange(offset..<offset + data.count, with: data)
  }
  return store
}

func plist(_ value: [String: Any]) throws -> Data {
  try PropertyListSerialization.data(fromPropertyList: value, format: .binary, options: 0)
}

func writeFinderView(volume: URL, appName: String) throws {
  let windowBounds = "{{100, 100}, {\(Int(backgroundSize.width)), \(Int(backgroundSize.height))}}"
  let browserWindow = try plist([
    "ContainerShowSidebar": false,
    "PreviewPaneVisibility": false,
    "ShowPathbar": false,
    "ShowSidebar": false,
    "ShowStatusBar": false,
    "ShowTabView": false,
    "ShowToolbar": false,
    "SidebarWidth": 180,
    "WindowBounds": windowBounds,
  ])
  let iconView = try plist([
    "arrangeBy": "none",
    "backgroundColorBlue": 1.0,
    "backgroundColorGreen": 1.0,
    "backgroundColorRed": 1.0,
    "backgroundImageAlias": try aliasRecord(volume: volume, file: volume.appending(path: backgroundFileName)),
    "backgroundType": 2,
    "gridOffsetX": 0.0,
    "gridOffsetY": 0.0,
    "gridSpacing": 100.0,
    "iconSize": iconSize,
    "labelOnBottom": true,
    "scrollPositionX": 0.0,
    "scrollPositionY": 0.0,
    "showIconPreview": false,
    "showItemInfo": false,
    "textSize": 12.0,
    "viewOptionsVersion": 1,
  ])
  var iconLocation = Bytes()
  iconLocation.u32(UInt32(iconCenter.x))
  iconLocation.u32(UInt32(iconCenter.y))
  [0xFFFF, 0xFFFF, 0xFFFF, 0].forEach { iconLocation.u16($0) }

  // Finder expects records sorted by name, then by code.
  let store = dsStore(records: [
    (".", "bwsp", .blob(browserWindow)),
    (".", "icvl", .type("icnv")),
    (".", "icvp", .blob(iconView)),
    (".", "vSrn", .long(1)),
    (appName, "Iloc", .blob(iconLocation.data)),
  ])
  try store.write(to: volume.appending(path: ".DS_Store"))

  var finderInfo = [UInt8](repeating: 0, count: 32)
  finderInfo[8] = 0x04
  guard setxattr(volume.path, "com.apple.FinderInfo", finderInfo, finderInfo.count, 0, 0) == 0 else {
    throw LayoutError(description: "Could not mark \(volume.path) as having a custom icon.")
  }
}

do {
  let arguments = CommandLine.arguments.dropFirst()
  switch (arguments.first, arguments.count) {
  case ("background", 2):
    try writeBackground(into: URL(filePath: arguments.last!))
  case ("finder-view", 3):
    try writeFinderView(volume: URL(filePath: arguments[2]), appName: arguments[3])
  default:
    throw LayoutError(description: "usage: DiskImageLayout background <folder> | finder-view <volume> <app name>")
  }
} catch {
  FileHandle.standardError.write(Data("\(error)\n".utf8))
  exit(1)
}
