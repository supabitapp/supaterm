import AppKit
import ComposableArchitecture
import SwiftUI

struct UpdatePillView: View {
  let store: StoreOf<UpdateFeature>
  @State private var rotationAngle = 0.0

  private let badgeSize: CGFloat = 14
  private let compactPillDiameter: CGFloat = 14
  private let compactBadgeSize: CGFloat = 9
  private let pillHorizontalPadding: CGFloat = 8
  private let pillVerticalPadding: CGFloat = 4
  private let textFont = NSFont.systemFont(ofSize: 11, weight: .medium)

  var body: some View {
    if let pill = store.pillContent {
      if pill.allowsPopover {
        Button {
          store.send(.pillButtonTapped)
        } label: {
          label(for: pill)
        }
        .buttonStyle(.plain)
        .help(pill.helpText)
        .accessibilityLabel(pill.helpText)
        .popover(isPresented: popoverBinding, arrowEdge: .bottom) {
          UpdatePopoverView(store: store)
        }
      } else {
        label(for: pill)
          .help(pill.helpText)
          .accessibilityLabel(pill.helpText)
          .onHover { isHovering in
            withAnimation(.spring(response: 0.22, dampingFraction: 0.88)) {
              _ = store.send(.developmentBuildHoverChanged(isHovering))
            }
          }
      }
    }
  }

  @ViewBuilder
  private func label(for pill: UpdatePillContent) -> some View {
    switch pill.style {
    case .capsule:
      HStack(spacing: 6) {
        if let badge = pill.badge {
          badgeView(for: badge, size: badgeSize)
            .frame(width: badgeSize, height: badgeSize)
        }

        Text(pill.text)
          .font(Font(textFont))
          .lineLimit(1)
          .truncationMode(.tail)
          .frame(width: textWidth(for: pill))
      }
      .padding(.horizontal, pillHorizontalPadding)
      .padding(.vertical, pillVerticalPadding)
      .background(Capsule().fill(backgroundColor(for: pill.tone)))
      .foregroundStyle(.white)
      .contentShape(Capsule())

    case .circle:
      ZStack {
        Circle()
          .fill(backgroundColor(for: pill.tone))

        if let badge = pill.badge {
          badgeView(for: badge, size: compactBadgeSize)
            .frame(width: compactBadgeSize, height: compactBadgeSize)
        }
      }
      .frame(width: compactPillDiameter, height: compactPillDiameter)
      .foregroundStyle(.white)
      .contentShape(Circle())
    }
  }

  @ViewBuilder
  private func badgeView(for badge: UpdateBadge, size: CGFloat) -> some View {
    switch badge {
    case .icon(let name, let spins):
      Image(systemName: name)
        .font(.system(size: size, weight: .semibold))
        .accessibilityHidden(true)
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
          .stroke(.white.opacity(0.25), lineWidth: max(1.5, size / 7))

        Circle()
          .trim(from: 0, to: progress)
          .stroke(
            .white,
            style: StrokeStyle(lineWidth: max(1.5, size / 7), lineCap: .round)
          )
          .rotationEffect(.degrees(-90))
      }
      .accessibilityHidden(true)
    }
  }

  private func backgroundColor(for tone: UpdatePillTone) -> Color {
    switch tone {
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

  private func textWidth(for pill: UpdatePillContent) -> CGFloat? {
    let attributes: [NSAttributedString.Key: Any] = [.font: textFont]
    let size = (pill.maxText as NSString).size(withAttributes: attributes)
    return size.width
  }
}
