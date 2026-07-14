import AppKit
import SupaTheme
import SwiftUI

private let dialogTransition: AnyTransition = .asymmetric(
  insertion: .offset(y: -16).combined(with: .scale(scale: 0.96)).combined(with: .opacity),
  removal: .offset(y: -16).combined(with: .scale(scale: 0.96)).combined(with: .opacity)
)

private struct DialogChrome<Content: View>: View {
  let palette: Palette
  let scrimLabel: String
  let onScrimTap: () -> Void
  @ViewBuilder let content: () -> Content

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ZStack {
      Button(action: onScrimTap) {
        palette.scrim
          .ignoresSafeArea()
      }
      .buttonStyle(.plain)
      .accessibilityLabel(scrimLabel)

      content()
        .padding(12)
        .background(palette.selectedPillFill, in: .rect(cornerRadius: 11))
        .overlay {
          RoundedRectangle(cornerRadius: 11, style: .continuous)
            .stroke(palette.selectedPillStroke, lineWidth: 0.5)
        }
        .padding(3)
        .background(palette.selectedFill, in: .rect(cornerRadius: 14))
        .shadow(color: palette.overlayShadow, radius: 20, y: 8)
        .terminalTransition(dialogTransition, reduceMotion: reduceMotion)
    }
  }
}

struct ConfirmationOverlay: View {
  let palette: Palette
  let title: String
  let message: String
  let confirmTitle: String
  let onConfirm: () -> Void
  let onCancel: () -> Void

  var body: some View {
    DialogChrome(
      palette: palette,
      scrimLabel: "Cancel confirmation",
      onScrimTap: onCancel
    ) {
      VStack(alignment: .leading, spacing: 0) {
        ConfirmationIcon()
          .padding(.bottom, 16)

        Text(title)
          .font(.system(size: 22, weight: .semibold))
          .foregroundStyle(palette.selectedText)

        Text(message)
          .font(.system(size: 13))
          .foregroundStyle(palette.selectedSecondaryText)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 4)

        HStack(spacing: 12) {
          Spacer()

          DialogActionButton(
            palette: palette,
            title: "Cancel",
            style: .secondary,
            shortcut: .text("esc"),
            action: onCancel
          )
          .keyboardShortcut(.cancelAction)
          .accessibilityIdentifier("dialog.cancel")

          DialogActionButton(
            palette: palette,
            title: confirmTitle,
            style: .destructive,
            shortcut: .symbol("return"),
            action: onConfirm
          )
          .keyboardShortcut(.defaultAction)
          .accessibilityIdentifier("dialog.confirm")
        }
        .padding(.top, 28)
      }
      .frame(width: 360)
    }
  }
}

struct QuitConfirmationOverlay: View {
  let palette: Palette
  let content: QuitConfirmationContent
  let onPreserve: () -> Void
  let onTerminate: () -> Void
  let onCancel: () -> Void

  private static let dialogMinWidth: CGFloat = 460
  private static let dialogMaxWidth: CGFloat = 620

  var body: some View {
    DialogChrome(
      palette: palette,
      scrimLabel: "Cancel quit confirmation",
      onScrimTap: onCancel
    ) {
      VStack(alignment: .leading, spacing: 0) {
        ConfirmationIcon()
          .padding(.bottom, 16)

        Text("Quit Supaterm?")
          .font(.system(size: 22, weight: .semibold))
          .foregroundStyle(palette.selectedText)

        Text(content.message)
          .font(.system(size: 13))
          .foregroundStyle(palette.selectedSecondaryText)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 4)

        HStack(spacing: 12) {
          Spacer()

          DialogActionButton(
            palette: palette,
            title: "Cancel",
            style: .secondary,
            shortcut: .text("esc"),
            action: onCancel
          )
          .keyboardShortcut(.cancelAction)
          .accessibilityIdentifier("dialog.cancel")

          DialogActionButton(
            palette: palette,
            title: content.terminatingSessionsTitle,
            style: .destructive,
            shortcut: content.preservingSessionsTitle == nil ? .symbol("return") : .text("⇧↩"),
            action: onTerminate
          )
          .accessibilityIdentifier("dialog.quit.terminate")

          if let preservingSessionsTitle = content.preservingSessionsTitle {
            DialogActionButton(
              palette: palette,
              title: preservingSessionsTitle,
              style: .secondary,
              shortcut: .symbol("return"),
              action: onPreserve
            )
            .accessibilityIdentifier("dialog.quit.preserve")
          }
        }
        .padding(.top, 28)
      }
      .frame(minWidth: Self.dialogMinWidth, maxWidth: Self.dialogMaxWidth)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.clear)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("dialog.quit")
  }
}

private struct ConfirmationIcon: View {
  var body: some View {
    Image(nsImage: NSApp.applicationIconImage)
      .resizable()
      .interpolation(.high)
      .antialiased(true)
      .scaledToFit()
      .frame(width: 46, height: 46)
      .clipShape(.rect(cornerRadius: 12))
      .accessibilityHidden(true)
  }
}

private struct DialogActionButton: View {
  enum Style {
    case secondary
    case destructive
  }

  enum Shortcut {
    case symbol(String)
    case text(String)
  }

  let palette: Palette
  let title: String
  let style: Style
  let shortcut: Shortcut?
  let action: () -> Void

  @State private var isHovering = false

  init(
    palette: Palette,
    title: String,
    style: Style,
    shortcut: Shortcut?,
    action: @escaping () -> Void
  ) {
    self.palette = palette
    self.title = title
    self.style = style
    self.shortcut = shortcut
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Text(title)
          .font(.system(size: 13, weight: .medium))
          .lineLimit(1)
          .fixedSize(horizontal: true, vertical: false)

        if let shortcut {
          Spacer()
            .frame(width: 3)

          Group {
            switch shortcut {
            case .symbol(let name):
              Image(systemName: name)
                .accessibilityHidden(true)
            case .text(let value):
              Text(value.lowercased()).opacity(0.5)
            }
          }
          .font(.system(size: 10, weight: .semibold))
          .frame(minWidth: 18, minHeight: 18)
          .padding(.horizontal, shortcutPadding(for: shortcut))
          .background(foreground.opacity(shortcutOpacity), in: .rect(cornerRadius: 4))
        }
      }
      .foregroundStyle(foreground)
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      .background(background, in: .rect(cornerRadius: 10))
    }
    .buttonStyle(.plain)
    .onHover { isHovering = $0 }
  }

  private var background: Color {
    switch style {
    case .secondary:
      isHovering ? palette.selectedText.opacity(0.2) : palette.selectedPillFill
    case .destructive:
      isHovering ? palette.dangerHoverFill : palette.dangerFill
    }
  }

  private var foreground: Color {
    switch style {
    case .secondary:
      palette.selectedText
    case .destructive:
      palette.onDangerFill
    }
  }

  private var shortcutOpacity: Double {
    switch style {
    case .secondary:
      0.07
    case .destructive:
      0.15
    }
  }

  private func shortcutPadding(for shortcut: Shortcut) -> CGFloat {
    switch shortcut {
    case .symbol:
      0
    case .text(let value):
      value.count == 1 ? 0 : 4
    }
  }
}

struct SpaceEditorOverlay: View {
  let palette: Palette
  let title: String
  let confirmTitle: String
  @Binding var name: String
  let isSaveEnabled: Bool
  let onSave: () -> Void
  let onCancel: () -> Void

  @FocusState private var isNameFieldFocused: Bool

  var body: some View {
    DialogChrome(
      palette: palette,
      scrimLabel: "Cancel space naming",
      onScrimTap: onCancel
    ) {
      VStack(alignment: .leading, spacing: 16) {
        Text(title)
          .font(.system(size: 22, weight: .semibold))
          .foregroundStyle(palette.selectedText)

        TextField("Space name", text: $name)
          .textFieldStyle(.plain)
          .font(.system(size: 13))
          .padding(.horizontal, 12)
          .padding(.vertical, 10)
          .background(palette.selectedPillFill, in: .rect(cornerRadius: 10))
          .accessibilityIdentifier("dialog.space-name")
          .focused($isNameFieldFocused)
          .onSubmit {
            guard isSaveEnabled else { return }
            onSave()
          }

        HStack {
          DialogActionButton(
            palette: palette,
            title: "Cancel",
            style: .secondary,
            shortcut: .text("esc"),
            action: onCancel
          )
          .keyboardShortcut(.cancelAction)
          .accessibilityIdentifier("dialog.cancel")

          Spacer()

          DialogActionButton(
            palette: palette,
            title: confirmTitle,
            style: .secondary,
            shortcut: .symbol("return"),
            action: onSave
          )
          .keyboardShortcut(.defaultAction)
          .accessibilityIdentifier("dialog.confirm")
          .opacity(isSaveEnabled ? 1 : 0.5)
          .disabled(!isSaveEnabled)
        }
      }
      .frame(width: 360)
    }
    .task {
      focusNameField()
    }
  }

  private func focusNameField() {
    isNameFieldFocused = false
    Task { @MainActor in
      await Task.yield()
      isNameFieldFocused = true
      await Task.yield()
      NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: nil)
    }
  }
}
