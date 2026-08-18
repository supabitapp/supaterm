import AppKit
import ComposableArchitecture
import Observation
import QuartzCore
import Sharing
import SupaTheme
import SupatermSupport
import SwiftUI

extension ThemeTint {
  var displayName: String {
    rawValue.capitalized
  }

  func sidebarColor(palette: Palette) -> Color {
    sidebarThemeColor(palette: palette).color
  }

  func sidebarNSColor(palette: Palette) -> NSColor {
    NSColor(themeColor: sidebarThemeColor(palette: palette))
  }

  private func sidebarThemeColor(palette: Palette) -> ThemeColor {
    tone(in: palette.referencePalette).color(for: palette.colorScheme)
  }
}

extension NSColor {
  fileprivate convenience init(themeColor: ThemeColor) {
    self.init(
      srgbRed: CGFloat(themeColor.red),
      green: CGFloat(themeColor.green),
      blue: CGFloat(themeColor.blue),
      alpha: CGFloat(themeColor.alpha)
    )
  }
}

struct TerminalSidebarGroupRowPresentation: Equatable {
  let id: TerminalTabGroupID
  let title: String
  let color: ThemeTint
  let iconURL: URL?
  let isPinned: Bool
  let isCollapsed: Bool
  let tabCount: Int
  let showsNewTabShortcutHint: Bool
}

enum TerminalSidebarGroupNewTabAccessory: Equatable {
  case hidden
  case icon
  case shortcut(String)

  static func resolve(
    isHovered: Bool,
    showsShortcutHint: Bool,
    shortcutHint: String?
  ) -> Self {
    guard isHovered else { return .hidden }
    guard showsShortcutHint, let shortcutHint else { return .icon }
    return .shortcut(shortcutHint)
  }

  var isVisible: Bool {
    self != .hidden
  }
}

enum TerminalSidebarGroupSurfaceState: Equatable {
  case resting
  case hovered
  case dropTarget

  static func resolve(isHovered: Bool, isDropTarget: Bool) -> Self {
    if isDropTarget { return .dropTarget }
    return isHovered ? .hovered : .resting
  }
}

enum TerminalSidebarGroupSurfaceFill: Equatable {
  case clear
  case neutral
  case group(opacity: CGFloat)
}

struct TerminalSidebarGroupSurfaceStyle: Equatable {
  let fill: TerminalSidebarGroupSurfaceFill
  let showsStroke: Bool

  static func resolve(
    color: ThemeTint,
    state: TerminalSidebarGroupSurfaceState
  ) -> Self {
    if color == .neutral {
      switch state {
      case .resting:
        return Self(fill: .clear, showsStroke: false)
      case .hovered, .dropTarget:
        return Self(fill: .neutral, showsStroke: true)
      }
    }

    switch state {
    case .resting:
      return Self(fill: .group(opacity: 0.15), showsStroke: true)
    case .hovered, .dropTarget:
      return Self(fill: .group(opacity: 0.25), showsStroke: true)
    }
  }
}

@MainActor
@Observable
final class TerminalSidebarGroupHoverState {
  private(set) var groupID: TerminalTabGroupID?

  func set(_ groupID: TerminalTabGroupID?) {
    guard self.groupID != groupID else { return }
    self.groupID = groupID
  }

  func retain(_ groupIDs: Set<TerminalTabGroupID>) {
    guard let groupID, !groupIDs.contains(groupID) else { return }
    self.groupID = nil
  }
}

@MainActor
@Observable
final class TerminalSidebarTabSelectionState {
  private(set) var secondaryTabIDs: Set<TerminalTabID> = []

  func style(
    for tabID: TerminalTabID,
    primaryTabID: TerminalTabID?
  ) -> SelectableRowSelection {
    if tabID == primaryTabID { return .primary }
    return secondaryTabIDs.contains(tabID) ? .secondary : .none
  }

  func orderedTabIDs(
    primaryTabID: TerminalTabID?,
    outline: TerminalSidebarOutline
  ) -> [TerminalTabID] {
    let selected = secondaryTabIDs.union(primaryTabID.map { Set([$0]) } ?? [])
    return Self.visibleTabIDs(in: outline).filter(selected.contains)
  }

  func contextualTabIDs(
    for tabID: TerminalTabID,
    primaryTabID: TerminalTabID?,
    outline: TerminalSidebarOutline
  ) -> [TerminalTabID] {
    guard style(for: tabID, primaryTabID: primaryTabID) != .none else { return [tabID] }
    return orderedTabIDs(primaryTabID: primaryTabID, outline: outline)
  }

  func toggle(_ tabID: TerminalTabID, primaryTabID: TerminalTabID?) {
    guard tabID != primaryTabID else { return }
    if !secondaryTabIDs.insert(tabID).inserted {
      secondaryTabIDs.remove(tabID)
    }
  }

  func selectRange(
    to tabID: TerminalTabID,
    primaryTabID: TerminalTabID?,
    outline: TerminalSidebarOutline,
    additive: Bool
  ) {
    guard let primaryTabID else { return }
    let visible = Self.visibleTabIDs(in: outline)
    guard
      let primaryIndex = visible.firstIndex(of: primaryTabID),
      let targetIndex = visible.firstIndex(of: tabID)
    else { return }
    let bounds = min(primaryIndex, targetIndex)...max(primaryIndex, targetIndex)
    let range = Set(visible[bounds]).subtracting([primaryTabID])
    if additive {
      secondaryTabIDs.formUnion(range)
    } else {
      secondaryTabIDs = range
    }
  }

  func clear() {
    guard !secondaryTabIDs.isEmpty else { return }
    secondaryTabIDs = []
  }

  func retainVisible(in outline: TerminalSidebarOutline, primaryTabID: TerminalTabID?) {
    let visible = Set(Self.visibleTabIDs(in: outline))
    var retained = secondaryTabIDs.intersection(visible)
    if let primaryTabID { retained.remove(primaryTabID) }
    guard retained != secondaryTabIDs else { return }
    secondaryTabIDs = retained
  }

  private static func visibleTabIDs(in outline: TerminalSidebarOutline) -> [TerminalTabID] {
    outline.visibleEntries.compactMap { entry in
      guard case .tab(let tabID, _, _) = entry.kind else { return nil }
      return tabID
    }
  }
}

enum TerminalSidebarTabDetail: Equatable, Identifiable {
  enum ID: Hashable {
    case agentWorkspace(TerminalTabAgentWorkspace.ID)
    case workingDirectory(String)
  }

  case agentWorkspace(TerminalTabAgentWorkspace)
  case workingDirectory(String)

  var id: ID {
    switch self {
    case .agentWorkspace(let workspace):
      .agentWorkspace(workspace.id)
    case .workingDirectory(let path):
      .workingDirectory(path)
    }
  }

  static func resolve(
    agentWorkspaces: [TerminalTabAgentWorkspace],
    paneWorkingDirectories: [String]
  ) -> [Self] {
    guard agentWorkspaces.isEmpty else {
      return agentWorkspaces.map(Self.agentWorkspace)
    }
    return paneWorkingDirectories.map(Self.workingDirectory)
  }
}

private struct TerminalSidebarTabMeasurementKey: Hashable {
  let tabID: TerminalTabID
  let title: String
  let detailIDs: [TerminalSidebarTabDetail.ID]
}

struct TerminalSidebarTabRowPresentation: Equatable {
  let tab: TerminalTabItem
  let groupID: TerminalTabGroupID?
  let rootIsPinned: Bool
  let details: [TerminalSidebarTabDetail]
  let unreadCount: Int
  let terminalProgress: TerminalSidebarTerminalProgress?
  let hasTerminalBell: Bool
  let shortcutHint: String?
  let showsShortcutHint: Bool
}

enum TerminalSidebarNewTabPresentation: Equatable {
  case inline
  case pinned
}

enum TerminalSidebarRowPresentation: Equatable {
  case tab(TerminalSidebarTabRowPresentation)
  case group(TerminalSidebarGroupRowPresentation)
  case pinDivider
  case newTab(TerminalSidebarNewTabPresentation)

  var measurementKey: AnyHashable {
    switch self {
    case .tab(let presentation):
      return AnyHashable(
        TerminalSidebarTabMeasurementKey(
          tabID: presentation.tab.id,
          title: presentation.tab.title,
          detailIDs: presentation.details.map(\.id)
        )
      )
    case .group(let presentation):
      return AnyHashable("group:\(presentation.id.rawValue):\(presentation.title)")
    case .pinDivider: return AnyHashable("pin-divider")
    case .newTab: return AnyHashable("new-tab")
    }
  }
}

enum TerminalSidebarAccessibilityIdentifier {
  static let newTab = "sidebar.new-tab"
  static let tabOutline = "sidebar.tab-outline"
  static let resizeHandle = "sidebar.resize-handle"

  static func spaceDot(_ spaceID: TerminalSpaceID) -> String {
    "sidebar.space-dot.\(spaceID.rawValue.uuidString.lowercased())"
  }

  static func tab(_ tabID: TerminalTabID, groupID: TerminalTabGroupID?) -> String {
    let tab = tabID.rawValue.uuidString.lowercased()
    guard let groupID else { return "sidebar.tab-row.\(tab)" }
    return "sidebar.group.\(groupID.rawValue.uuidString.lowercased()).tab.\(tab)"
  }

  static func group(_ groupID: TerminalTabGroupID) -> String {
    "sidebar.group-header.\(groupID.rawValue.uuidString.lowercased())"
  }

  static func row(_ presentation: TerminalSidebarRowPresentation) -> String {
    switch presentation {
    case .tab(let row): tab(row.tab.id, groupID: row.groupID)
    case .group(let row): group(row.id)
    case .pinDivider: "sidebar.pin-divider"
    case .newTab: newTab
    }
  }
}

@MainActor
@Observable
final class TerminalSidebarRenameState {
  private(set) var groupID: TerminalTabGroupID?
  var draft = ""
  private var originalTitle = ""

  func begin(groupID: TerminalTabGroupID, title: String) {
    self.groupID = groupID
    draft = title
    originalTitle = title
  }

  func commit(rename: (TerminalTabGroupID, String) -> Bool) {
    guard let groupID else { return }
    let normalized = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    if normalized.isEmpty || !rename(groupID, normalized) {
      draft = originalTitle
    }
    self.groupID = nil
  }

  func cancel() {
    draft = originalTitle
    groupID = nil
  }
}

struct TerminalSidebarRowActions {
  let toggleGroupCollapsed: (TerminalTabGroupID) -> Void
  let createTabInGroup: (TerminalTabGroupID) -> Void
  let renameGroup: (TerminalTabGroupID, String) -> Bool
  let setGroupColor: (TerminalTabGroupID, ThemeTint) -> Void
  let toggleGroupPinned: (TerminalTabGroupID) -> Void
  let ungroup: (TerminalTabGroupID) -> Void
  let closeGroup: (TerminalTabGroupID) -> Void
  let newTab: () -> Void
}

struct TerminalSidebarRowContext {
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let palette: Palette
  let renameState: TerminalSidebarRenameState
  let groupHeaderHoverState: TerminalSidebarGroupHoverState
  let tabSelectionState: TerminalSidebarTabSelectionState
  let outline: TerminalSidebarOutline
  let fixedHoveredGroupID: TerminalTabGroupID?
  let actions: TerminalSidebarRowActions
}

struct TerminalSidebarHostedRow: View {
  let presentation: TerminalSidebarRowPresentation
  let context: TerminalSidebarRowContext

  var body: some View {
    switch presentation {
    case .tab(let presentation):
      TerminalSidebarTabRow(
        store: context.store,
        terminal: context.terminal,
        tab: presentation.tab,
        groupID: presentation.groupID,
        rootIsPinned: presentation.rootIsPinned,
        renameState: context.renameState,
        selectionState: context.tabSelectionState,
        outline: context.outline,
        details: presentation.details,
        unreadCount: presentation.unreadCount,
        terminalProgress: presentation.terminalProgress,
        hasTerminalBell: presentation.hasTerminalBell,
        palette: context.palette,
        shortcutHint: presentation.shortcutHint,
        showsShortcutHint: presentation.showsShortcutHint
      )
    case .group(let presentation):
      TerminalSidebarGroupHeader(
        presentation: presentation,
        palette: context.palette,
        renameState: context.renameState,
        hoverState: context.groupHeaderHoverState,
        actions: context.actions
      )
    case .pinDivider:
      Rectangle()
        .fill(context.palette.sidebarSeparator)
        .frame(height: 1)
        .frame(maxHeight: .infinity)
        .accessibilityHidden(true)
    case .newTab(let newTabPresentation):
      TerminalSidebarFooterButton(
        title: "New Tab",
        symbol: "plus",
        palette: context.palette,
        showsSeparator: newTabPresentation == .pinned,
        action: context.actions.newTab
      )
      .accessibilityIdentifier(TerminalSidebarAccessibilityIdentifier.newTab)
    }
  }
}

private struct TerminalSidebarFooterButton: View {
  let title: String
  let symbol: String
  let palette: Palette
  let showsSeparator: Bool
  let action: () -> Void

  var body: some View {
    ZStack(alignment: .top) {
      Button(action: action) {
        HStack(spacing: 8) {
          Image(systemName: symbol)
            .font(.system(size: 12, weight: .semibold))
            .frame(width: 18, height: 18)
            .accessibilityHidden(true)
          Text(title)
            .font(.system(size: 13, weight: .medium))
          Spacer(minLength: 0)
        }
        .foregroundStyle(palette.secondaryText)
        .padding(.horizontal, TerminalSidebarLayout.rowHorizontalPadding)
        .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
      }
      .buttonStyle(TerminalSidebarButtonStyle(palette: palette, layout: .rect))
      .padding(.horizontal, TerminalSidebarLayout.visibleHorizontalInset)
      .frame(maxHeight: .infinity)

      if showsSeparator {
        Rectangle()
          .fill(palette.sidebarSeparator)
          .frame(height: 1)
          .accessibilityHidden(true)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct TerminalSidebarGroupHeaderButtonStyle: PrimitiveButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .contentShape(.accessibility, Rectangle())
      .accessibilityAction {
        configuration.trigger()
      }
  }
}

private struct TerminalSidebarGroupHeader: View {
  let presentation: TerminalSidebarGroupRowPresentation
  let palette: Palette
  let renameState: TerminalSidebarRenameState
  let hoverState: TerminalSidebarGroupHoverState
  let actions: TerminalSidebarRowActions

  @Shared(.supatermSettings) private var supatermSettings = .default
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @FocusState private var titleIsFocused: Bool

  private var isRenaming: Bool {
    renameState.groupID == presentation.id
  }

  private var newTabShortcut: SupatermShortcutBinding? {
    SupatermShortcuts.binding(
      for: .newTabInGroup,
      overrides: supatermSettings.shortcutOverrides
    )
  }

  private var newTabAccessory: TerminalSidebarGroupNewTabAccessory {
    TerminalSidebarGroupNewTabAccessory.resolve(
      isHovered: hoverState.groupID == presentation.id,
      showsShortcutHint: presentation.showsNewTabShortcutHint,
      shortcutHint: newTabShortcut?.display
    )
  }

  var body: some View {
    Group {
      if isRenaming {
        HStack(spacing: 6) {
          TerminalSidebarGroupMarker(
            iconURL: presentation.iconURL,
            color: presentation.color,
            palette: palette
          )
          TextField(
            "Group name",
            text: Binding(
              get: { renameState.draft },
              set: { renameState.draft = $0 }
            )
          )
          .textFieldStyle(.plain)
          .font(.system(size: 12, weight: .semibold))
          .focused($titleIsFocused)
          .onSubmit {
            renameState.commit(rename: actions.renameGroup)
          }
          .onExitCommand {
            renameState.cancel()
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
      } else {
        ZStack(alignment: .trailing) {
          Button {
            actions.toggleGroupCollapsed(presentation.id)
          } label: {
            HStack(spacing: 6) {
              TerminalSidebarGroupMarker(
                iconURL: presentation.iconURL,
                color: presentation.color,
                palette: palette
              )
              Text(presentation.title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(palette.primaryText)
                .lineLimit(1)
              Image(systemName: "chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .rotationEffect(.degrees(presentation.isCollapsed ? -90 : 0))
                .frame(width: 14, height: 20)
                .accessibilityHidden(true)
              Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(
              maxWidth: .infinity,
              minHeight: TerminalSidebarLayout.tabRowMinHeight,
              alignment: .leading
            )
          }
          .buttonStyle(TerminalSidebarGroupHeaderButtonStyle())
          .accessibilityIdentifier(
            TerminalSidebarAccessibilityIdentifier.group(presentation.id)
          )
          .accessibilityLabel(
            "\(presentation.title), \(presentation.color.displayName) group, \(presentation.tabCount) tabs"
          )
          .accessibilityValue(presentation.isCollapsed ? "Collapsed" : "Expanded")
          .accessibilityHint(presentation.isCollapsed ? "Expands the group" : "Collapses the group")
          .accessibilityAction(named: "Rename Group") {
            renameState.begin(groupID: presentation.id, title: presentation.title)
          }
          .overlay {
            TerminalSidebarRowPointerView(entryID: .group(presentation.id))
          }

          Button {
            actions.createTabInGroup(presentation.id)
          } label: {
            Group {
              switch newTabAccessory {
              case .hidden, .icon:
                Image(systemName: "plus")
                  .font(.system(size: 11, weight: .semibold))
                  .accessibilityHidden(true)
              case .shortcut(let shortcut):
                Text(shortcut)
                  .font(.system(size: 10, weight: .semibold))
              }
            }
            .frame(minWidth: 22, minHeight: 22)
          }
          .buttonStyle(.plain)
          .foregroundStyle(palette.secondaryText)
          .padding(.trailing, 8)
          .opacity(newTabAccessory.isVisible ? 1 : 0)
          .allowsHitTesting(newTabAccessory.isVisible)
          .accessibilityHidden(!newTabAccessory.isVisible)
          .accessibilityLabel("New Tab in \(presentation.title)")
        }
        .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
      }
    }
    .contentShape(Rectangle())
    .onHover { hovering in
      if hovering {
        hoverState.set(presentation.id)
      } else if hoverState.groupID == presentation.id {
        hoverState.set(nil)
      }
    }
    .onChange(of: isRenaming, initial: true) { _, isRenaming in
      titleIsFocused = isRenaming
    }
    .onChange(of: titleIsFocused) { wasFocused, isFocused in
      if wasFocused, !isFocused, isRenaming {
        renameState.commit(rename: actions.renameGroup)
      }
    }
    .terminalAnimation(
      .easeInOut(duration: 0.16),
      value: presentation.isCollapsed,
      reduceMotion: reduceMotion
    )
    .contextMenu {
      Button("New Tab in Group", systemImage: "plus") {
        actions.createTabInGroup(presentation.id)
      }
      .supatermKeyboardShortcut(newTabShortcut?.keyboardShortcut)
      Button("Rename Group", systemImage: "pencil") {
        renameState.begin(groupID: presentation.id, title: presentation.title)
      }
      Menu("Color", systemImage: "paintpalette") {
        ForEach(ThemeTint.allCases, id: \.self) { color in
          Button {
            actions.setGroupColor(presentation.id, color)
          } label: {
            if color == presentation.color {
              Label(color.displayName, systemImage: "checkmark")
            } else {
              Text(color.displayName)
            }
          }
        }
      }
      Button(
        presentation.isPinned ? "Unpin Group" : "Pin Group",
        systemImage: presentation.isPinned ? "pin.slash" : "pin"
      ) {
        actions.toggleGroupPinned(presentation.id)
      }
      Button(
        presentation.isCollapsed ? "Expand Group" : "Collapse Group",
        systemImage: presentation.isCollapsed ? "chevron.down" : "chevron.right"
      ) {
        actions.toggleGroupCollapsed(presentation.id)
      }
      Divider()
      Button("Ungroup", systemImage: "rectangle.3.group.bubble.left") {
        actions.ungroup(presentation.id)
      }
      Button(role: .destructive) {
        actions.closeGroup(presentation.id)
      } label: {
        Label("Close Group", systemImage: "xmark")
      }
    }
    .accessibilityElement(children: .contain)
  }
}

private struct TerminalSidebarGroupMarker: View {
  let iconURL: URL?
  let color: ThemeTint
  let palette: Palette

  var body: some View {
    if let iconURL, let image = NSImage(contentsOf: iconURL) {
      Image(nsImage: image)
        .resizable()
        .scaledToFit()
        .frame(width: 12, height: 12)
        .clipShape(.rect(cornerRadius: 2))
        .accessibilityHidden(true)
    } else {
      Circle()
        .fill(color.sidebarColor(palette: palette))
        .frame(width: 8, height: 8)
        .accessibilityHidden(true)
    }
  }
}

final class TerminalSidebarGroupBackgroundView: NSView {
  private let fillLayer = CAShapeLayer()
  private let strokeLayer = CAShapeLayer()
  private var renderedSurfaceState: TerminalSidebarGroupSurfaceState?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.addSublayer(fillLayer)
    layer?.addSublayer(strokeLayer)
    fillLayer.fillColor = NSColor.clear.cgColor
    strokeLayer.fillColor = NSColor.clear.cgColor
    strokeLayer.strokeColor = NSColor.clear.cgColor
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func layout() {
    super.layout()
    let lineWidth = 1 / (window?.backingScaleFactor ?? 1)
    let shapeBounds = bounds.insetBy(dx: lineWidth / 2, dy: lineWidth / 2)
    let path = RoundedRectangle(
      cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
      style: .continuous
    )
    .path(in: shapeBounds)
    .cgPath
    fillLayer.frame = bounds
    strokeLayer.frame = bounds
    fillLayer.path = path
    strokeLayer.path = path
    strokeLayer.lineWidth = lineWidth
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func update(
    color: ThemeTint,
    palette: Palette,
    surfaceState: TerminalSidebarGroupSurfaceState,
    alpha: CGFloat,
    reduceMotion: Bool
  ) {
    alphaValue = alpha
    let sidebarColor = color.sidebarNSColor(palette: palette)
    let style = TerminalSidebarGroupSurfaceStyle.resolve(color: color, state: surfaceState)
    let fillColor =
      switch style.fill {
      case .clear:
        NSColor.clear
      case .neutral:
        NSColor(themeColor: palette.sidebarGroupNeutralHoverFillValue)
      case .group(let opacity):
        sidebarColor.withAlphaComponent(opacity)
      }
    let strokeColor =
      style.showsStroke
      ? NSColor(themeColor: palette.sidebarGroupStrokeValue)
      : NSColor.clear
    let animated = !reduceMotion && renderedSurfaceState != nil && renderedSurfaceState != surfaceState
    setFillColor(fillColor.cgColor, animated: animated)
    setStrokeColor(strokeColor.cgColor, animated: animated)
    renderedSurfaceState = surfaceState
  }

  private func setFillColor(_ color: CGColor, animated: Bool) {
    let current = fillLayer.presentation()?.fillColor ?? fillLayer.fillColor
    fillLayer.removeAnimation(forKey: "fillColor")
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    fillLayer.fillColor = color
    CATransaction.commit()
    guard animated, current != color else { return }
    let animation = CABasicAnimation(keyPath: "fillColor")
    animation.fromValue = current
    animation.toValue = color
    animation.duration = 0.15
    animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    fillLayer.add(animation, forKey: "fillColor")
  }

  private func setStrokeColor(_ color: CGColor, animated: Bool) {
    let current = strokeLayer.presentation()?.strokeColor ?? strokeLayer.strokeColor
    strokeLayer.removeAnimation(forKey: "strokeColor")
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    strokeLayer.strokeColor = color
    CATransaction.commit()
    guard animated, current != color else { return }
    let animation = CABasicAnimation(keyPath: "strokeColor")
    animation.fromValue = current
    animation.toValue = color
    animation.duration = 0.15
    animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    strokeLayer.add(animation, forKey: "strokeColor")
  }
}
