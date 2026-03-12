import AppKit
import ComposableArchitecture
import SwiftUI

struct UpdatePillView: View {
  let store: StoreOf<UpdateFeature>
  @State private var rotationAngle = 0.0

  private let textFont = NSFont.systemFont(ofSize: 11, weight: .medium)

  var body: some View {
    if !store.phase.isIdle {
      Button {
        store.send(.pillButtonTapped)
      } label: {
        HStack(spacing: 6) {
          badgeView
            .frame(width: 14, height: 14)

          Text(store.phase.text)
            .font(Font(textFont))
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(width: textWidth)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Capsule().fill(backgroundColor))
        .foregroundStyle(.white)
        .contentShape(Capsule())
      }
      .buttonStyle(.plain)
      .help(store.phase.text)
      .accessibilityLabel(store.phase.text)
      .popover(isPresented: popoverBinding, arrowEdge: .bottom) {
        UpdatePopoverView(store: store)
      }
    }
  }

  @ViewBuilder
  private var badgeView: some View {
    switch store.phase.badge {
    case .icon(let name, let spins):
      Image(systemName: name)
        .rotationEffect(.degrees(rotationAngle))
        .onAppear {
          guard spins else { return }
          withAnimation(.linear(duration: 2.5).repeatForever(autoreverses: false)) {
            rotationAngle = 360
          }
        }
        .onDisappear {
          rotationAngle = 0
        }

    case .progress(let progress):
      ZStack {
        Circle()
          .stroke(.white.opacity(0.25), lineWidth: 2)

        Circle()
          .trim(from: 0, to: progress)
          .stroke(.white, style: StrokeStyle(lineWidth: 2, lineCap: .round))
          .rotationEffect(.degrees(-90))
      }

    case nil:
      EmptyView()
    }
  }

  private var backgroundColor: Color {
    switch store.phase.pillTone {
    case .accent:
      Color(red: 0.16, green: 0.47, blue: 0.93)
    case .warning:
      Color(red: 0.87, green: 0.46, blue: 0.16)
    }
  }

  private var popoverBinding: Binding<Bool> {
    Binding(
      get: { store.isPopoverPresented },
      set: { store.send(.popoverPresentedChanged($0)) }
    )
  }

  private var textWidth: CGFloat? {
    let attributes: [NSAttributedString.Key: Any] = [.font: textFont]
    let size = (store.phase.maxText as NSString).size(withAttributes: attributes)
    return size.width
  }
}
