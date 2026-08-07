import AppKit
import SupaTheme
import SwiftUI

extension NSPasteboard.PasteboardType {
  static let terminalSpaceDrag = NSPasteboard.PasteboardType("app.supaterm.space-drag.v1")
}

nonisolated struct TerminalSpaceDragPayload: Codable, Equatable, Sendable {
  let spaceID: TerminalSpaceID
  let orderedSpaceIDs: [TerminalSpaceID]
}

struct TerminalNativeSpaceDotsConfiguration {
  let palette: Palette
  let spaces: [TerminalSpaceItem]
  let selectionPosition: Double
  let select: (TerminalSpaceID) -> Void
  let edit: (TerminalSpaceItem) -> Void
  let delete: (TerminalSpaceItem) -> Void
  let newTab: (TerminalSpaceID) -> Void
  let reorder: (TerminalSpaceID, Int) -> Void
  let dropTab: (TerminalTabDragPayload, TerminalSpaceID) -> Bool
}

struct TerminalNativeSpaceDots: NSViewRepresentable {
  let configuration: TerminalNativeSpaceDotsConfiguration

  func makeNSView(context: Context) -> TerminalNativeSpaceDotsView {
    TerminalNativeSpaceDotsView()
  }

  func updateNSView(_ view: TerminalNativeSpaceDotsView, context: Context) {
    view.apply(configuration)
  }
}

@MainActor
final class TerminalNativeSpaceDotsView: NSView {
  private var buttons: [TerminalNativeSpaceDotView] = []
  private var canDelete = false
  private var delete: (TerminalSpaceItem) -> Void = { _ in }
  private var dropTab: (TerminalTabDragPayload, TerminalSpaceID) -> Bool = { _, _ in false }
  private var edit: (TerminalSpaceItem) -> Void = { _ in }
  private var hoverWorkItem: DispatchWorkItem?
  private let insertionView = NSView()
  private var newTab: (TerminalSpaceID) -> Void = { _ in }
  private var reorder: (TerminalSpaceID, Int) -> Void = { _, _ in }
  private var select: (TerminalSpaceID) -> Void = { _ in }
  private var spaces: [TerminalSpaceItem] = []
  private var tabDropSpaceID: TerminalSpaceID?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    setAccessibilityElement(false)
    registerForDraggedTypes([.terminalSpaceDrag, .terminalTabDrag])
    insertionView.wantsLayer = true
    insertionView.layer?.backgroundColor = NSColor.controlAccentColor.cgColor
    insertionView.layer?.cornerRadius = 1
    insertionView.isHidden = true
    addSubview(insertionView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override var intrinsicContentSize: NSSize {
    NSSize(
      width: CGFloat(spaces.count) * SpacePageDotMetrics.slot,
      height: SpacePageDotMetrics.slot
    )
  }

  override func layout() {
    super.layout()
    let y = floor((bounds.height - SpacePageDotMetrics.slot) / 2)
    for (index, button) in buttons.enumerated() {
      button.frame = CGRect(
        x: CGFloat(index) * SpacePageDotMetrics.slot,
        y: y,
        width: SpacePageDotMetrics.slot,
        height: SpacePageDotMetrics.slot
      )
    }
  }

  func apply(_ configuration: TerminalNativeSpaceDotsConfiguration) {
    spaces = configuration.spaces
    canDelete = spaces.count > 1
    select = configuration.select
    edit = configuration.edit
    delete = configuration.delete
    newTab = configuration.newTab
    reorder = configuration.reorder
    dropTab = configuration.dropTab
    let orderedSpaceIDs = spaces.map(\.id)
    let spaceIDs = Set(orderedSpaceIDs)
    let existingButtons = Dictionary(uniqueKeysWithValues: buttons.map { ($0.space.id, $0) })
    for button in buttons where !spaceIDs.contains(button.space.id) {
      button.removeFromSuperview()
    }
    buttons = spaces.enumerated().map { index, space in
      let button = existingButtons[space.id] ?? TerminalNativeSpaceDotView(space: space)
      let emphasis = SpacePageDotMetrics.emphasis(
        at: index,
        position: configuration.selectionPosition
      )
      button.apply(
        space: space,
        orderedSpaceIDs: orderedSpaceIDs,
        color: NSColor(configuration.palette.primaryText),
        opacity: SpacePageDotMetrics.opacity(emphasis: emphasis)
      )
      button.select = { [weak self] in self?.select(space.id) }
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
      let button = button(at: location),
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
      let button = button(at: location),
      button.space.id != payload.sourceSpaceID
    else { return false }
    return dropTab(payload, button.space.id)
  }

  private func button(at point: CGPoint) -> TerminalNativeSpaceDotView? {
    buttons.first { $0.frame.contains(point) }
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
      y: floor((bounds.height - SpacePageDotMetrics.slot) / 2),
      width: 2,
      height: SpacePageDotMetrics.slot
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
    let editItem = NSMenuItem(title: "Edit Space", action: #selector(editSpace(_:)), keyEquivalent: "")
    editItem.target = self
    editItem.representedObject = space.id.rawValue as NSUUID
    menu.addItem(editItem)
    let newTabItem = NSMenuItem(
      title: "New Tab Here",
      action: #selector(createTab(_:)),
      keyEquivalent: ""
    )
    newTabItem.target = self
    newTabItem.representedObject = space.id.rawValue as NSUUID
    menu.addItem(newTabItem)
    menu.addItem(.separator())
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

  @objc private func editSpace(_ item: NSMenuItem) {
    guard let space = space(from: item) else { return }
    edit(space)
  }

  @objc private func createTab(_ item: NSMenuItem) {
    guard let space = space(from: item) else { return }
    newTab(space.id)
  }

  @objc private func deleteSpace(_ item: NSMenuItem) {
    guard let space = space(from: item) else { return }
    delete(space)
  }

  private func space(from item: NSMenuItem) -> TerminalSpaceItem? {
    guard let id = item.representedObject as? NSUUID else { return nil }
    return spaces.first { $0.id.rawValue == id as UUID }
  }
}

@MainActor
private final class TerminalNativeSpaceDotView: NSView, NSDraggingSource {
  private(set) var space: TerminalSpaceItem
  var menuProvider: () -> NSMenu? = { nil }
  var select: () -> Void = {}
  var isDropTarget = false { didSet { needsDisplay = true } }

  private var color = NSColor.labelColor
  private var isHovered = false { didSet { needsDisplay = true } }
  private var mouseDownLocation: CGPoint?
  private var opacity = SpacePageDotMetrics.restOpacity
  private var orderedSpaceIDs: [TerminalSpaceID] = []
  private var trackingArea: NSTrackingArea?

  init(space: TerminalSpaceItem) {
    self.space = space
    super.init(frame: .zero)
    setAccessibilityElement(true)
    setAccessibilityRole(.button)
    applyAccessibility()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  func apply(
    space: TerminalSpaceItem,
    orderedSpaceIDs: [TerminalSpaceID],
    color: NSColor,
    opacity: Double
  ) {
    self.space = space
    self.orderedSpaceIDs = orderedSpaceIDs
    self.color = color
    self.opacity = opacity
    toolTip = space.name
    applyAccessibility()
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
    draggingItem.setDraggingFrame(bounds, contents: snapshot())
    beginDraggingSession(with: [draggingItem], event: event, source: self)
  }

  override func mouseUp(with event: NSEvent) {
    guard mouseDownLocation != nil else { return }
    mouseDownLocation = nil
    select()
  }

  override func rightMouseDown(with event: NSEvent) {
    guard let menu = menuProvider() else { return }
    NSMenu.popUpContextMenu(menu, with: event, for: self)
  }

  override func draw(_ dirtyRect: NSRect) {
    super.draw(dirtyRect)
    let diameter: CGFloat = isDropTarget ? 8 : SpacePageDotMetrics.diameter
    let alpha = isDropTarget || isHovered ? 1 : opacity
    color.withAlphaComponent(alpha).setFill()
    NSBezierPath(
      ovalIn: CGRect(
        x: floor((bounds.width - diameter) / 2),
        y: floor((bounds.height - diameter) / 2),
        width: diameter,
        height: diameter
      )
    ).fill()
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    .move
  }

  private func applyAccessibility() {
    setAccessibilityIdentifier(TerminalSidebarAccessibilityIdentifier.spaceDot(space.id))
    setAccessibilityLabel("Space \(space.name)")
  }

  private func snapshot() -> NSImage {
    let image = NSImage(size: bounds.size)
    image.lockFocus()
    draw(bounds)
    image.unlockFocus()
    return image
  }
}
