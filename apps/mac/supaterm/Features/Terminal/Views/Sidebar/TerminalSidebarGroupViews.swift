import AppKit
import ComposableArchitecture
import Observation
import QuartzCore
import SupaTheme
import SwiftUI

extension TerminalTabGroupColor {
  var displayName: String {
    rawValue.capitalized
  }

  func sidebarColor(palette: Palette) -> Color {
    sidebarThemeColor(palette: palette).color
  }

  func sidebarNSColor(palette: Palette) -> NSColor {
    let color = sidebarThemeColor(palette: palette)
    return NSColor(
      srgbRed: CGFloat(color.red),
      green: CGFloat(color.green),
      blue: CGFloat(color.blue),
      alpha: CGFloat(color.alpha)
    )
  }

  private func sidebarThemeColor(palette: Palette) -> ThemeColor {
    let tone: ReferenceTone
    switch self {
    case .neutral: tone = palette.referencePalette.neutral
    case .red: tone = palette.referencePalette.rose
    case .orange: tone = palette.referencePalette.clay
    case .yellow: tone = palette.referencePalette.gold
    case .green: tone = palette.referencePalette.green
    case .blue: tone = palette.referencePalette.blue
    case .pink: tone = palette.referencePalette.blush
    case .purple: tone = palette.referencePalette.violet
    }
    return tone.color(for: palette.colorScheme)
  }
}

struct TerminalSidebarGroupRowPresentation: Equatable {
  let id: TerminalTabGroupID
  let title: String
  let color: TerminalTabGroupColor
  let isPinned: Bool
  let isCollapsed: Bool
  let tabCount: Int
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

struct TerminalSidebarGroupSurfaceStyle: Equatable {
  let fillOpacity: CGFloat
  let hoverOpacity: Float
  let strokeOpacity: CGFloat

  static func resolve(_ state: TerminalSidebarGroupSurfaceState) -> Self {
    switch state {
    case .resting:
      Self(fillOpacity: 0.10, hoverOpacity: 0, strokeOpacity: 0.18)
    case .hovered:
      Self(fillOpacity: 0.10, hoverOpacity: 1, strokeOpacity: 0.18)
    case .dropTarget:
      Self(fillOpacity: 0.10, hoverOpacity: 0, strokeOpacity: 0.85)
    }
  }
}

@MainActor
@Observable
final class TerminalSidebarGroupHoverState {
  private(set) var groupID: TerminalTabGroupID?
  @ObservationIgnored var onChange: ((TerminalTabGroupID?, TerminalTabGroupID?) -> Void)?

  func enter(_ groupID: TerminalTabGroupID) {
    guard self.groupID != groupID else { return }
    let previous = self.groupID
    self.groupID = groupID
    onChange?(previous, groupID)
  }

  func exit(_ groupID: TerminalTabGroupID) {
    guard self.groupID == groupID else { return }
    self.groupID = nil
    onChange?(groupID, nil)
  }

  func retain(_ groupIDs: Set<TerminalTabGroupID>) {
    guard let groupID, !groupIDs.contains(groupID) else { return }
    self.groupID = nil
    onChange?(groupID, nil)
  }

  func clear() {
    guard let groupID else { return }
    self.groupID = nil
    onChange?(groupID, nil)
  }
}

struct TerminalSidebarTabRowPresentation: Equatable {
  let tab: TerminalTabItem
  let groupID: TerminalTabGroupID?
  let rootIsPinned: Bool
  let notificationPresentation: TerminalHostState.SidebarNotificationPresentation?
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let terminalProgress: TerminalSidebarTerminalProgress?
  let hasTerminalBell: Bool
  let showsAgentMarks: Bool
  let showsAgentSpinner: Bool
  let shortcutHint: String?
  let showsShortcutHint: Bool
}

enum TerminalSidebarRowPresentation: Equatable {
  case tab(TerminalSidebarTabRowPresentation)
  case group(TerminalSidebarGroupRowPresentation)
  case pinDivider
  case newTab
  case newGroup

  var measurementKey: AnyHashable {
    switch self {
    case .tab(let presentation):
      let fields = [
        presentation.tab.id.rawValue.uuidString,
        presentation.tab.title,
        presentation.notificationPresentation?.previewText ?? "",
        presentation.paneWorkingDirectories.joined(separator: "|"),
      ]
      return AnyHashable(
        fields.joined(separator: ":")
      )
    case .group(let presentation):
      return AnyHashable("group:\(presentation.id.rawValue):\(presentation.title)")
    case .pinDivider: return AnyHashable("pin-divider")
    case .newTab: return AnyHashable("new-tab")
    case .newGroup: return AnyHashable("new-group")
    }
  }
}

enum TerminalSidebarAccessibilityIdentifier {
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
    case .newTab: "sidebar.new-tab"
    case .newGroup: "sidebar.new-group"
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
  let createGroup: () -> TerminalTabGroupID?
  let renameGroup: (TerminalTabGroupID, String) -> Bool
  let setGroupColor: (TerminalTabGroupID, TerminalTabGroupColor) -> Void
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
  let groupHoverState: TerminalSidebarGroupHoverState
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
        notificationPresentation: presentation.notificationPresentation,
        paneWorkingDirectories: presentation.paneWorkingDirectories,
        unreadCount: presentation.unreadCount,
        terminalProgress: presentation.terminalProgress,
        hasTerminalBell: presentation.hasTerminalBell,
        palette: context.palette,
        showsAgentMarks: presentation.showsAgentMarks,
        showsAgentSpinner: presentation.showsAgentSpinner,
        shortcutHint: presentation.shortcutHint,
        showsShortcutHint: presentation.showsShortcutHint
      )
      .onHover { isHovering in
        guard isHovering, let groupID = presentation.groupID else { return }
        context.groupHoverState.exit(groupID)
      }
    case .group(let presentation):
      TerminalSidebarGroupHeader(
        presentation: presentation,
        palette: context.palette,
        renameState: context.renameState,
        hoverState: context.groupHoverState,
        actions: context.actions
      )
    case .pinDivider:
      Rectangle()
        .fill(context.palette.sidebarSeparator)
        .frame(height: 1)
        .padding(.horizontal, TerminalSidebarLayout.rowHorizontalPadding)
        .frame(maxHeight: .infinity)
        .accessibilityHidden(true)
    case .newTab:
      TerminalSidebarFooterButton(
        title: "New Tab",
        symbol: "plus",
        palette: context.palette,
        action: context.actions.newTab
      )
      .accessibilityIdentifier("sidebar.new-tab")
    case .newGroup:
      TerminalSidebarFooterButton(
        title: "New Group",
        symbol: "rectangle.3.group",
        palette: context.palette
      ) {
        guard let id = context.actions.createGroup() else { return }
        context.renameState.begin(groupID: id, title: "New Group")
      }
      .accessibilityIdentifier("sidebar.new-group")
    }
  }
}

private struct TerminalSidebarFooterButton: View {
  let title: String
  let symbol: String
  let palette: Palette
  let action: () -> Void

  var body: some View {
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
  }
}

private struct TerminalSidebarGroupHeader: View {
  let presentation: TerminalSidebarGroupRowPresentation
  let palette: Palette
  let renameState: TerminalSidebarRenameState
  let hoverState: TerminalSidebarGroupHoverState
  let actions: TerminalSidebarRowActions

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @FocusState private var titleIsFocused: Bool

  private var isRenaming: Bool {
    renameState.groupID == presentation.id
  }

  var body: some View {
    HStack(spacing: 6) {
      Button {
        actions.toggleGroupCollapsed(presentation.id)
      } label: {
        Image(systemName: "chevron.down")
          .font(.system(size: 9, weight: .semibold))
          .rotationEffect(.degrees(presentation.isCollapsed ? -90 : 0))
          .frame(width: 14, height: 20)
          .contentShape(Rectangle())
          .accessibilityHidden(true)
      }
      .buttonStyle(.plain)

      Circle()
        .fill(presentation.color.sidebarColor(palette: palette))
        .frame(width: 8, height: 8)
        .accessibilityHidden(true)

      if isRenaming {
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
      } else {
        Text(presentation.title)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(palette.primaryText)
          .lineLimit(1)
          .onTapGesture(count: 2) {
            renameState.begin(groupID: presentation.id, title: presentation.title)
          }
      }

      Spacer(minLength: 0)

      if hoverState.groupID == presentation.id, !isRenaming {
        Button {
          actions.createTabInGroup(presentation.id)
        } label: {
          Image(systemName: "plus")
            .font(.system(size: 11, weight: .semibold))
            .frame(width: 22, height: 22)
        }
        .buttonStyle(.plain)
        .foregroundStyle(palette.secondaryText)
        .accessibilityLabel("New Tab in \(presentation.title)")
      }
    }
    .padding(.horizontal, 8)
    .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
    .contentShape(Rectangle())
    .onHover { isHovering in
      if isHovering {
        hoverState.enter(presentation.id)
      } else {
        hoverState.exit(presentation.id)
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
      Button("New Tab", systemImage: "plus") {
        actions.createTabInGroup(presentation.id)
      }
      Button("Rename Group", systemImage: "pencil") {
        renameState.begin(groupID: presentation.id, title: presentation.title)
      }
      Menu("Color", systemImage: "paintpalette") {
        ForEach(TerminalTabGroupColor.allCases, id: \.self) { color in
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
    .accessibilityElement(children: isRenaming ? .contain : .combine)
    .accessibilityLabel(
      "\(presentation.title), \(presentation.color.displayName) group, \(presentation.tabCount) tabs"
    )
    .accessibilityValue(presentation.isCollapsed ? "Collapsed" : "Expanded")
    .accessibilityAction(named: presentation.isCollapsed ? "Expand" : "Collapse") {
      actions.toggleGroupCollapsed(presentation.id)
    }
    .accessibilityIdentifier(
      TerminalSidebarAccessibilityIdentifier.group(presentation.id)
    )
  }
}

final class TerminalSidebarGroupBackgroundView: NSView {
  private let fillLayer = CAShapeLayer()
  private let hoverLayer = CAShapeLayer()
  private let strokeLayer = CAShapeLayer()

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.addSublayer(fillLayer)
    layer?.addSublayer(hoverLayer)
    layer?.addSublayer(strokeLayer)
    fillLayer.fillColor = NSColor.clear.cgColor
    hoverLayer.fillColor = NSColor.clear.cgColor
    hoverLayer.opacity = 0
    strokeLayer.fillColor = NSColor.clear.cgColor
    strokeLayer.lineWidth = 1.5
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func layout() {
    super.layout()
    let path = CGPath(
      roundedRect: bounds,
      cornerWidth: TerminalSidebarLayout.tabRowCornerRadius,
      cornerHeight: TerminalSidebarLayout.tabRowCornerRadius,
      transform: nil
    )
    fillLayer.frame = bounds
    hoverLayer.frame = bounds
    strokeLayer.frame = bounds
    fillLayer.path = path
    hoverLayer.path = path
    strokeLayer.path = path
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func update(
    color: TerminalTabGroupColor,
    palette: Palette,
    surfaceState: TerminalSidebarGroupSurfaceState,
    alpha: CGFloat,
    reduceMotion: Bool
  ) {
    alphaValue = alpha
    let sidebarColor = color.sidebarNSColor(palette: palette)
    let style = TerminalSidebarGroupSurfaceStyle.resolve(surfaceState)
    fillLayer.fillColor = sidebarColor.withAlphaComponent(style.fillOpacity).cgColor
    let hoverColor = palette.sidebarGroupHoverFillValue
    hoverLayer.fillColor =
      NSColor(
        srgbRed: CGFloat(hoverColor.red),
        green: CGFloat(hoverColor.green),
        blue: CGFloat(hoverColor.blue),
        alpha: CGFloat(hoverColor.alpha)
      ).cgColor
    strokeLayer.strokeColor = sidebarColor.withAlphaComponent(style.strokeOpacity).cgColor
    setHoverOpacity(style.hoverOpacity, animated: !reduceMotion)
  }

  private func setHoverOpacity(_ opacity: Float, animated: Bool) {
    let current = hoverLayer.presentation()?.opacity ?? hoverLayer.opacity
    hoverLayer.removeAnimation(forKey: "hoverOpacity")
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    hoverLayer.opacity = opacity
    CATransaction.commit()
    guard animated, current != opacity else { return }
    let animation = CABasicAnimation(keyPath: "opacity")
    animation.fromValue = current
    animation.toValue = opacity
    animation.duration = 0.15
    animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    hoverLayer.add(animation, forKey: "hoverOpacity")
  }
}
