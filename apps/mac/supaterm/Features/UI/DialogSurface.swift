import AppKit
import SwiftUI

public enum DialogSurfaceIcon: Sendable {
  case application
  case system(String, tone: SurfaceTone = .neutral)
}

public enum DialogSurfaceActionRole: Sendable {
  case primary
  case secondary
  case destructive
}

public enum DialogSurfaceShortcut: Sendable {
  case `default`
  case cancel
  case key(KeyEquivalent, modifiers: EventModifiers, label: String)

  var label: String {
    switch self {
    case .default:
      "↩"
    case .cancel:
      "esc"
    case .key(_, _, let label):
      label
    }
  }
}

public struct DialogSurfaceAction: Identifiable {
  public let id: String
  public let title: String
  public let role: DialogSurfaceActionRole
  public let shortcut: DialogSurfaceShortcut?
  public let isEnabled: Bool
  public let accessibilityIdentifier: String?
  let action: () -> Void

  public init(
    id: String,
    title: String,
    role: DialogSurfaceActionRole,
    shortcut: DialogSurfaceShortcut? = nil,
    isEnabled: Bool = true,
    accessibilityIdentifier: String? = nil,
    action: @escaping () -> Void
  ) {
    self.id = id
    self.title = title
    self.role = role
    self.shortcut = shortcut
    self.isEnabled = isEnabled
    self.accessibilityIdentifier = accessibilityIdentifier
    self.action = action
  }
}

public struct DialogSurfaceLayout: Sendable {
  public var width: CGFloat
  public var maximumContentHeight: CGFloat?

  public init(width: CGFloat = 384, maximumContentHeight: CGFloat? = nil) {
    self.width = width
    self.maximumContentHeight = maximumContentHeight
  }
}

public struct DialogSurface<Content: View>: View {
  private let theme: SurfaceTheme
  private let title: String
  private let subtitle: String?
  private let message: String?
  private let warning: String?
  private let icon: DialogSurfaceIcon?
  private let layout: DialogSurfaceLayout
  private let actions: [DialogSurfaceAction]
  private let contentSpacing: CGFloat
  private let scrimLabel: String
  private let onDismiss: (() -> Void)?
  private let content: Content

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.colorScheme) private var colorScheme

  public init(
    theme: SurfaceTheme = .system,
    title: String,
    subtitle: String? = nil,
    message: String? = nil,
    warning: String? = nil,
    icon: DialogSurfaceIcon? = nil,
    layout: DialogSurfaceLayout = DialogSurfaceLayout(),
    actions: [DialogSurfaceAction] = [],
    contentSpacing: CGFloat = 18,
    scrimLabel: String = "Dismiss dialog",
    onDismiss: (() -> Void)? = nil,
    @ViewBuilder content: () -> Content
  ) {
    self.theme = theme
    self.title = title
    self.subtitle = subtitle
    self.message = message
    self.warning = warning
    self.icon = icon
    self.layout = layout
    self.actions = actions
    self.contentSpacing = contentSpacing
    self.scrimLabel = scrimLabel
    self.onDismiss = onDismiss
    self.content = content()
  }

  public var body: some View {
    let colors = theme.colors(for: colorScheme)

    ZStack {
      if let onDismiss {
        Button(action: onDismiss) {
          colors.scrim
            .ignoresSafeArea()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(scrimLabel)
      } else {
        colors.scrim
          .ignoresSafeArea()
          .accessibilityHidden(true)
      }

      SurfaceCard(
        theme: theme,
        style: SurfaceCardStyle(corners: SurfaceCorners(14), shadowRadius: 20, shadowY: 8)
      ) {
        dialogContent(colors: colors)
          .frame(width: layout.width)
      }
      .padding(3)
      .background(colors.selectedBackground, in: .rect(cornerRadius: 17))
      .transition(
        reduceMotion
          ? .opacity
          : .offset(y: -16).combined(with: .scale(scale: 0.96)).combined(with: .opacity)
      )
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("dialog.surface")
  }

  private func dialogContent(colors: SurfaceColors) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      header(colors: colors)

      customContent
        .padding(.top, contentSpacing)

      if let warning {
        DialogSurfaceNotice(text: warning, tone: .warning, theme: theme)
          .padding(.top, 16)
      }

      if !actions.isEmpty {
        actionBar(colors: colors)
          .padding(.top, 24)
      }
    }
    .padding(15)
  }

  @ViewBuilder
  private func header(colors: SurfaceColors) -> some View {
    if icon != nil || !title.isEmpty || subtitle != nil || message != nil {
      VStack(alignment: .leading, spacing: 0) {
        if let icon {
          DialogSurfaceIconView(icon: icon, colors: colors)
            .padding(.bottom, 16)
        }

        if !title.isEmpty {
          Text(title)
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(colors.primaryText)
        }

        if let subtitle {
          Text(subtitle)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(colors.secondaryText)
            .padding(.top, 4)
        }

        if let message {
          Text(message)
            .font(.system(size: 13))
            .foregroundStyle(colors.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, subtitle == nil ? 4 : 8)
        }
      }
    }
  }

  @ViewBuilder
  private var customContent: some View {
    if let maximumContentHeight = layout.maximumContentHeight {
      ScrollView {
        content
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .scrollIndicators(.never)
      .frame(maxHeight: maximumContentHeight)
    } else {
      content
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private func actionBar(colors: SurfaceColors) -> some View {
    HStack(spacing: 12) {
      ForEach(actions) { action in
        DialogSurfaceActionButton(action: action, colors: colors)
      }
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
  }
}

extension DialogSurface where Content == EmptyView {
  public init(
    theme: SurfaceTheme = .system,
    title: String,
    subtitle: String? = nil,
    message: String? = nil,
    warning: String? = nil,
    icon: DialogSurfaceIcon? = nil,
    layout: DialogSurfaceLayout = DialogSurfaceLayout(),
    actions: [DialogSurfaceAction] = [],
    scrimLabel: String = "Dismiss dialog",
    onDismiss: (() -> Void)? = nil
  ) {
    self.init(
      theme: theme,
      title: title,
      subtitle: subtitle,
      message: message,
      warning: warning,
      icon: icon,
      layout: layout,
      actions: actions,
      contentSpacing: 0,
      scrimLabel: scrimLabel,
      onDismiss: onDismiss,
      content: { EmptyView() }
    )
  }
}

private struct DialogSurfaceIconView: View {
  let icon: DialogSurfaceIcon
  let colors: SurfaceColors

  var body: some View {
    Group {
      switch icon {
      case .application:
        Image(nsImage: NSApp.applicationIconImage)
          .resizable()
          .interpolation(.high)
          .antialiased(true)
          .scaledToFit()
          .clipShape(.rect(cornerRadius: 12))
          .accessibilityHidden(true)
      case .system(let name, let tone):
        Image(systemName: name)
          .font(.system(size: 22, weight: .semibold))
          .foregroundStyle(color(for: tone))
          .frame(width: 46, height: 46)
          .background(color(for: tone).opacity(0.14), in: .rect(cornerRadius: 12))
      }
    }
    .frame(width: 46, height: 46)
    .accessibilityHidden(true)
  }

  private func color(for tone: SurfaceTone) -> Color {
    switch tone {
    case .neutral:
      colors.primaryText
    case .accent:
      colors.accent
    case .warning:
      colors.warning
    case .success:
      colors.success
    case .danger:
      colors.danger
    }
  }
}

private struct DialogSurfaceActionButton: View {
  let action: DialogSurfaceAction
  let colors: SurfaceColors

  @State private var isHovering = false

  var body: some View {
    configuredShortcut(
      Button(action: action.action) {
        HStack(spacing: 6) {
          Text(action.title)
            .font(.system(size: 13, weight: .medium))
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)

          if let shortcut = action.shortcut {
            KeyboardShortcutPill(
              shortcut.label.lowercased(),
              color: foreground,
              textOpacity: 0.62
            )
          }
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(background, in: .rect(cornerRadius: 10))
      }
      .buttonStyle(.plain)
      .disabled(!action.isEnabled)
      .opacity(action.isEnabled ? 1 : 0.5)
      .onHover { isHovering = $0 }
      .accessibilityLabel(action.title)
      .accessibilityIdentifier(action.accessibilityIdentifier ?? "dialog.action.\(action.id)")
    )
  }

  private var background: Color {
    switch action.role {
    case .primary:
      isHovering ? colors.accent.opacity(0.82) : colors.accent
    case .secondary:
      isHovering ? colors.hoverBackground : colors.mutedBackground
    case .destructive:
      isHovering ? colors.dangerHoverBackground : colors.dangerBackground
    }
  }

  private var foreground: Color {
    switch action.role {
    case .primary:
      colors.onAccent
    case .secondary:
      colors.primaryText
    case .destructive:
      colors.onDangerBackground
    }
  }

  @ViewBuilder
  private func configuredShortcut<V: View>(_ view: V) -> some View {
    switch action.shortcut {
    case .default:
      view.keyboardShortcut(.defaultAction)
    case .cancel:
      view.keyboardShortcut(.cancelAction)
    case .key(let key, let modifiers, _):
      view.keyboardShortcut(key, modifiers: modifiers)
    case nil:
      view
    }
  }
}

struct DialogSurfaceNotice: View {
  private let text: String
  private let tone: SurfaceTone
  private let theme: SurfaceTheme

  @Environment(\.colorScheme) private var colorScheme

  init(text: String, tone: SurfaceTone, theme: SurfaceTheme = .system) {
    self.text = text
    self.tone = tone
    self.theme = theme
  }

  var body: some View {
    let colors = theme.colors(for: colorScheme)
    let color = color(colors: colors)

    Label(text, systemImage: iconName)
      .font(.system(size: 12, weight: .medium))
      .foregroundStyle(color)
      .fixedSize(horizontal: false, vertical: true)
      .padding(10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(color.opacity(0.12), in: .rect(cornerRadius: 9))
  }

  private var iconName: String {
    switch tone {
    case .neutral:
      "info.circle.fill"
    case .accent:
      "sparkles"
    case .warning:
      "exclamationmark.triangle.fill"
    case .success:
      "checkmark.circle.fill"
    case .danger:
      "xmark.octagon.fill"
    }
  }

  private func color(colors: SurfaceColors) -> Color {
    switch tone {
    case .neutral:
      colors.secondaryText
    case .accent:
      colors.accent
    case .warning:
      colors.warning
    case .success:
      colors.success
    case .danger:
      colors.danger
    }
  }
}
