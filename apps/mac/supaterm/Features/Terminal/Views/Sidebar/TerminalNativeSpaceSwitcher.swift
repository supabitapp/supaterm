import AppKit
import SupaTheme
import SupatermSupport
import SwiftUI

extension NSPasteboard.PasteboardType {
  static let terminalSpaceDrag = NSPasteboard.PasteboardType("app.supaterm.space-drag.v1")
}

nonisolated struct TerminalSpaceDragPayload: Codable, Equatable, Sendable {
  let spaceID: TerminalSpaceID
  let orderedSpaceIDs: [TerminalSpaceID]
}

struct TerminalNativeSpaceSwitcherConfiguration {
  let palette: Palette
  let spaces: [TerminalSpaceItem]
  let selectedSpaceID: TerminalSpaceID
  let shortcutOverrides: [SupatermShortcutID: SupatermShortcutOverride]
  let select: (TerminalSpaceID) -> Void
  let create: () -> Void
  let edit: (TerminalSpaceItem) -> Void
  let delete: (TerminalSpaceItem) -> Void
  let reorder: (TerminalSpaceID, Int) -> Void
  let dropTab: (TerminalTabDragPayload, TerminalSpaceID) -> Bool
}

struct TerminalNativeSpaceSwitcher: NSViewRepresentable {
  let configuration: TerminalNativeSpaceSwitcherConfiguration

  func makeNSView(context: Context) -> TerminalNativeSpaceSwitcherView {
    TerminalNativeSpaceSwitcherView()
  }

  func updateNSView(_ view: TerminalNativeSpaceSwitcherView, context: Context) {
    view.apply(configuration)
  }
}

@MainActor
final class TerminalNativeSpaceSwitcherView: NSView {
  private var buttons: [TerminalNativeSpaceButton] = []
  private var canDelete = false
  private var create: () -> Void = {}
  private var delete: (TerminalSpaceItem) -> Void = { _ in }
  private var dropTab: (TerminalTabDragPayload, TerminalSpaceID) -> Bool = { _, _ in false }
  private var edit: (TerminalSpaceItem) -> Void = { _ in }
  private var hoverWorkItem: DispatchWorkItem?
  private let insertionView = NSView()
  private let newSpaceButton = NSButton()
  private var reorder: (TerminalSpaceID, Int) -> Void = { _, _ in }
  private var select: (TerminalSpaceID) -> Void = { _ in }
  private var selectedSpaceID: TerminalSpaceID?
  private var shortcutOverrides: [SupatermShortcutID: SupatermShortcutOverride] = [:]
  private var spaces: [TerminalSpaceItem] = []
  private var tabDropSpaceID: TerminalSpaceID?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    setAccessibilityElement(true)
    setAccessibilityRole(.group)
    setAccessibilityIdentifier("titlebar.space-switcher")
    registerForDraggedTypes([.terminalSpaceDrag, .terminalTabDrag])
    insertionView.wantsLayer = true
    insertionView.layer?.backgroundColor = NSColor.controlAccentColor.cgColor
    insertionView.layer?.cornerRadius = 1
    insertionView.isHidden = true
    addSubview(insertionView)
    newSpaceButton.bezelStyle = .inline
    newSpaceButton.isBordered = false
    newSpaceButton.image = NSImage(systemSymbolName: "plus", accessibilityDescription: "New Space")
    newSpaceButton.imageScaling = .scaleProportionallyDown
    newSpaceButton.contentTintColor = .secondaryLabelColor
    newSpaceButton.target = self
    newSpaceButton.action = #selector(createSpace)
    newSpaceButton.toolTip = "New Space"
    newSpaceButton.setAccessibilityIdentifier("titlebar.space-new")
    addSubview(newSpaceButton)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override var intrinsicContentSize: NSSize {
    let selectedWidth = selectedButtonWidth()
    let otherWidth = CGFloat(max(0, spaces.count - 1)) * 20
    return NSSize(width: min(184, selectedWidth + otherWidth + 28), height: 28)
  }

  override func layout() {
    super.layout()
    let buttonHeight = min(28, bounds.height)
    let buttonY = bounds.maxY - buttonHeight
    let newButtonWidth: CGFloat = 24
    newSpaceButton.frame = CGRect(
      x: bounds.maxX - newButtonWidth,
      y: buttonY,
      width: newButtonWidth,
      height: buttonHeight
    )
    let availableWidth = max(0, bounds.width - newButtonWidth - 4)
    let selectedWidth = min(selectedButtonWidth(), availableWidth)
    let otherCount = max(0, buttons.count - 1)
    let otherWidth = otherCount == 0 ? 0 : min(20, max(9, (availableWidth - selectedWidth) / CGFloat(otherCount)))
    var x = bounds.minX
    for button in buttons {
      let width = button.space.id == selectedSpaceID ? selectedWidth : otherWidth
      button.frame = CGRect(x: x, y: buttonY, width: width, height: buttonHeight)
      x += width
    }
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard bounds.contains(point) else { return nil }
    if let button = buttons.first(where: { $0.frame.insetBy(dx: 0, dy: 4).contains(point) }) {
      return button
    }
    if newSpaceButton.frame.insetBy(dx: 0, dy: 4).contains(point) {
      return newSpaceButton
    }
    return nil
  }

  func apply(_ configuration: TerminalNativeSpaceSwitcherConfiguration) {
    spaces = configuration.spaces
    selectedSpaceID = configuration.selectedSpaceID
    if let selectedSpace = configuration.spaces.first(where: { $0.id == configuration.selectedSpaceID }) {
      setAccessibilityLabel("Space \(selectedSpace.name)")
    }
    canDelete = configuration.spaces.count > 1
    shortcutOverrides = configuration.shortcutOverrides
    select = configuration.select
    create = configuration.create
    edit = configuration.edit
    delete = configuration.delete
    reorder = configuration.reorder
    dropTab = configuration.dropTab
    let orderedSpaceIDs = configuration.spaces.map(\.id)
    let spaceIDs = Set(orderedSpaceIDs)
    let existingButtons = Dictionary(uniqueKeysWithValues: buttons.map { ($0.space.id, $0) })
    for button in buttons where !spaceIDs.contains(button.space.id) {
      button.removeFromSuperview()
    }
    buttons = configuration.spaces.map { space in
      let button = existingButtons[space.id] ?? TerminalNativeSpaceButton(space: space)
      button.apply(
        space: space,
        orderedSpaceIDs: orderedSpaceIDs,
        isSelected: space.id == configuration.selectedSpaceID,
        dotColor: space.color.sidebarNSColor(palette: configuration.palette),
        textColor: NSColor(configuration.palette.spaceTitle)
      )
      button.select = { [weak self, weak button] in
        guard let self else { return }
        if space.id == configuration.selectedSpaceID, let button {
          showSpaceListMenu(relativeTo: button)
        } else {
          select(space.id)
        }
      }
      button.edit = { [weak self] in self?.edit(space) }
      button.menuProvider = { [weak self] in self?.menu(for: space) }
      button.isDropTarget = tabDropSpaceID == space.id
      if button.superview == nil {
        addSubview(button, positioned: .below, relativeTo: insertionView)
      }
      return button
    }
    invalidateIntrinsicContentSize()
    needsLayout = true
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    draggingUpdated(sender)
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    let pasteboard = sender.draggingPasteboard
    let location = convert(sender.draggingLocation, from: nil)
    if let payload = readSpacePayload(from: pasteboard), payload.orderedSpaceIDs == spaces.map(\.id) {
      clearTabDrop()
      showInsertion(at: insertionIndex(for: location.x))
      return .move
    }
    insertionView.isHidden = true
    guard
      let payload = TerminalTabDragPasteboard.read(from: pasteboard),
      let button = buttons.first(where: { $0.frame.contains(location) }),
      button.space.id != payload.sourceSpaceID
    else {
      clearTabDrop()
      return []
    }
    setTabDrop(button.space.id)
    return .move
  }

  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    clearDragPresentation()
  }

  override func draggingEnded(_ sender: any NSDraggingInfo) {
    clearDragPresentation()
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    sender.animatesToDestination = false
    return draggingUpdated(sender) == .move
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    let pasteboard = sender.draggingPasteboard
    let location = convert(sender.draggingLocation, from: nil)
    defer { clearDragPresentation() }
    if let payload = readSpacePayload(from: pasteboard), payload.orderedSpaceIDs == spaces.map(\.id) {
      reorder(payload.spaceID, insertionIndex(for: location.x))
      return true
    }
    guard
      let payload = TerminalTabDragPasteboard.read(from: pasteboard),
      let button = buttons.first(where: { $0.frame.contains(location) }),
      button.space.id != payload.sourceSpaceID
    else { return false }
    return dropTab(payload, button.space.id)
  }

  private func selectedButtonWidth() -> CGFloat {
    guard let selected = spaces.first(where: { $0.id == selectedSpaceID }) else { return 44 }
    let width = (selected.name as NSString).size(
      withAttributes: [.font: NSFont.systemFont(ofSize: 12, weight: .medium)]
    ).width
    return min(110, max(44, ceil(width) + 26))
  }

  private func insertionIndex(for x: CGFloat) -> Int {
    buttons.firstIndex(where: { x < $0.frame.midX }) ?? buttons.count
  }

  private func showInsertion(at index: Int) {
    let x =
      if index == buttons.count {
        buttons.last?.frame.maxX ?? bounds.minX
      } else {
        buttons[index].frame.minX
      }
    insertionView.frame = CGRect(
      x: x - 1,
      y: bounds.maxY - 25,
      width: 2,
      height: min(22, max(0, bounds.height - 6))
    )
    insertionView.isHidden = false
  }

  private func setTabDrop(_ spaceID: TerminalSpaceID) {
    guard tabDropSpaceID != spaceID else { return }
    clearTabDrop()
    tabDropSpaceID = spaceID
    buttons.first(where: { $0.space.id == spaceID })?.isDropTarget = true
    let workItem = DispatchWorkItem { [weak self] in
      guard self?.tabDropSpaceID == spaceID else { return }
      self?.select(spaceID)
    }
    hoverWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: workItem)
  }

  private func clearTabDrop() {
    hoverWorkItem?.cancel()
    hoverWorkItem = nil
    tabDropSpaceID = nil
    buttons.forEach { $0.isDropTarget = false }
  }

  private func clearDragPresentation() {
    insertionView.isHidden = true
    clearTabDrop()
  }

  private func readSpacePayload(from pasteboard: NSPasteboard) -> TerminalSpaceDragPayload? {
    guard
      let data = pasteboard.data(forType: .terminalSpaceDrag),
      let payload = try? JSONDecoder().decode(TerminalSpaceDragPayload.self, from: data)
    else { return nil }
    return payload
  }

  private func menu(for space: TerminalSpaceItem) -> NSMenu {
    let menu = NSMenu()
    let createItem = NSMenuItem(title: "New Space", action: #selector(createSpace), keyEquivalent: "")
    createItem.target = self
    menu.addItem(createItem)
    menu.addItem(.separator())
    let editItem = NSMenuItem(title: "Edit Space", action: #selector(editSpace(_:)), keyEquivalent: "")
    editItem.target = self
    editItem.representedObject = space.id.rawValue as NSUUID
    menu.addItem(editItem)
    let deleteItem = NSMenuItem(
      title: "Delete Space",
      action: #selector(deleteSpace(_:)),
      keyEquivalent: ""
    )
    deleteItem.target = self
    deleteItem.representedObject = space.id.rawValue as NSUUID
    deleteItem.isEnabled = canDelete
    menu.addItem(deleteItem)
    return menu
  }

  private func showSpaceListMenu(relativeTo button: NSView) {
    let menu = NSMenu()
    for (index, space) in spaces.enumerated() {
      let item = NSMenuItem(
        title: space.name,
        action: #selector(selectSpaceFromMenu(_:)),
        keyEquivalent: ""
      )
      item.target = self
      item.representedObject = space.id.rawValue as NSUUID
      item.state = space.id == selectedSpaceID ? .on : .off
      SupatermMenuShortcut.apply(
        TerminalSpaceShortcut.shortcutBinding(
          forSpaceAt: index,
          overrides: shortcutOverrides
        )?.keyboardShortcut,
        to: item
      )
      menu.addItem(item)
    }
    menu.addItem(.separator())
    let createItem = NSMenuItem(title: "New Space", action: #selector(createSpace), keyEquivalent: "")
    createItem.target = self
    menu.addItem(createItem)
    menu.popUp(positioning: nil, at: CGPoint(x: 0, y: button.bounds.minY - 3), in: button)
  }

  @objc private func createSpace() {
    create()
  }

  @objc private func editSpace(_ item: NSMenuItem) {
    guard let space = space(from: item) else { return }
    edit(space)
  }

  @objc private func deleteSpace(_ item: NSMenuItem) {
    guard let space = space(from: item) else { return }
    delete(space)
  }

  @objc private func selectSpaceFromMenu(_ item: NSMenuItem) {
    guard let space = space(from: item) else { return }
    select(space.id)
  }

  private func space(from item: NSMenuItem) -> TerminalSpaceItem? {
    guard let id = item.representedObject as? NSUUID else { return nil }
    return spaces.first { $0.id.rawValue == id as UUID }
  }
}

@MainActor
private final class TerminalNativeSpaceButton: NSView, NSDraggingSource {
  private(set) var space: TerminalSpaceItem
  var edit: () -> Void = {}
  var menuProvider: () -> NSMenu? = { nil }
  var select: () -> Void = {}
  var isDropTarget = false { didSet { needsDisplay = true } }

  private var dotColor = NSColor.clear
  private var isHovered = false { didSet { needsDisplay = true } }
  private var isSelected = false
  private var mouseDownLocation: CGPoint?
  private var orderedSpaceIDs: [TerminalSpaceID] = []
  private var textColor = NSColor.labelColor
  private var trackingArea: NSTrackingArea?

  init(space: TerminalSpaceItem) {
    self.space = space
    super.init(frame: .zero)
    setAccessibilityRole(.button)
    setAccessibilityIdentifier("titlebar.space.\(space.id.rawValue.uuidString)")
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  func apply(
    space: TerminalSpaceItem,
    orderedSpaceIDs: [TerminalSpaceID],
    isSelected: Bool,
    dotColor: NSColor,
    textColor: NSColor
  ) {
    self.space = space
    self.orderedSpaceIDs = orderedSpaceIDs
    self.isSelected = isSelected
    self.dotColor = dotColor
    self.textColor = textColor
    toolTip = space.name
    setAccessibilityLabel("Space \(space.name)")
    needsDisplay = true
  }

  override func updateTrackingAreas() {
    if let trackingArea {
      removeTrackingArea(trackingArea)
    }
    let trackingArea = NSTrackingArea(
      rect: bounds,
      options: [.activeAlways, .mouseEnteredAndExited],
      owner: self,
      userInfo: nil
    )
    addTrackingArea(trackingArea)
    self.trackingArea = trackingArea
    super.updateTrackingAreas()
  }

  override func mouseEntered(with event: NSEvent) {
    isHovered = true
  }

  override func mouseExited(with event: NSEvent) {
    isHovered = false
  }

  override func mouseDown(with event: NSEvent) {
    mouseDownLocation = convert(event.locationInWindow, from: nil)
  }

  override func mouseDragged(with event: NSEvent) {
    guard let mouseDownLocation else { return }
    let location = convert(event.locationInWindow, from: nil)
    guard hypot(location.x - mouseDownLocation.x, location.y - mouseDownLocation.y) >= 4 else {
      return
    }
    self.mouseDownLocation = nil
    let payload = TerminalSpaceDragPayload(spaceID: space.id, orderedSpaceIDs: orderedSpaceIDs)
    guard let data = try? JSONEncoder().encode(payload) else { return }
    let pasteboardItem = NSPasteboardItem()
    pasteboardItem.setData(data, forType: .terminalSpaceDrag)
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    let image = snapshot()
    draggingItem.setDraggingFrame(bounds, contents: image)
    beginDraggingSession(with: [draggingItem], event: event, source: self)
  }

  override func mouseUp(with event: NSEvent) {
    guard mouseDownLocation != nil else { return }
    mouseDownLocation = nil
    if event.clickCount == 2 {
      edit()
    } else {
      select()
    }
  }

  override func rightMouseDown(with event: NSEvent) {
    guard let menu = menuProvider() else { return }
    NSMenu.popUpContextMenu(menu, with: event, for: self)
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    let backgroundRect = bounds.insetBy(dx: 1, dy: 1)
    if isSelected || isHovered || isDropTarget {
      let alpha: CGFloat = isDropTarget ? 0.18 : isHovered ? 0.1 : 0.07
      textColor.withAlphaComponent(alpha).setFill()
      NSBezierPath(roundedRect: backgroundRect, xRadius: 7, yRadius: 7).fill()
    }
    let dotSize: CGFloat = isSelected ? 8 : 7
    let dotX = isSelected ? 8 : floor((bounds.width - dotSize) / 2)
    dotColor.setFill()
    NSBezierPath(
      ovalIn: CGRect(x: dotX, y: floor((bounds.height - dotSize) / 2), width: dotSize, height: dotSize)
    ).fill()
    guard isSelected, bounds.width > 32 else { return }
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byTruncatingTail
    (space.name as NSString).draw(
      in: CGRect(x: 21, y: 6, width: max(0, bounds.width - 27), height: 16),
      withAttributes: [
        .font: NSFont.systemFont(ofSize: 12, weight: .medium),
        .foregroundColor: textColor,
        .paragraphStyle: paragraph,
      ]
    )
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    .move
  }

  private func snapshot() -> NSImage {
    let image = NSImage(size: bounds.size)
    image.lockFocus()
    draw(bounds)
    image.unlockFocus()
    return image
  }
}
