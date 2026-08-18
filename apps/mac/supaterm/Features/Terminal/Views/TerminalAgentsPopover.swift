import AppKit
import SupaTheme
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

  static func preferredHeight(itemCount: Int) -> CGFloat {
    headerTopInset
      + headerHeight
      + headerToRowsSpacing
      + CGFloat(visibleItemCount(itemCount)) * rowHeight
      + bottomInset
  }
}

struct TerminalAgentsPopoverItem: Identifiable {
  let id: String
  let role: String
  let symbol: String
  let task: String
  let workspace: String
  let phase: AgentActivityPhase

  var subtitle: String {
    "\(role) · \(workspace)"
  }

  var phaseTitle: String {
    switch phase {
    case .idle:
      "Done"
    case .needsInput:
      "Needs input"
    case .running:
      "Working"
    }
  }

  static let dummyData = [
    TerminalAgentsPopoverItem(
      id: "build-popover",
      role: "Builder",
      symbol: "hammer.fill",
      task: "Build the agents popview",
      workspace: "supaterm",
      phase: .running
    ),
    TerminalAgentsPopoverItem(
      id: "inspect-interaction",
      role: "Researcher",
      symbol: "magnifyingglass",
      task: "Inspect the interaction",
      workspace: "ui-research",
      phase: .idle
    ),
    TerminalAgentsPopoverItem(
      id: "review-layout",
      role: "Reviewer",
      symbol: "text.document",
      task: "Review spacing and type",
      workspace: "supaterm",
      phase: .needsInput
    ),
    TerminalAgentsPopoverItem(
      id: "test-appearance",
      role: "Tester",
      symbol: "checkmark.seal.fill",
      task: "Check light and dark modes",
      workspace: "supaterm",
      phase: .running
    ),
  ]
}

struct TerminalAgentsPopoverButton: View {
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

        if TerminalAgentsPopoverItem.dummyData.contains(where: { $0.phase == .needsInput }) {
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
        items: TerminalAgentsPopoverItem.dummyData,
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
  let items: [TerminalAgentsPopoverItem]
  let palette: Palette

  @State private var acceptsInput = false

  private var visibleRowCount: Int {
    TerminalAgentsPopoverMetrics.visibleItemCount(items.count)
  }

  var body: some View {
    VStack(spacing: 0) {
      header
        .padding(.top, TerminalAgentsPopoverMetrics.headerTopInset)

      Color.clear
        .frame(height: TerminalAgentsPopoverMetrics.headerToRowsSpacing)

      ScrollView {
        LazyVStack(spacing: 0) {
          ForEach(items) { item in
            TerminalAgentsPopoverRow(item: item, palette: palette)
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
  let item: TerminalAgentsPopoverItem
  let palette: Palette

  @State private var isHovered = false

  var body: some View {
    HStack(spacing: 8) {
      roleIcon

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
    .accessibilityLabel("\(item.task), \(item.subtitle), \(item.phaseTitle)")
  }

  private var roleIcon: some View {
    Image(systemName: item.symbol)
      .font(.system(size: 10, weight: .semibold))
      .foregroundStyle(palette.accent)
      .frame(width: 20, height: 20)
      .background(palette.accent.opacity(0.12), in: .circle)
      .accessibilityHidden(true)
  }

  @ViewBuilder
  private var statusIcon: some View {
    switch item.phase {
    case .idle:
      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(palette.success)
        .accessibilityHidden(true)
    case .needsInput:
      Image(systemName: "bell.fill")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.warning)
        .accessibilityHidden(true)
    case .running:
      TerminalAgentRunningSpinnerView(tone: .working, palette: palette, diameter: 11)
        .accessibilityHidden(true)
    }
  }
}

private struct TerminalAgentsPopoverPresenter: NSViewRepresentable {
  @Binding var isPresented: Bool
  let items: [TerminalAgentsPopoverItem]
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
  private var items = [TerminalAgentsPopoverItem]()
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
    items: [TerminalAgentsPopoverItem],
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
