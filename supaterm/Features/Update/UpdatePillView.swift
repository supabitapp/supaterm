import AppKit
import ComposableArchitecture
import SwiftUI

struct UpdatePillView: View {
  let store: StoreOf<UpdateFeature>

  private let badgeSize: CGFloat = 14
  private let compactPillDiameter: CGFloat = 14
  private let compactBadgeSize: CGFloat = 9
  private let pillHorizontalPadding: CGFloat = 8
  private let pillVerticalPadding: CGFloat = 4
  private let pillTransitionAnimation = Animation.spring(response: 0.34, dampingFraction: 0.8)
  private let textFont = NSFont.systemFont(ofSize: 11, weight: .medium)

  var body: some View {
    if let pill = store.pillContent {
      Button {
        guard pill.allowsPopover else { return }
        store.send(.pillButtonTapped)
      } label: {
        morphingLabel(for: pill)
      }
      .buttonStyle(.plain)
      .popover(isPresented: popoverBinding, arrowEdge: .bottom) {
        UpdatePopoverView(store: store)
      }
      .help(pill.helpText)
      .accessibilityLabel(pill.helpText)
      .animation(pillTransitionAnimation, value: pill.style)
      .animation(pillTransitionAnimation, value: pill.text)
      .animation(pillTransitionAnimation, value: pill.tone)
      .onHover { isHovering in
        withAnimation(.spring(response: 0.22, dampingFraction: 0.88)) {
          _ = store.send(.developmentBuildHoverChanged(isHovering))
        }
      }
    }
  }

  private func morphingLabel(for pill: UpdatePillContent) -> some View {
    ZStack {
      Capsule()
        .fill(backgroundColor(for: pill.tone))

      HStack(spacing: spacing(for: pill)) {
        if let badge = pill.badge {
          UpdateBadgeView(badge: badge, size: badgeSize(for: pill))
            .frame(width: badgeSize(for: pill), height: badgeSize(for: pill))
        }

        Text(pill.text)
          .font(Font(textFont))
          .lineLimit(1)
          .truncationMode(.tail)
          .frame(width: textSlotWidth(for: pill), alignment: .leading)
          .opacity(pill.style == .capsule ? 1 : 0)
          .blur(radius: pill.style == .capsule ? 0 : 4)
          .offset(x: pill.style == .capsule ? 0 : -6)
      }
      .padding(.horizontal, horizontalPadding(for: pill))
      .padding(.vertical, verticalPadding(for: pill))
    }
    .frame(width: pillWidth(for: pill), height: pillHeight(for: pill))
    .fixedSize()
    .foregroundStyle(.white)
    .contentShape(Capsule())
    .clipShape(Capsule())
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

  private func badgeSize(for pill: UpdatePillContent) -> CGFloat {
    switch pill.style {
    case .capsule:
      badgeSize
    case .circle:
      compactBadgeSize
    }
  }

  private func horizontalPadding(for pill: UpdatePillContent) -> CGFloat {
    switch pill.style {
    case .capsule:
      return pillHorizontalPadding
    case .circle:
      guard pill.badge != nil else { return 0 }
      return max(0, (compactPillDiameter - badgeSize(for: pill)) / 2)
    }
  }

  private func pillHeight(for pill: UpdatePillContent) -> CGFloat {
    switch pill.style {
    case .capsule:
      let attributes: [NSAttributedString.Key: Any] = [.font: textFont]
      let textHeight = (pill.maxText as NSString).size(withAttributes: attributes).height
      let contentHeight = max(textHeight, pill.badge == nil ? 0 : badgeSize(for: pill))
      return ceil(contentHeight + (pillVerticalPadding * 2))
    case .circle:
      return compactPillDiameter
    }
  }

  private func pillWidth(for pill: UpdatePillContent) -> CGFloat {
    switch pill.style {
    case .capsule:
      let badgeWidth = pill.badge == nil ? 0 : badgeSize(for: pill)
      let spacing = spacing(for: pill)
      let textWidth = textSlotWidth(for: pill)
      return badgeWidth + spacing + textWidth + (horizontalPadding(for: pill) * 2)
    case .circle:
      return compactPillDiameter
    }
  }

  private func spacing(for pill: UpdatePillContent) -> CGFloat {
    guard pill.style == .capsule, pill.badge != nil, !pill.text.isEmpty else { return 0 }
    return 6
  }

  private func textSlotWidth(for pill: UpdatePillContent) -> CGFloat {
    guard pill.style == .capsule else { return 0 }
    return textWidth(for: pill) ?? 0
  }

  private func verticalPadding(for pill: UpdatePillContent) -> CGFloat {
    switch pill.style {
    case .capsule:
      return pillVerticalPadding
    case .circle:
      guard pill.badge != nil else { return 0 }
      return max(0, (compactPillDiameter - badgeSize(for: pill)) / 2)
    }
  }
}

private struct UpdateBadgeView: View {
  let badge: UpdateBadge
  let size: CGFloat

  var body: some View {
    switch badge {
    case .icon(let name, let spins):
      if spins {
        RotatingIconBadgeView(name: name, size: size)
      } else {
        StaticIconBadgeView(name: name, size: size)
      }
    case .progress(let progress):
      ProgressBadgeView(progress: progress, size: size)
    }
  }
}

private struct StaticIconBadgeView: View {
  let name: String
  let size: CGFloat

  var body: some View {
    Image(systemName: name)
      .font(.system(size: size, weight: .semibold))
      .accessibilityHidden(true)
      .contentTransition(.symbolEffect(.replace))
  }
}

private struct RotatingIconBadgeView: View {
  let name: String
  let size: CGFloat

  @State private var rotationAngle = 0.0

  private let rotationDuration = 1.6

  var body: some View {
    Image(systemName: name)
      .font(.system(size: size, weight: .semibold))
      .accessibilityHidden(true)
      .contentTransition(.symbolEffect(.replace))
      .rotationEffect(.degrees(rotationAngle))
      .onAppear {
        rotationAngle = 0
        withAnimation(.linear(duration: rotationDuration).repeatForever(autoreverses: false)) {
          rotationAngle = 360
        }
      }
  }
}

private struct ProgressBadgeView: View {
  let progress: Double
  let size: CGFloat

  private var lineWidth: CGFloat {
    max(1.5, size / 7)
  }

  var body: some View {
    ZStack {
      Circle()
        .stroke(.white.opacity(0.25), lineWidth: lineWidth)

      Circle()
        .trim(from: 0, to: progress)
        .stroke(
          .white,
          style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
        )
        .rotationEffect(.degrees(-90))
    }
    .accessibilityHidden(true)
    .animation(.linear(duration: 0.18), value: progress)
  }
}
