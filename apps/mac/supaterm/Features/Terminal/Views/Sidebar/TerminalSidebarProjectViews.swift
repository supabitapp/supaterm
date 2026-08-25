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

struct TerminalSidebarProjectRowPresentation: Equatable {
  let id: TerminalProjectID
  let title: String
  let color: ThemeTint
  let iconURL: URL?
  let isPinned: Bool
  let isCollapsed: Bool
  let tabIDs: [TerminalTabID]
  let showsNewTabShortcutHint: Bool

  var tabCount: Int { tabIDs.count }
}

struct TerminalSidebarUnassignedRowPresentation: Equatable {
  let isCollapsed: Bool
  let tabCount: Int
}

enum TerminalSidebarProjectNewTabAccessory: Equatable {
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

enum TerminalSidebarProjectSurfaceState: Equatable {
  case resting
  case hovered
  case dropTarget

  static func resolve(isHovered: Bool, isDropTarget: Bool) -> Self {
    if isDropTarget { return .dropTarget }
    return isHovered ? .hovered : .resting
  }
}

enum TerminalSidebarProjectSurfaceFill: Equatable {
  case clear
  case neutral
  case project(opacity: CGFloat)
}

struct TerminalSidebarProjectSurfaceStyle: Equatable {
  let fill: TerminalSidebarProjectSurfaceFill
  let showsStroke: Bool

  static func resolve(
    color: ThemeTint,
    state: TerminalSidebarProjectSurfaceState
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
      return Self(fill: .project(opacity: 0.15), showsStroke: true)
    case .hovered, .dropTarget:
      return Self(fill: .project(opacity: 0.25), showsStroke: true)
    }
  }
}

@MainActor
@Observable
final class TerminalSidebarProjectHoverState {
  private(set) var projectID: TerminalProjectID?

  func set(_ projectID: TerminalProjectID?) {
    guard self.projectID != projectID else { return }
    self.projectID = projectID
  }

  func retain(_ projectIDs: Set<TerminalProjectID>) {
    guard let projectID, !projectIDs.contains(projectID) else { return }
    self.projectID = nil
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

private enum TerminalSidebarTabMeasurementKey: Hashable {
  case tab(
    id: TerminalTabID,
    title: String,
    detailIDs: [TerminalSidebarTabDetail.ID],
    isGrouped: Bool
  )
}

struct TerminalSidebarTabRowPresentation: Equatable {
  let tab: TerminalTabItem
  let projectID: TerminalProjectID?
  let rootIsPinned: Bool
  let agentStatus: TerminalHostState.TabAgentStatus?
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
  case project(TerminalSidebarProjectRowPresentation)
  case unassigned(TerminalSidebarUnassignedRowPresentation)
  case pinDivider
  case newTab(TerminalSidebarNewTabPresentation)

  var measurementKey: AnyHashable {
    switch self {
    case .tab(let presentation):
      return AnyHashable(
        TerminalSidebarTabMeasurementKey.tab(
          id: presentation.tab.id,
          title: presentation.tab.title,
          detailIDs: presentation.details.map(\.id),
          isGrouped: presentation.groupID != nil
        )
      )
    case .project(let presentation):
      return AnyHashable("project:\(presentation.id.rawValue):\(presentation.title)")
    case .unassigned(let presentation):
      return AnyHashable("unassigned:\(presentation.tabCount)")
    case .pinDivider: return AnyHashable("pin-divider")
    case .newTab: return AnyHashable("new-tab")
    }
  }
}

enum TerminalSidebarAccessibilityIdentifier {
  static let newTab = "sidebar.new-tab"
  static let unassigned = "sidebar.unassigned-header"
  static let tabOutline = "sidebar.tab-outline"
  static let resizeHandle = "sidebar.resize-handle"

  static func spaceDot(_ spaceID: TerminalSpaceID) -> String {
    "sidebar.space-dot.\(spaceID.rawValue.uuidString.lowercased())"
  }

  static func tab(_ tabID: TerminalTabID, projectID: TerminalProjectID?) -> String {
    let tab = tabID.rawValue.uuidString.lowercased()
    guard let projectID else { return "sidebar.tab-row.\(tab)" }
    return "sidebar.project.\(projectID.rawValue.uuidString.lowercased()).tab.\(tab)"
  }

  static func project(_ projectID: TerminalProjectID) -> String {
    "sidebar.project-header.\(projectID.rawValue.uuidString.lowercased())"
  }

  static func row(_ presentation: TerminalSidebarRowPresentation) -> String {
    switch presentation {
    case .tab(let row): tab(row.tab.id, projectID: row.projectID)
    case .project(let row): project(row.id)
    case .unassigned: unassigned
    case .pinDivider: "sidebar.pin-divider"
    case .newTab: newTab
    }
  }
}

@MainActor
@Observable
final class TerminalSidebarRenameState {
  private(set) var projectID: TerminalProjectID?
  var draft = ""
  private var originalTitle = ""

  func begin(projectID: TerminalProjectID, title: String) {
    self.projectID = projectID
    draft = title
    originalTitle = title
  }

  func commit(rename: (TerminalProjectID, String) -> Bool) {
    guard let projectID else { return }
    let normalized = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    if normalized.isEmpty || !rename(projectID, normalized) {
      draft = originalTitle
    }
    self.projectID = nil
  }

  func cancel() {
    draft = originalTitle
    projectID = nil
  }
}

struct TerminalSidebarRowActions {
  let toggleProjectCollapsed: (TerminalProjectID) -> Void
  let toggleUnassignedCollapsed: () -> Void
  let createTabInProject: (TerminalProjectID) -> Void
  let renameProject: (TerminalProjectID, String) -> Bool
  let setProjectColor: (TerminalProjectID, ThemeTint) -> Void
  let toggleProjectPinned: (TerminalProjectID) -> Void
  let unproject: ([TerminalTabID]) -> Void
  let closeProject: (TerminalProjectID) -> Void
  let newTab: () -> Void
}

struct TerminalSidebarRowContext {
  let terminal: TerminalHostState
  let palette: Palette
  let renameState: TerminalSidebarRenameState
  let projectHeaderHoverState: TerminalSidebarProjectHoverState
  let tabSelectionState: TerminalSidebarTabSelectionState
  let outline: TerminalSidebarOutline
  let fixedHoveredProjectID: TerminalProjectID?
  let actions: TerminalSidebarRowActions
}

struct TerminalSidebarHostedRow: View {
  let presentation: TerminalSidebarRowPresentation
  let context: TerminalSidebarRowContext

  var body: some View {
    switch presentation {
    case .tab(let presentation):
      TerminalSidebarTabRow(
        terminal: context.terminal,
        tab: presentation.tab,
        projectID: presentation.projectID,
        rootIsPinned: presentation.rootIsPinned,
        renameState: context.renameState,
        selectionState: context.tabSelectionState,
        outline: context.outline,
        agentStatus: presentation.agentStatus,
        details: presentation.details,
        unreadCount: presentation.unreadCount,
        terminalProgress: presentation.terminalProgress,
        hasTerminalBell: presentation.hasTerminalBell,
        palette: context.palette,
        shortcutHint: presentation.shortcutHint,
        showsShortcutHint: presentation.showsShortcutHint
      )
    case .project(let presentation):
      TerminalSidebarProjectHeader(
        presentation: presentation,
        palette: context.palette,
        renameState: context.renameState,
        hoverState: context.projectHeaderHoverState,
        actions: context.actions
      )
    case .unassigned(let presentation):
      TerminalSidebarUnassignedHeader(
        presentation: presentation,
        palette: context.palette,
        action: context.actions.toggleUnassignedCollapsed
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

private struct TerminalSidebarUnassignedHeader: View {
  let presentation: TerminalSidebarUnassignedRowPresentation
  let palette: Palette
  let action: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        TerminalSidebarProjectMarker(iconURL: nil, color: .neutral, palette: palette)
        Text("Unassigned")
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
    .buttonStyle(TerminalSidebarProjectHeaderButtonStyle())
    .accessibilityIdentifier(TerminalSidebarAccessibilityIdentifier.unassigned)
    .accessibilityLabel("Unassigned, \(presentation.tabCount) tabs")
    .accessibilityValue(presentation.isCollapsed ? "Collapsed" : "Expanded")
    .accessibilityHint(
      presentation.isCollapsed ? "Expands unassigned tabs" : "Collapses unassigned tabs"
    )
    .overlay {
      TerminalSidebarRowPointerView(entryID: .unassigned)
    }
    .contextMenu {
      Button(
        presentation.isCollapsed ? "Expand Unassigned" : "Collapse Unassigned",
        systemImage: presentation.isCollapsed ? "chevron.down" : "chevron.right",
        action: action
      )
    }
    .terminalAnimation(
      .easeInOut(duration: 0.16),
      value: presentation.isCollapsed,
      reduceMotion: reduceMotion
    )
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

private struct TerminalSidebarProjectHeaderButtonStyle: PrimitiveButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .contentShape(.accessibility, Rectangle())
      .accessibilityAction {
        configuration.trigger()
      }
  }
}

private struct TerminalSidebarProjectHeader: View {
  let presentation: TerminalSidebarProjectRowPresentation
  let palette: Palette
  let renameState: TerminalSidebarRenameState
  let hoverState: TerminalSidebarProjectHoverState
  let actions: TerminalSidebarRowActions

  @Shared(.supatermSettings) private var supatermSettings = .default
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @FocusState private var titleIsFocused: Bool

  private var isRenaming: Bool {
    renameState.projectID == presentation.id
  }

  private var newTabShortcut: SupatermShortcutBinding? {
    SupatermShortcuts.binding(
      for: .newTabInProject,
      overrides: supatermSettings.shortcutOverrides
    )
  }

  private var newTabAccessory: TerminalSidebarProjectNewTabAccessory {
    TerminalSidebarProjectNewTabAccessory.resolve(
      isHovered: hoverState.projectID == presentation.id,
      showsShortcutHint: presentation.showsNewTabShortcutHint,
      shortcutHint: newTabShortcut?.display
    )
  }

  var body: some View {
    Group {
      if isRenaming {
        HStack(spacing: 6) {
          TerminalSidebarProjectMarker(
            iconURL: presentation.iconURL,
            color: presentation.color,
            palette: palette
          )
          TextField(
            "Project name",
            text: Binding(
              get: { renameState.draft },
              set: { renameState.draft = $0 }
            )
          )
          .textFieldStyle(.plain)
          .font(.system(size: 12, weight: .semibold))
          .focused($titleIsFocused)
          .onSubmit {
            renameState.commit(rename: actions.renameProject)
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
            actions.toggleProjectCollapsed(presentation.id)
          } label: {
            HStack(spacing: 6) {
              TerminalSidebarProjectMarker(
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
          .buttonStyle(TerminalSidebarProjectHeaderButtonStyle())
          .accessibilityIdentifier(
            TerminalSidebarAccessibilityIdentifier.project(presentation.id)
          )
          .accessibilityLabel(
            "\(presentation.title), \(presentation.color.displayName) project, \(presentation.tabCount) tabs"
          )
          .accessibilityValue(presentation.isCollapsed ? "Collapsed" : "Expanded")
          .accessibilityHint(presentation.isCollapsed ? "Expands the project" : "Collapses the project")
          .accessibilityAction(named: "Rename Project") {
            renameState.begin(projectID: presentation.id, title: presentation.title)
          }
          .overlay {
            TerminalSidebarRowPointerView(entryID: .project(presentation.id))
          }

          Button {
            actions.createTabInProject(presentation.id)
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
      } else if hoverState.projectID == presentation.id {
        hoverState.set(nil)
      }
    }
    .onChange(of: isRenaming, initial: true) { _, isRenaming in
      titleIsFocused = isRenaming
    }
    .onChange(of: titleIsFocused) { wasFocused, isFocused in
      if wasFocused, !isFocused, isRenaming {
        renameState.commit(rename: actions.renameProject)
      }
    }
    .terminalAnimation(
      .easeInOut(duration: 0.16),
      value: presentation.isCollapsed,
      reduceMotion: reduceMotion
    )
    .contextMenu {
      Button("New Tab in Project", systemImage: "plus") {
        actions.createTabInProject(presentation.id)
      }
      .supatermKeyboardShortcut(newTabShortcut?.keyboardShortcut)
      Button("Rename Project", systemImage: "pencil") {
        renameState.begin(projectID: presentation.id, title: presentation.title)
      }
      Menu("Color", systemImage: "paintpalette") {
        ForEach(ThemeTint.allCases, id: \.self) { color in
          Button {
            actions.setProjectColor(presentation.id, color)
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
        presentation.isPinned ? "Unpin Project" : "Pin Project",
        systemImage: presentation.isPinned ? "pin.slash" : "pin"
      ) {
        actions.toggleProjectPinned(presentation.id)
      }
      Button(
        presentation.isCollapsed ? "Expand Project" : "Collapse Project",
        systemImage: presentation.isCollapsed ? "chevron.down" : "chevron.right"
      ) {
        actions.toggleProjectCollapsed(presentation.id)
      }
      Divider()
      Button("Remove Tabs from Project", systemImage: "rectangle.3.project.bubble.left") {
        actions.unproject(presentation.tabIDs)
      }
      Button(role: .destructive) {
        actions.closeProject(presentation.id)
      } label: {
        Label("Remove Project", systemImage: "xmark")
      }
    }
    .accessibilityElement(children: .contain)
  }
}

private struct TerminalSidebarProjectMarker: View {
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

final class TerminalSidebarProjectBackgroundView: NSView {
  private let fillLayer = CAShapeLayer()
  private let strokeLayer = CAShapeLayer()
  private var renderedSurfaceState: TerminalSidebarProjectSurfaceState?

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
    surfaceState: TerminalSidebarProjectSurfaceState,
    alpha: CGFloat,
    reduceMotion: Bool
  ) {
    alphaValue = alpha
    let sidebarColor = color.sidebarNSColor(palette: palette)
    let style = TerminalSidebarProjectSurfaceStyle.resolve(color: color, state: surfaceState)
    let fillColor =
      switch style.fill {
      case .clear:
        NSColor.clear
      case .neutral:
        NSColor(themeColor: palette.sidebarProjectNeutralHoverFillValue)
      case .project(let opacity):
        sidebarColor.withAlphaComponent(opacity)
      }
    let strokeColor =
      style.showsStroke
      ? NSColor(themeColor: palette.sidebarProjectStrokeValue)
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
