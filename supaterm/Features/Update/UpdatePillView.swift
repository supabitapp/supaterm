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
  @State private var rotationAngle = 0.0

  private let compactPillDiameter: CGFloat = 22
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
      }
    }
  }

  private func label(for pill: UpdatePillContent) -> some View {
    if pill.badge == nil && pill.text.isEmpty {
      Circle()
        .fill(backgroundColor(for: pill.tone))
        .frame(width: compactPillDiameter, height: compactPillDiameter)
        .contentShape(Circle())
    } else {
      HStack(spacing: 6) {
        badgeView(for: pill.badge)
          .frame(width: 14, height: 14)

        Text(pill.text)
          .font(Font(textFont))
          .lineLimit(1)
          .truncationMode(.tail)
          .frame(width: textWidth(for: pill))
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
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
}
