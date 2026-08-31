import AppKit
import SupaTheme
import SwiftUI

final class TerminalHorizontalTabItemView: NSView {
  var onAccessibilityPress: (() -> Void)?
  var onClose: (() -> Void)?
  var onNewTab: (() -> Void)?
  var onContextMenu: ((NSEvent) -> Void)? {
    didSet { interaction.onContextMenu = onContextMenu }
  }
  var onDrag: ((NSEvent) -> Bool)? {
    didSet { interaction.onDrag = onDrag }
  }
  var onPress: ((NSEvent) -> Void)? {
    didSet { interaction.onPress = onPress }
  }
  var onRelease: ((NSEvent) -> Void)? {
    didSet { interaction.onRelease = onRelease }
  }

  private let agentStatusView = TerminalHorizontalTabAgentStatusView()
  private let bottomView = TerminalHorizontalTabBottomView()
  private let closeButton = NSButton()
  private let groupIconView = TerminalHorizontalTabGroupIconView()
  private let groupNewTabButton = TerminalHorizontalTabControlButton()
  private let groupUnreadView = NSView()
  private let interaction = TerminalHorizontalTabInteraction()
  private let statusView = TerminalHorizontalTabStatusView()
  private let subtitleLabel = NSTextField(labelWithString: "")
  private let titleLabel = NSTextField(labelWithString: "")
  private var isGroup = false
  private var isHovered = false
  private var selection = SelectableRowSelection.none
  private var groupTint: ThemeTint?
  private var palette: Palette?
  private var reduceMotion = false
  private var selectedTint: NSColor?
  private var trackingArea: NSTrackingArea?

  private var isSelected: Bool { selection != .none }
  private var selectedTopExtension: CGFloat {
    selection == .primary ? TerminalHorizontalTabLayoutMetrics.selectedTopExtension : 0
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.masksToBounds = false
    titleLabel.font = TerminalHorizontalTabTypography.titleFont
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.maximumNumberOfLines = 1
    titleLabel.setAccessibilityElement(false)
    subtitleLabel.font = TerminalHorizontalTabTypography.subtitleFont
    subtitleLabel.lineBreakMode = .byTruncatingTail
    subtitleLabel.maximumNumberOfLines = 1
    subtitleLabel.setAccessibilityElement(false)
    closeButton.bezelStyle = .inline
    closeButton.isBordered = false
    closeButton.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: nil)
    closeButton.imagePosition = .imageOnly
    closeButton.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 10, weight: .bold)
    closeButton.target = self
    closeButton.action = #selector(close)
    closeButton.setAccessibilityElement(true)
    closeButton.setAccessibilityLabel("Close Tab")
    groupNewTabButton.bezelStyle = .inline
    groupNewTabButton.isBordered = false
    groupNewTabButton.image = NSImage(systemSymbolName: "plus", accessibilityDescription: nil)
    groupNewTabButton.imagePosition = .imageOnly
    groupNewTabButton.symbolConfiguration = NSImage.SymbolConfiguration(
      pointSize: 11,
      weight: .semibold
    )
    groupNewTabButton.target = self
    groupNewTabButton.action = #selector(createTabInGroup)
    groupNewTabButton.toolTip = "New Tab in Group"
    groupNewTabButton.isHidden = true
    groupNewTabButton.setAccessibilityElement(true)
    groupNewTabButton.setAccessibilityLabel("New Tab in Group")
    groupUnreadView.wantsLayer = true
    groupUnreadView.layer?.cornerRadius = 3.5
    groupUnreadView.setAccessibilityElement(false)
    addSubview(bottomView)
    addSubview(groupIconView)
    addSubview(groupNewTabButton)
    addSubview(groupUnreadView)
    addSubview(agentStatusView)
    addSubview(titleLabel)
    addSubview(subtitleLabel)
    addSubview(statusView)
    addSubview(closeButton)
    interaction.onMiddleActivate = { [weak self] in
      _ = self?.accessibilityPerformPress()
    }
    interaction.onMiddleClose = { [weak self] in self?.onClose?() }
    setAccessibilityElement(true)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override var isFlipped: Bool { true }
  override var mouseDownCanMoveWindow: Bool { false }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let localPoint = localHitTestPoint(point)
    guard bounds.contains(localPoint) else { return nil }
    return pointerTarget(at: localPoint)
  }

  func pointerTarget(at point: NSPoint) -> NSView {
    if !closeButton.isHidden, closeButton.frame.contains(point) {
      return closeButton
    }
    if !groupNewTabButton.isHidden, groupNewTabButton.frame.contains(point) {
      return groupNewTabButton
    }
    return self
  }

  override func accessibilityPerformPress() -> Bool {
    guard let onAccessibilityPress else { return false }
    onAccessibilityPress()
    return true
  }

  override func updateTrackingAreas() {
    if let trackingArea { removeTrackingArea(trackingArea) }
    let trackingArea = NSTrackingArea(
      rect: .zero,
      options: [
        isGroup ? .activeInKeyWindow : .activeAlways,
        .inVisibleRect,
        .mouseEnteredAndExited,
      ],
      owner: self
    )
    addTrackingArea(trackingArea)
    self.trackingArea = trackingArea
    super.updateTrackingAreas()
  }

  override func mouseEntered(with event: NSEvent) {
    isHovered = true
    updateAppearance()
  }

  override func mouseExited(with event: NSEvent) {
    isHovered = false
    interaction.mouseExited()
    updateAppearance()
  }

  override func mouseDown(with event: NSEvent) {
    interaction.mouseDown(with: event)
  }

  override func mouseDragged(with event: NSEvent) {
    interaction.mouseDragged(with: event)
  }

  override func mouseUp(with event: NSEvent) {
    interaction.mouseUp(with: event)
  }

  override func rightMouseDown(with event: NSEvent) {
    interaction.rightMouseDown(with: event)
  }

  override func otherMouseUp(with event: NSEvent) {
    if !interaction.otherMouseUp(with: event) {
      super.otherMouseUp(with: event)
    }
  }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    if newWindow == nil {
      interaction.cancel()
    }
    super.viewWillMove(toWindow: newWindow)
  }

  override func layout() {
    super.layout()
    bottomView.frame = bounds
    closeButton.frame =
      isGroup
      ? CGRect(x: bounds.maxX, y: bounds.midY, width: 0, height: 0)
      : TerminalHorizontalTabLayoutMetrics.closeButtonFrame(in: bounds)
    groupNewTabButton.frame = CGRect(
      x: bounds.maxX - 27,
      y: bounds.midY - 10,
      width: 20,
      height: 20
    )
    statusView.frame = TerminalHorizontalTabLayoutMetrics.closeButtonFrame(in: bounds)
    if isGroup {
      layoutGroup()
    } else {
      layoutTab()
    }
  }

  func apply(
    _ presentation: TerminalHorizontalTabItemPresentation,
    palette: Palette,
    reduceMotion: Bool
  ) {
    let wasGroup = isGroup
    self.palette = palette
    self.reduceMotion = reduceMotion
    selection = presentation.selection
    selectedTint = presentation.selectedTint?.sidebarNSColor(palette: palette)
    switch presentation.content {
    case .group(
      let id,
      let title,
      let color,
      let iconURL,
      let isCollapsed,
      let hasUnread,
      _
    ):
      isGroup = true
      groupTint = color
      interaction.middleClickAction = .activate
      titleLabel.font = TerminalHorizontalTabTypography.groupTitleFont
      titleLabel.stringValue = title
      subtitleLabel.stringValue = ""
      subtitleLabel.isHidden = true
      agentStatusView.apply(nil, palette: palette, reduceMotion: reduceMotion)
      statusView.apply(
        nil,
        palette: palette,
        isSelected: false,
        reduceMotion: reduceMotion
      )
      let groupColor = color.sidebarNSColor(palette: palette)
      groupIconView.apply(iconURL: iconURL, color: groupColor)
      groupIconView.isHidden = false
      groupUnreadView.isHidden = !hasUnread
      groupUnreadView.layer?.backgroundColor = NSColor(palette.warning).cgColor
      setAccessibilityRole(.disclosureTriangle)
      setAccessibilityIdentifier(presentation.accessibilityIdentifier)
      setAccessibilityLabel(presentation.accessibilityLabel)
      setAccessibilityValue(isCollapsed ? "Collapsed" : "Expanded")
      setAccessibilitySelected(false)
      setAccessibilityHelp(isCollapsed ? "Expand Tab Group" : "Collapse Tab Group")
      closeButton.setAccessibilityIdentifier(nil)
      groupNewTabButton.setAccessibilityIdentifier(
        HorizontalTabAccessibilityID.groupNewTab(id)
      )
      setGroupAccessibilityActions()
    case .tab(
      let id,
      let title,
      let subtitle,
      _,
      let agentStatus,
      let trailingStatus
    ):
      isGroup = false
      groupTint = nil
      interaction.middleClickAction = .close
      titleLabel.font = TerminalHorizontalTabTypography.titleFont
      titleLabel.stringValue = title
      titleLabel.lineBreakMode = title.contains("/") ? .byTruncatingMiddle : .byTruncatingTail
      subtitleLabel.stringValue = subtitle ?? ""
      subtitleLabel.lineBreakMode =
        subtitle?.contains("/") == true ? .byTruncatingMiddle : .byTruncatingTail
      subtitleLabel.isHidden = subtitle == nil
      agentStatusView.apply(
        agentStatus,
        palette: palette,
        reduceMotion: reduceMotion
      )
      statusView.apply(
        trailingStatus,
        palette: palette,
        isSelected: isSelected,
        reduceMotion: reduceMotion
      )
      groupIconView.isHidden = true
      groupUnreadView.isHidden = true
      setAccessibilityRole(.radioButton)
      setAccessibilityIdentifier(presentation.accessibilityIdentifier)
      setAccessibilityLabel(presentation.accessibilityLabel)
      setAccessibilityValue(NSNumber(value: isSelected))
      setAccessibilitySelected(isSelected)
      setAccessibilityHelp("Select Tab")
      closeButton.setAccessibilityIdentifier(
        HorizontalTabAccessibilityID.tabClose(id)
      )
      groupNewTabButton.setAccessibilityIdentifier(nil)
      setCloseAccessibilityAction(named: "Close Tab")
    }
    if wasGroup != isGroup { updateTrackingAreas() }
    needsLayout = true
    updateAppearance()
  }

  func cancelPointerInteraction() {
    interaction.cancel()
    isHovered = false
    updateAppearance()
  }

  func animateSelectedEntrance() {
    bottomView.animateSelectedEntrance(reduceMotion: reduceMotion)
  }

  private func layoutGroup() {
    let iconFrame = CGRect(x: 7, y: bounds.midY - 8, width: 16, height: 16)
    groupIconView.frame = iconFrame
    groupUnreadView.frame = CGRect(
      x: iconFrame.maxX - 4,
      y: iconFrame.minY - 1,
      width: 7,
      height: 7
    )
    let titleHeight = ceil(titleLabel.fittingSize.height)
    titleLabel.frame = CGRect(
      x: TerminalHorizontalTabLayoutMetrics.groupLabelLeadingInset,
      y: bounds.midY - titleHeight / 2,
      width: max(
        0,
        bounds.width - TerminalHorizontalTabLayoutMetrics.groupTitleHorizontalInset
      ),
      height: titleHeight
    )
  }

  private func layoutTab() {
    let contentCenterY = (bounds.height - 5) / 2
    let hasAgent = !agentStatusView.isHidden
    agentStatusView.frame = CGRect(
      x: TerminalHorizontalTabLayoutMetrics.tabLabelLeadingInset,
      y: contentCenterY - 8,
      width: hasAgent ? 14 : 0,
      height: 16
    )
    let leading =
      TerminalHorizontalTabLayoutMetrics.tabLabelLeadingInset + (hasAgent ? 18 : 0)
    let trailing = statusView.frame.minX - TerminalHorizontalTabLayoutMetrics.tabLabelTrailingGap
    let width = max(0, trailing - leading)
    let titleHeight = ceil(titleLabel.fittingSize.height)
    if subtitleLabel.isHidden {
      titleLabel.frame = CGRect(
        x: leading,
        y: contentCenterY - titleHeight / 2,
        width: width,
        height: titleHeight
      )
      return
    }
    let subtitleHeight = ceil(subtitleLabel.fittingSize.height)
    let blockHeight = titleHeight + subtitleHeight
    let blockY = contentCenterY - blockHeight / 2 + 1
    titleLabel.frame = CGRect(x: leading, y: blockY, width: width, height: titleHeight)
    subtitleLabel.frame = CGRect(
      x: leading,
      y: blockY + titleHeight,
      width: width,
      height: subtitleHeight
    )
  }

  private func updateAppearance() {
    guard let palette else { return }
    titleLabel.textColor = titleColor(palette: palette)
    subtitleLabel.textColor = NSColor(
      isSelected ? palette.selectedSecondaryText : palette.secondaryText
    )
    closeButton.contentTintColor = NSColor(
      isSelected ? palette.selectedSecondaryText : palette.secondaryText
    )
    groupNewTabButton.apply(palette: palette)
    groupNewTabButton.isHidden = !isGroup || !isHovered || bounds.width < 62
    closeButton.isHidden = isGroup || !isHovered
    statusView.isHidden = isGroup || isHovered || statusView.presentationIsEmpty
    bottomView.apply(
      TerminalHorizontalTabBottomView.Style(
        palette: palette,
        tint: selectedTint,
        hoverFill: groupHoverFill(palette: palette),
        selection: selection,
        isHovered: isHovered,
        selectedTopExtension: selectedTopExtension,
        reduceMotion: reduceMotion
      )
    )
  }

  @objc private func close() {
    onClose?()
  }

  @objc private func createTabInGroup() {
    onNewTab?()
  }

  private func setGroupAccessibilityActions() {
    setAccessibilityCustomActions([
      NSAccessibilityCustomAction(name: "New Tab in Group") { [weak self] in
        guard let self, self.onNewTab != nil else { return false }
        self.onNewTab?()
        return true
      },
      NSAccessibilityCustomAction(name: "Close Group") { [weak self] in
        guard let self, self.onClose != nil else { return false }
        self.onClose?()
        return true
      },
    ])
  }

  private func setCloseAccessibilityAction(named name: String) {
    setAccessibilityCustomActions([
      NSAccessibilityCustomAction(name: name) { [weak self] in
        guard let self, self.onClose != nil else { return false }
        self.onClose?()
        return true
      }
    ])
  }

  private func titleColor(palette: Palette) -> NSColor {
    guard let groupTint else {
      return NSColor(isSelected ? palette.selectedText : palette.primaryText)
    }
    guard groupTint != .neutral else {
      return NSColor(isSelected ? palette.selectedText : palette.primaryText)
    }
    let color = groupTint.sidebarNSColor(palette: palette)
    return color.blended(
      withFraction: 0.2,
      of: palette.isDark ? .white : .black
    ) ?? color
  }

  private func groupHoverFill(palette: Palette) -> NSColor? {
    guard let groupTint else { return nil }
    if groupTint == .neutral {
      return NSColor(palette.sidebarGroupNeutralHoverFillValue.color)
    }
    return groupTint.sidebarNSColor(palette: palette).withAlphaComponent(0.065)
  }
}
