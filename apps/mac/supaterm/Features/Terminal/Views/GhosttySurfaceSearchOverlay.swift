import AppKit
import SupatermUI
import SwiftUI

struct GhosttySurfaceSearchOverlay: View {
  static let topReservedHeight: CGFloat = 60

  let surfaceView: GhosttySurfaceView
  @Bindable var state: GhosttySurfaceState

  private let deferFocusRequest: @MainActor () async -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var searchText: String
  @State private var corner: GhosttySearchCorner = .topRight
  @State private var dragOffset: CGSize = .zero
  @State private var barSize: CGSize = .zero
  @State private var searchFocusRequest = 0
  @State private var searchSelectionRequest = 0
  @State private var searchTask: Task<Void, Never>?

  private let overlayPadding: CGFloat = 8

  init(
    surfaceView: GhosttySurfaceView,
    deferFocusRequest: @escaping @MainActor () async -> Void = {
      await Task.yield()
    }
  ) {
    self.surfaceView = surfaceView
    self.deferFocusRequest = deferFocusRequest
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
            selectionRequest: searchSelectionRequest,
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
        updateSearchNeedleOnAppear()
        updateSearchFieldOnAppear()
      }
      .onChange(of: searchText) { _, newValue in
        searchNeedleDidChange(newValue)
      }
      .onChange(of: state.searchNeedle) { _, newValue in
        guard let newValue else { return }
        if newValue != searchText {
          searchText = newValue
        }
      }
      .onChange(of: state.searchFocusCount) { _, _ in
        focusSearchFieldIfNeeded()
      }
      .onChange(of: state.searchSelectionRequestCount) { _, _ in
        selectSearchNeedleIfNeeded()
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
      Text(matchLabelText)
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityIdentifier("terminal.search.match-count")
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
      performSearch(needle)
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
      performSearch(text)
    }
  }

  private func performSearch(_ needle: String) {
    surfaceView.performBindingAction("search:\(needle)")
  }

  private func searchNeedleDidChange(_ needle: String) {
    surfaceView.bridge.setSearchNeedle(needle)
    scheduleSearch(needle)
  }

  private func navigateSearch(_ direction: GhosttySearchDirection) {
    flushPendingSearch()
    surfaceView.navigateSearch(direction)
  }

  private func closeSearch() {
    surfaceView.performBindingAction("end_search")
  }

  private func flushPendingSearch() {
    guard let searchTask else { return }
    searchTask.cancel()
    self.searchTask = nil
    surfaceView.bridge.setSearchNeedle(searchText)
    performSearch(searchText)
  }

  private func updateSearchNeedleOnAppear() {
    let needle = state.searchNeedle ?? searchText
    if needle == searchText {
      scheduleSearch(needle)
    } else {
      searchText = needle
    }
  }

  private func focusSearchFieldIfNeeded() {
    guard surfaceView.consumeSearchFocusRequest(state.searchFocusCount) else { return }
    deferSearchFieldFocus(selectingNeedle: false)
  }

  private func selectSearchNeedleIfNeeded() {
    guard
      surfaceView.consumeSearchSelectionRequest(state.searchSelectionRequestCount)
    else { return }
    searchSelectionRequest += 1
  }

  private func updateSearchFieldOnAppear() {
    let shouldFocus = surfaceView.consumeSearchFocusRequest(state.searchFocusCount)
    let shouldSelect = surfaceView.consumeSearchSelectionRequest(
      state.searchSelectionRequestCount
    )
    if shouldFocus {
      deferSearchFieldFocus(selectingNeedle: shouldSelect)
      return
    }
    if shouldSelect {
      searchSelectionRequest += 1
    }
  }

  private func deferSearchFieldFocus(selectingNeedle: Bool) {
    Task { @MainActor in
      await deferFocusRequest()
      searchFocusRequest += 1
      if selectingNeedle {
        searchSelectionRequest += 1
      }
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
        HStack(spacing: 6) {
          Text(title)
          KeyboardShortcutPill(shortcut)
        }
      } else {
        Text(title)
      }
    } icon: {
      Image(systemName: systemImage)
        .accessibilityHidden(true)
    }
  }
}

struct GhosttySearchField: NSViewRepresentable {
  @Binding var text: String
  var focusRequest: Int
  var selectionRequest: Int
  var onSubmit: (Bool) -> Void
  var onEscape: () -> Void

  func makeCoordinator() -> GhosttySearchFieldDelegate {
    GhosttySearchFieldDelegate(text: $text, onSubmit: onSubmit, onEscape: onEscape)
  }

  func makeNSView(context: Context) -> NSTextField {
    let field = NSTextField()
    field.setAccessibilityIdentifier("terminal.search.field")
    field.delegate = context.coordinator
    field.isBordered = false
    field.drawsBackground = false
    field.focusRingType = .none
    field.placeholderString = "Search"
    field.usesSingleLineMode = true
    field.lineBreakMode = .byTruncatingTail
    field.font = .systemFont(ofSize: NSFont.systemFontSize, weight: .regular)
    return field
  }

  func updateNSView(_ nsView: NSTextField, context: Context) {
    if nsView.stringValue != text {
      nsView.stringValue = text
    }
    context.coordinator.onSubmit = onSubmit
    context.coordinator.onEscape = onEscape

    if context.coordinator.focusRequest != focusRequest, let window = nsView.window {
      context.coordinator.focusRequest = focusRequest
      window.makeFirstResponder(nsView)
    }

    guard context.coordinator.selectionRequest != selectionRequest else { return }
    context.coordinator.selectionRequest = selectionRequest
    if let editor = nsView.currentEditor() {
      editor.selectedRange = NSRange(location: 0, length: nsView.stringValue.utf16.count)
    }
  }
}

final class GhosttySearchFieldDelegate: NSObject, NSTextFieldDelegate {
  @Binding var text: String
  var onSubmit: (Bool) -> Void
  var onEscape: () -> Void
  var focusRequest = 0
  var selectionRequest = 0
  private let modifierFlags: () -> NSEvent.ModifierFlags

  init(
    text: Binding<String>,
    onSubmit: @escaping (Bool) -> Void,
    onEscape: @escaping () -> Void,
    modifierFlags: @escaping () -> NSEvent.ModifierFlags = {
      NSApp.currentEvent?.modifierFlags ?? []
    }
  ) {
    _text = text
    self.onSubmit = onSubmit
    self.onEscape = onEscape
    self.modifierFlags = modifierFlags
  }

  func controlTextDidChange(_ obj: Notification) {
    guard let field = obj.object as? NSTextField else { return }
    text = field.stringValue
  }

  func control(
    _ control: NSControl,
    textView: NSTextView,
    doCommandBy commandSelector: Selector
  ) -> Bool {
    switch commandSelector {
    case #selector(NSResponder.insertNewline(_:)):
      let isShifted = modifierFlags().contains(.shift)
      guard !textView.hasMarkedText() || isShifted else { return false }
      onSubmit(isShifted)
      return true
    case #selector(NSResponder.cancelOperation(_:)):
      onEscape()
      return true
    default:
      return false
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
