import AppKit
import SwiftUI

struct GhosttySurfaceSearchOverlay: View {
  static let topReservedHeight: CGFloat = 60

  let surfaceView: GhosttySurfaceView
  @Bindable var state: GhosttySurfaceState

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var searchText: String
  @State private var corner: GhosttySearchCorner = .topRight
  @State private var dragOffset: CGSize = .zero
  @State private var barSize: CGSize = .zero
  @State private var searchFocusRequest = 0
  @State private var searchTask: Task<Void, Never>?

  private let overlayPadding: CGFloat = 8

  init(surfaceView: GhosttySurfaceView) {
    self.surfaceView = surfaceView
    self._state = Bindable(surfaceView.bridge.state)
    self._searchText = State(initialValue: surfaceView.bridge.state.searchNeedle ?? "")
  }

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: corner.alignment) {
        HStack(spacing: 4) {
          GhosttySearchField(
            text: $searchText,
            focusRequest: searchFocusRequest,
            onSubmit: { isShifted in
              navigateSearch(isShifted ? .previous : .next)
            },
            onEscape: {
              closeSearch()
            }
          )
          .frame(width: 180)
          .padding(.leading, 8)
          .padding(.trailing, 50)
          .padding(.vertical, 6)
          .background(Color.primary.opacity(0.1))
          .clipShape(.rect(cornerRadius: 6))
          .overlay(alignment: .trailing) {
            matchLabel
          }

          Button {
            navigateSearch(.next)
          } label: {
            SearchButtonLabel(
              title: "Next",
              shortcut: "Cmd-G",
              systemImage: "chevron.up"
            )
          }
          .accessibilityIdentifier("terminal.search.next")
          .buttonStyle(GhosttySearchButtonStyle())

          Button {
            navigateSearch(.previous)
          } label: {
            SearchButtonLabel(
              title: "Previous",
              shortcut: "Shift-Cmd-G",
              systemImage: "chevron.down"
            )
          }
          .accessibilityIdentifier("terminal.search.previous")
          .buttonStyle(GhosttySearchButtonStyle())

          Button {
            closeSearch()
          } label: {
            SearchButtonLabel(
              title: "Close",
              shortcut: "Esc",
              systemImage: "xmark"
            )
          }
          .accessibilityIdentifier("terminal.search.close")
          .buttonStyle(GhosttySearchButtonStyle())
        }
        .padding(8)
        .background(.background)
        .clipShape(GhosttySearchOverlayShape())
        .shadow(radius: 4)
        .background(
          GeometryReader { barGeo in
            Color.clear.onAppear {
              barSize = barGeo.size
            }
          }
        )
        .padding(overlayPadding)
        .offset(dragOffset)
        .contentShape(.rect)
        .gesture(
          DragGesture()
            .onChanged { value in
              dragOffset = value.translation
            }
            .onEnded { value in
              let centerPos = centerPosition(for: corner, in: geo.size, barSize: barSize)
              let newCenter = CGPoint(
                x: centerPos.x + value.translation.width,
                y: centerPos.y + value.translation.height
              )
              let newCorner = closestCorner(to: newCenter, in: geo.size)
              TerminalMotion.animate(.easeOut(duration: 0.2), reduceMotion: reduceMotion) {
                corner = newCorner
                dragOffset = .zero
              }
            }
        )
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: corner.alignment)
      .onAppear {
        focusSearchFieldIfNeeded()
        scheduleSearch(searchText)
      }
      .onChange(of: searchText) { _, newValue in
        scheduleSearch(newValue)
      }
      .onChange(of: state.searchNeedle) { _, newValue in
        guard let newValue else { return }
        if !newValue.isEmpty, newValue != searchText {
          searchText = newValue
        }
      }
      .onChange(of: state.searchFocusCount) { _, _ in
        focusSearchFieldIfNeeded()
      }
      .onDisappear {
        searchTask?.cancel()
        searchTask = nil
      }
    }
  }

  @ViewBuilder
  private var matchLabel: some View {
    if let matchLabelText {
      GhosttySearchMatchLabel(text: matchLabelText)
        .padding(.trailing, 8)
    }
  }

  private var matchLabelText: String? {
    if let selected = state.searchSelected {
      let total = state.searchTotal.map(String.init) ?? "?"
      return "\(selected + 1)/\(total)"
    }
    return state.searchTotal.map { "-/\($0)" }
  }

  private func scheduleSearch(_ needle: String) {
    searchTask?.cancel()
    if needle.isEmpty || needle.count >= 3 {
      emitSearch(needle)
      return
    }

    let text = needle
    searchTask = Task { @MainActor in
      do {
        try await ContinuousClock().sleep(for: .milliseconds(300))
      } catch {
        return
      }
      guard !Task.isCancelled else { return }
      emitSearch(text)
    }
  }

  private func emitSearch(_ needle: String) {
    state.searchNeedle = needle
    surfaceView.performBindingAction("search:\(needle)")
  }

  private func navigateSearch(_ direction: GhosttySearchDirection) {
    flushPendingSearch()
    surfaceView.navigateSearch(direction)
  }

  private func closeSearch() {
    surfaceView.performBindingAction("end_search")
    surfaceView.requestFocus()
  }

  private func flushPendingSearch() {
    guard let searchTask else { return }
    searchTask.cancel()
    self.searchTask = nil
    emitSearch(searchText)
  }

  private func focusSearchFieldIfNeeded() {
    guard surfaceView.consumeSearchFocusRequest(state.searchFocusCount) else { return }
    Task { @MainActor in
      await Task.yield()
      searchFocusRequest += 1
    }
  }

  private func centerPosition(
    for corner: GhosttySearchCorner,
    in containerSize: CGSize,
    barSize: CGSize
  ) -> CGPoint {
    let halfWidth = barSize.width / 2 + overlayPadding
    let halfHeight = barSize.height / 2 + overlayPadding

    switch corner {
    case .topLeft:
      return CGPoint(x: halfWidth, y: halfHeight)
    case .topRight:
      return CGPoint(x: containerSize.width - halfWidth, y: halfHeight)
    case .bottomLeft:
      return CGPoint(x: halfWidth, y: containerSize.height - halfHeight)
    case .bottomRight:
      return CGPoint(x: containerSize.width - halfWidth, y: containerSize.height - halfHeight)
    }
  }

  private func closestCorner(to point: CGPoint, in containerSize: CGSize) -> GhosttySearchCorner {
    let midX = containerSize.width / 2
    let midY = containerSize.height / 2

    if point.x < midX {
      return point.y < midY ? .topLeft : .bottomLeft
    }
    return point.y < midY ? .topRight : .bottomRight
  }
}

private enum GhosttySearchCorner {
  case topLeft
  case topRight
  case bottomLeft
  case bottomRight

  var alignment: Alignment {
    switch self {
    case .topLeft: return .topLeading
    case .topRight: return .topTrailing
    case .bottomLeft: return .bottomLeading
    case .bottomRight: return .bottomTrailing
    }
  }
}

private struct GhosttySearchOverlayShape: Shape {
  func path(in rect: CGRect) -> Path {
    if #available(macOS 26.0, *) {
      return ConcentricRectangle(corners: .concentric(minimum: 8), isUniform: true).path(in: rect)
    }
    return RoundedRectangle(cornerRadius: 8).path(in: rect)
  }
}

private struct SearchButtonLabel: View {
  let title: String
  let shortcut: String?
  let systemImage: String

  var body: some View {
    Label {
      if let shortcut {
        Text("\(title) \(Text("(\(shortcut))").foregroundColor(.secondary.opacity(0.7)))")
      } else {
        Text(title)
      }
    } icon: {
      Image(systemName: systemImage)
        .accessibilityHidden(true)
    }
  }
}

private struct GhosttySearchMatchLabel: NSViewRepresentable {
  let text: String

  func makeNSView(context _: Context) -> NSTextField {
    let label = NSTextField(labelWithString: text)
    label.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
    label.textColor = .secondaryLabelColor
    label.cell?.setAccessibilityIdentifier("terminal.search.match-count")
    return label
  }

  func updateNSView(_ label: NSTextField, context _: Context) {
    label.stringValue = text
  }
}

private struct GhosttySearchField: NSViewRepresentable {
  @Binding var text: String
  var focusRequest: Int
  var onSubmit: (Bool) -> Void
  var onEscape: () -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(text: $text)
  }

  func makeNSView(context: Context) -> SearchField {
    let field = SearchField()
    field.setAccessibilityIdentifier("terminal.search.field")
    field.delegate = context.coordinator
    field.onSubmit = onSubmit
    field.onEscape = onEscape
    field.isBordered = false
    field.drawsBackground = false
    field.focusRingType = .none
    field.placeholderString = "Search"
    field.usesSingleLineMode = true
    field.lineBreakMode = .byTruncatingTail
    field.font = .systemFont(ofSize: NSFont.systemFontSize, weight: .regular)
    return field
  }

  func updateNSView(_ nsView: SearchField, context: Context) {
    if nsView.stringValue != text {
      nsView.stringValue = text
    }
    nsView.onSubmit = onSubmit
    nsView.onEscape = onEscape

    if context.coordinator.focusRequest != focusRequest, let window = nsView.window {
      context.coordinator.focusRequest = focusRequest
      window.makeFirstResponder(nsView)
    }
  }

  final class Coordinator: NSObject, NSTextFieldDelegate {
    @Binding var text: String
    var focusRequest = 0

    init(text: Binding<String>) {
      _text = text
    }

    func controlTextDidChange(_ obj: Notification) {
      guard let field = obj.object as? NSTextField else { return }
      text = field.stringValue
    }
  }

  final class SearchField: NSTextField {
    var onSubmit: ((Bool) -> Void)?
    var onEscape: (() -> Void)?

    override func cancelOperation(_ sender: Any?) {
      onEscape?()
    }

    override func keyDown(with event: NSEvent) {
      switch event.keyCode {
      case 36, 76:
        onSubmit?(event.modifierFlags.contains(.shift))
      case 53:
        onEscape?()
      default:
        super.keyDown(with: event)
      }
    }
  }
}

private struct GhosttySearchButtonStyle: ButtonStyle {
  @State private var isHovered = false

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(isHovered || configuration.isPressed ? .primary : .secondary)
      .padding(.horizontal, 2)
      .frame(height: 26)
      .background(
        RoundedRectangle(cornerRadius: 6)
          .fill(backgroundColor(isPressed: configuration.isPressed))
      )
      .onHover { hovering in
        if hovering != isHovered {
          isHovered = hovering
          if hovering {
            NSCursor.pointingHand.push()
          } else {
            NSCursor.pop()
          }
        }
      }
      .onDisappear {
        if isHovered {
          isHovered = false
          NSCursor.pop()
        }
      }
  }

  private func backgroundColor(isPressed: Bool) -> Color {
    if isPressed {
      return Color.primary.opacity(0.2)
    }
    if isHovered {
      return Color.primary.opacity(0.1)
    }
    return Color.clear
  }
}
