import AppKit
import SupaTheme
import SupatermCLIShared
import SupatermUI
import SwiftUI

enum TerminalAgentsPopoverMetrics {
  static let width: CGFloat = 260
  static let headerTopInset: CGFloat = 10
  static let headerHeight: CGFloat = 24
  static let headerToRowsSpacing: CGFloat = 4
  static let rowHeight: CGFloat = 36
  static let bottomInset: CGFloat = 8
  static let maximumVisibleRows = 8

  static func visibleItemCount(_ itemCount: Int) -> Int {
    min(max(itemCount, 0), maximumVisibleRows)
  }

  static func visibleContentRowCount(_ itemCount: Int) -> Int {
    max(visibleItemCount(itemCount), 1)
  }

  static func preferredHeight(itemCount: Int) -> CGFloat {
    headerTopInset
      + headerHeight
      + headerToRowsSpacing
      + CGFloat(visibleContentRowCount(itemCount)) * rowHeight
      + bottomInset
  }
}

extension TerminalHostState.AgentPresentationStatus {
  fileprivate var title: String {
    switch self {
    case .unknown:
      "Unknown"
    case .idle:
      "Idle"
    case .done:
      "Done"
    case .needsInput:
      "Needs input"
    case .working:
      "Working"
    }
  }
}

private enum TerminalAgentsPopoverIcon {
  case asset(String)
  case system(String)
}

extension TerminalHostState.WindowAgentPresentation {
  fileprivate var subtitle: String {
    "\(identity.displayName) · \(workspace)"
  }

  fileprivate var icon: TerminalAgentsPopoverIcon {
    if let agent = SupatermAgentKind(rawValue: identity.id) {
      .asset(agent.markImageName)
    } else {
      .system("terminal.fill")
    }
  }

  static let snapshotData = [
    snapshot(
      agent: .codex,
      sessionID: "build-popover",
      task: "Build the agents popview",
      workspace: "supaterm",
      status: .working
    ),
    snapshot(
      agent: .claude,
      sessionID: "inspect-interaction",
      task: "Inspect the interaction",
      workspace: "ui-research",
      status: .done
    ),
    snapshot(
      agent: .pi,
      sessionID: "review-layout",
      task: "Review spacing and type",
      workspace: "supaterm",
      status: .needsInput
    ),
    snapshot(
      agent: .codex,
      sessionID: "test-appearance",
      task: "Check light and dark modes",
      workspace: "supaterm",
      status: .working
    ),
  ]

  private static func snapshot(
    agent: SupatermAgentKind,
    sessionID: String,
    task: String,
    workspace: String,
    status: TerminalHostState.AgentPresentationStatus
  ) -> Self {
    Self(
      id: TerminalHostState.WindowAgentPresentationID(
        surfaceID: UUID(),
        completionIdentity: .native(agent: agent, sessionID: sessionID)
      ),
      identity: AgentDetectionAgentIdentity(agent),
      task: task,
      workspace: workspace,
      status: status
    )
  }
}

struct TerminalAgentsPopoverButton: View {
  let items: [TerminalHostState.WindowAgentPresentation]
  let palette: Palette

  @State private var isHovered = false
  @State private var isPresented = false

  var body: some View {
    Button {
      isPresented.toggle()
    } label: {
      ZStack(alignment: .topTrailing) {
        Image(systemName: "line.3.horizontal.decrease")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(foregroundStyle)
          .frame(width: 28, height: 28)

        if items.contains(where: { $0.status == .needsInput }) {
          Circle()
            .fill(palette.warning)
            .frame(width: 6, height: 6)
            .overlay {
              Circle()
                .stroke(palette.windowBackgroundTint, lineWidth: 1.5)
            }
            .offset(x: 1, y: 1)
            .accessibilityHidden(true)
        }
      }
      .background(backgroundStyle, in: .rect(cornerRadius: 7))
      .accessibilityHidden(true)
    }
    .buttonStyle(.plain)
    .background {
      TerminalAgentsPopoverPresenter(
        isPresented: $isPresented,
        items: items,
        palette: palette
      )
    }
    .onHover { isHovered = $0 }
    .help("Agents")
    .accessibilityLabel(isPresented ? "Close agents" : "Show agents")
    .accessibilityIdentifier("titlebar.agents")
  }

  private var foregroundStyle: Color {
    isHovered || isPresented ? palette.primaryText : palette.secondaryText
  }

  private var backgroundStyle: Color {
    isHovered || isPresented ? palette.secondaryText.opacity(0.1) : .clear
  }
}

struct TerminalAgentsPopoverView: View {
  let items: [TerminalHostState.WindowAgentPresentation]
  let palette: Palette

  @State private var acceptsInput = false

  private var visibleRowCount: Int {
    TerminalAgentsPopoverMetrics.visibleContentRowCount(items.count)
  }

  var body: some View {
    VStack(spacing: 0) {
      header
        .padding(.top, TerminalAgentsPopoverMetrics.headerTopInset)

      Color.clear
        .frame(height: TerminalAgentsPopoverMetrics.headerToRowsSpacing)

      ScrollView {
        if items.isEmpty {
          Text("No active agents")
            .font(.system(size: 11))
            .foregroundStyle(palette.secondaryText)
            .frame(maxWidth: .infinity, minHeight: TerminalAgentsPopoverMetrics.rowHeight)
            .accessibilityIdentifier("agents.popover.empty")
        } else {
          LazyVStack(spacing: 0) {
            ForEach(items) { item in
              TerminalAgentsPopoverRow(item: item, palette: palette)
            }
          }
        }
      }
      .scrollIndicators(.hidden)
      .frame(height: CGFloat(visibleRowCount) * TerminalAgentsPopoverMetrics.rowHeight)

      Color.clear
        .frame(height: TerminalAgentsPopoverMetrics.bottomInset)
    }
    .frame(
      width: TerminalAgentsPopoverMetrics.width,
      height: TerminalAgentsPopoverMetrics.preferredHeight(itemCount: items.count)
    )
    .overlay {
      Color.clear
        .contentShape(.rect)
        .allowsHitTesting(!acceptsInput)
    }
    .task {
      acceptsInput = false
      do {
        try await Task.sleep(for: .seconds(1))
      } catch {
        return
      }
      acceptsInput = true
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Agents")
    .accessibilityIdentifier("agents.popover")
  }

  private var header: some View {
    HStack(spacing: 8) {
      Text("AGENTS")
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(palette.secondaryText)

      Spacer(minLength: 0)

      Text(items.count, format: .number)
        .font(.system(size: 11, weight: .medium).monospacedDigit())
        .foregroundStyle(palette.secondaryText)
    }
    .padding(.leading, 12)
    .padding(.trailing, 10)
    .frame(height: TerminalAgentsPopoverMetrics.headerHeight)
  }
}

private struct TerminalAgentsPopoverRow: View {
  let item: TerminalHostState.WindowAgentPresentation
  let palette: Palette

  @State private var isHovered = false

  var body: some View {
    HStack(spacing: 8) {
      icon

      VStack(alignment: .leading, spacing: 0) {
        Text(item.task)
          .font(.system(size: 12))
          .foregroundStyle(palette.primaryText)
          .lineLimit(1)
          .truncationMode(.tail)

        Text(item.subtitle)
          .font(.system(size: 10))
          .foregroundStyle(palette.secondaryText)
          .lineLimit(1)
          .truncationMode(.middle)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      statusIcon
        .frame(width: 20, height: 20)
    }
    .padding(.horizontal, 8)
    .frame(height: TerminalAgentsPopoverMetrics.rowHeight)
    .background {
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .fill(isHovered ? Color.black.opacity(0.05) : .clear)
        .padding(.horizontal, 4)
    }
    .contentShape(.rect)
    .onHover { isHovered = $0 }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(item.task), \(item.subtitle), \(item.status.title)")
  }

  @ViewBuilder
  private var agentIconContent: some View {
    switch item.icon {
    case .asset(let name):
      Image(name)
        .renderingMode(.template)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .padding(5)
        .accessibilityHidden(true)
    case .system(let name):
      Image(systemName: name)
        .font(.system(size: 10, weight: .semibold))
        .accessibilityHidden(true)
    }
  }

  private var icon: some View {
    agentIconContent
      .foregroundStyle(palette.accent)
      .frame(width: 20, height: 20)
      .background(palette.accent.opacity(0.12), in: .circle)
  }

  @ViewBuilder
  private var statusIcon: some View {
    switch item.status {
    case .unknown:
      Image(systemName: "questionmark.circle")
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
    case .idle:
      Image(systemName: "pause.circle")
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(palette.secondaryText)
        .accessibilityHidden(true)
    case .done:
      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(palette.success)
        .accessibilityHidden(true)
    case .needsInput:
      Image(systemName: "bell.fill")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.warning)
        .accessibilityHidden(true)
    case .working:
      DotsSpinner(size: 11, color: palette.working)
        .frame(width: 16, height: 16)
        .accessibilityHidden(true)
    }
  }
}

private struct TerminalAgentsPopoverPresenter: NSViewRepresentable {
  @Binding var isPresented: Bool
  let items: [TerminalHostState.WindowAgentPresentation]
  let palette: Palette

  func makeNSView(context: Context) -> TerminalAgentsPopoverAnchorView {
    TerminalAgentsPopoverAnchorView()
  }

  func updateNSView(_ nsView: TerminalAgentsPopoverAnchorView, context: Context) {
    nsView.render(
      isPresented: isPresented,
      items: items,
      palette: palette,
      onDismiss: {
        isPresented = false
      }
    )
  }

  static func dismantleNSView(
    _ nsView: TerminalAgentsPopoverAnchorView,
    coordinator: ()
  ) {
    nsView.closePopover()
  }
}

private final class TerminalAgentsPopoverAnchorView: NSView, NSPopoverDelegate {
  private var hostingController: NSHostingController<TerminalAgentsPopoverView>?
  private var isPresented = false
  private var items = [TerminalHostState.WindowAgentPresentation]()
  private var onDismiss: (() -> Void)?
  private var palette = Palette(colorScheme: .light)
  private let popover: NSPopover

  override init(frame frameRect: NSRect) {
    popover = NSPopover()
    super.init(frame: frameRect)
    popover.behavior = .transient
    popover.delegate = self
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    nil
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    reconcilePresentation()
  }

  func render(
    isPresented: Bool,
    items: [TerminalHostState.WindowAgentPresentation],
    palette: Palette,
    onDismiss: @escaping () -> Void
  ) {
    self.isPresented = isPresented
    self.items = items
    self.palette = palette
    self.onDismiss = onDismiss
    reconcilePresentation()
  }

  func closePopover() {
    isPresented = false
    if popover.isShown {
      popover.close()
    } else {
      clearContent()
    }
  }

  func popoverDidClose(_ notification: Notification) {
    clearContent()
    guard isPresented else { return }
    isPresented = false
    onDismiss?()
  }

  private func reconcilePresentation() {
    guard isPresented, window != nil else {
      if popover.isShown {
        popover.close()
      }
      return
    }

    let content = TerminalAgentsPopoverView(items: items, palette: palette)
    let contentSize = CGSize(
      width: TerminalAgentsPopoverMetrics.width,
      height: TerminalAgentsPopoverMetrics.preferredHeight(itemCount: items.count)
    )

    if let hostingController {
      hostingController.rootView = content
      hostingController.preferredContentSize = contentSize
    } else {
      let hostingController = NSHostingController(rootView: content)
      hostingController.preferredContentSize = contentSize
      self.hostingController = hostingController
      popover.contentViewController = hostingController
    }
    popover.contentSize = contentSize

    if !popover.isShown {
      popover.show(relativeTo: bounds, of: self, preferredEdge: .minY)
    }
  }

  private func clearContent() {
    hostingController = nil
    popover.contentViewController = nil
  }
}
