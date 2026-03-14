import AppKit
import ComposableArchitecture
import SwiftUI

struct UpdatePillContent: Equatable {
  let allowsPopover: Bool
  let badge: UpdateBadge?
  let helpText: String
  let maxText: String
  let text: String
  let tone: UpdatePillTone

  init?(phase: UpdatePhase, isDevelopmentBuild: Bool) {
    if phase.isIdle {
      guard isDevelopmentBuild else { return nil }
      self = .developmentBuild
      return
    }

    self.init(
      allowsPopover: phase.allowsPopover,
      badge: phase.badge,
      helpText: phase.text,
      maxText: phase.maxText,
      text: phase.text,
      tone: phase.pillTone,
    )
  }

  private init(
    allowsPopover: Bool,
    badge: UpdateBadge?,
    helpText: String,
    maxText: String,
    text: String,
    tone: UpdatePillTone
  ) {
    self.allowsPopover = allowsPopover
    self.badge = badge
    self.helpText = helpText
    self.maxText = maxText
    self.text = text
    self.tone = tone
  }

  private static let developmentBuild = Self(
    allowsPopover: false,
    badge: nil,
    helpText: AppBuild.developmentBuildMessage,
    maxText: "",
    text: "",
    tone: .accent,
  )
}

struct UpdatePillView: View {
  let store: StoreOf<UpdateFeature>
  @State private var isDevelopmentIndicatorHovering = false
  @State private var rotationAngle = 0.0

  private let badgeSize: CGFloat = 14
  private let compactPillDiameter: CGFloat = 14
  private let pillHorizontalPadding: CGFloat = 8
  private let pillVerticalPadding: CGFloat = 4
  private let textFont = NSFont.systemFont(ofSize: 11, weight: .medium)

  var body: some View {
    if let pill = UpdatePillContent(phase: store.phase, isDevelopmentBuild: AppBuild.isDevelopmentBuild) {
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
            guard isCompactDevelopmentIndicator(pill) else { return }
            withAnimation(.spring(response: 0.22, dampingFraction: 0.88)) {
              isDevelopmentIndicatorHovering = isHovering
            }
          }
      }
    }
  }

  @ViewBuilder
  private func label(for pill: UpdatePillContent) -> some View {
    if isCompactDevelopmentIndicator(pill) {
      HStack(spacing: 0) {
        Text(AppBuild.developmentBuildMessage)
          .font(Font(textFont))
          .lineLimit(1)
          .fixedSize()
          .opacity(isDevelopmentIndicatorHovering ? 1 : 0)
          .frame(width: isDevelopmentIndicatorHovering ? developmentBuildTextWidth : 0, alignment: .leading)
      }
      .padding(.horizontal, isDevelopmentIndicatorHovering ? pillHorizontalPadding : 0)
      .padding(.vertical, isDevelopmentIndicatorHovering ? pillVerticalPadding : 0)
      .frame(
        width: isDevelopmentIndicatorHovering ? developmentBuildExpandedWidth : compactPillDiameter,
        height: isDevelopmentIndicatorHovering ? expandedPillHeight : compactPillDiameter
      )
      .background(Capsule().fill(backgroundColor(for: pill.tone)))
      .foregroundStyle(.white)
      .contentShape(Capsule())
    } else {
      HStack(spacing: 6) {
        badgeView(for: pill.badge)
          .frame(width: badgeSize, height: badgeSize)

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
    }
  }

  @ViewBuilder
  private func badgeView(for badge: UpdateBadge?) -> some View {
    switch badge {
    case .icon(let name, let spins):
      Image(systemName: name)
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
          .stroke(.white.opacity(0.25), lineWidth: 2)

        Circle()
          .trim(from: 0, to: progress)
          .stroke(.white, style: StrokeStyle(lineWidth: 2, lineCap: .round))
          .rotationEffect(.degrees(-90))
      }
      .accessibilityHidden(true)

    case nil:
      EmptyView()
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

  private func isCompactDevelopmentIndicator(_ pill: UpdatePillContent) -> Bool {
    pill.badge == nil && pill.text.isEmpty
  }

  private var developmentBuildExpandedWidth: CGFloat {
    developmentBuildTextWidth + (pillHorizontalPadding * 2)
  }

  private var expandedPillHeight: CGFloat {
    badgeSize + (pillVerticalPadding * 2)
  }

  private var developmentBuildTextWidth: CGFloat {
    let attributes: [NSAttributedString.Key: Any] = [.font: textFont]
    let size = (AppBuild.developmentBuildMessage as NSString).size(withAttributes: attributes)
    return size.width
  }
}
