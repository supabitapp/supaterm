import SwiftUI

struct GhosttySurfaceSearchOverlay: View {
  let surfaceView: GhosttySurfaceView
  @ObservedObject var searchState: GhosttySurfaceSearchState

  @State private var corner: GhosttySearchCorner = .topRight
  @State private var dragOffset: CGSize = .zero
  @State private var barSize: CGSize = .zero
  @FocusState private var isSearchFieldFocused: Bool

  private let padding: CGFloat = 8

  var body: some View {
    GeometryReader { geo in
      HStack(spacing: 4) {
        TextField("Search", text: $searchState.needle)
          .textFieldStyle(.plain)
          .frame(width: 180)
          .padding(.leading, 8)
          .padding(.trailing, 50)
          .padding(.vertical, 6)
          .background(Color.primary.opacity(0.1))
          .cornerRadius(6)
          .focused($isSearchFieldFocused)
          .overlay(alignment: .trailing) {
            matchLabel
          }
          .onExitCommand {
            if searchState.needle.isEmpty {
              surfaceView.bridge.closeSearch()
            } else {
              surfaceView.requestFocus()
            }
          }
          .onKeyPress(.return, phases: .down) { keyPress in
            surfaceView.navigateSearch(
              keyPress.modifiers.contains(.shift) ? .previous : .next
            )
            return .handled
          }

        Button(
          action: { surfaceView.navigateSearch(.next) },
          label: {
            Image(systemName: "chevron.up")
              .accessibilityLabel("Next Search Result")
          }
        )
        .buttonStyle(GhosttySearchButtonStyle())

        Button(
          action: { surfaceView.navigateSearch(.previous) },
          label: {
            Image(systemName: "chevron.down")
              .accessibilityLabel("Previous Search Result")
          }
        )
        .buttonStyle(GhosttySearchButtonStyle())

        Button(
          action: { surfaceView.bridge.closeSearch() },
          label: {
            Image(systemName: "xmark")
              .accessibilityLabel("Close Search")
          }
        )
        .buttonStyle(GhosttySearchButtonStyle())
      }
      .padding(8)
      .background(.background)
      .clipShape(clipShape)
      .shadow(radius: 4)
      .onAppear {
        isSearchFieldFocused = true
      }
      .onReceive(NotificationCenter.default.publisher(for: .ghosttySearchFocus)) { notification in
        guard notification.object as? GhosttySurfaceView === surfaceView else { return }
        DispatchQueue.main.async {
          isSearchFieldFocused = true
        }
      }
      .background(
        GeometryReader { barGeo in
          Color.clear.onAppear {
            barSize = barGeo.size
          }
        }
      )
      .padding(padding)
      .offset(dragOffset)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: corner.alignment)
      .gesture(
        DragGesture()
          .onChanged { value in
            dragOffset = value.translation
          }
          .onEnded { value in
            let centerPosition = centerPosition(
              for: corner,
              in: geo.size,
              barSize: barSize
            )
            let newCenter = CGPoint(
              x: centerPosition.x + value.translation.width,
              y: centerPosition.y + value.translation.height
            )
            let newCorner = closestCorner(to: newCenter, in: geo.size)
            withAnimation(.easeOut(duration: 0.2)) {
              corner = newCorner
              dragOffset = .zero
            }
          }
      )
    }
  }

  @ViewBuilder
  private var matchLabel: some View {
    if let selected = searchState.selected {
      Text("\(selected + 1)/\(searchState.total.map(String.init) ?? "?")")
        .font(.caption)
        .foregroundColor(.secondary)
        .monospacedDigit()
        .padding(.trailing, 8)
    } else if let total = searchState.total {
      Text("-/\(total)")
        .font(.caption)
        .foregroundColor(.secondary)
        .monospacedDigit()
        .padding(.trailing, 8)
    }
  }

  private var clipShape: some Shape {
    if #available(macOS 26.0, *) {
      return ConcentricRectangle(corners: .concentric(minimum: 8), isUniform: true)
    }
    return RoundedRectangle(cornerRadius: 8)
  }

  private func centerPosition(
    for corner: GhosttySearchCorner,
    in containerSize: CGSize,
    barSize: CGSize
  ) -> CGPoint {
    let halfWidth = barSize.width / 2 + padding
    let halfHeight = barSize.height / 2 + padding

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
    case .topLeft:
      return .topLeading
    case .topRight:
      return .topTrailing
    case .bottomLeft:
      return .bottomLeading
    case .bottomRight:
      return .bottomTrailing
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
        isHovered = hovering
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
