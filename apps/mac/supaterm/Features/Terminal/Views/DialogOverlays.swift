import AppKit
import SwiftUI

struct ConfirmationOverlay: View {
  let palette: TerminalPalette
  let title: String
  let message: String
  let confirmTitle: String
  let onConfirm: () -> Void
  let onCancel: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private static let transition: AnyTransition = .asymmetric(
    insertion: .offset(y: -16).combined(with: .scale(scale: 0.96)).combined(with: .opacity),
    removal: .offset(y: -16).combined(with: .scale(scale: 0.96)).combined(with: .opacity)
  )

  var body: some View {
    ZStack {
      Button(action: onCancel) {
        Color.black.opacity(0.4)
          .ignoresSafeArea()
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Cancel confirmation")

      VStack(alignment: .leading, spacing: 0) {
        VStack(alignment: .leading, spacing: 0) {
          ConfirmationIcon()
            .padding(.bottom, 16)

          Text(title)
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(palette.primaryText)

          Text(message)
            .font(.system(size: 13))
            .foregroundStyle(palette.secondaryText)
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

            DialogActionButton(
              palette: palette,
              title: confirmTitle,
              style: .destructive,
              shortcut: .symbol("return"),
              action: onConfirm
            )
            .keyboardShortcut(.defaultAction)
          }
          .padding(.top, 28)
        }
        .frame(width: 360)
        .padding(12)
        .background(palette.dialogInnerBackground, in: .rect(cornerRadius: 11))
        .overlay {
          RoundedRectangle(cornerRadius: 11, style: .continuous)
            .stroke(palette.dialogBorder, lineWidth: 0.5)
        }
      }
      .padding(3)
      .background(palette.dialogOuterBackground, in: .rect(cornerRadius: 14))
      .shadow(color: .black.opacity(0.25), radius: 20, y: 8)
      .terminalTransition(Self.transition, reduceMotion: reduceMotion)
    }
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

  let palette: TerminalPalette
  let title: String
  let style: Style
  let shortcut: Shortcut
  let action: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Text(title)
          .font(.system(size: 13, weight: .medium))

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
        .padding(.horizontal, shortcutPadding)
        .background(foreground.opacity(shortcutOpacity), in: .rect(cornerRadius: 4))
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
      isHovering ? palette.dialogSecondaryHoverFill : palette.dialogSecondaryFill
    case .destructive:
      isHovering ? palette.dialogDestructiveHoverFill : palette.dialogDestructiveFill
    }
  }

  private var foreground: Color {
    switch style {
    case .secondary:
      palette.dialogPrimaryText
    case .destructive:
      .white
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

  private var shortcutPadding: CGFloat {
    switch shortcut {
    case .symbol:
      0
    case .text(let value):
      value.count == 1 ? 0 : 4
    }
  }
}

struct SpaceNameOverlay: View {
  let palette: TerminalPalette
  let title: String
  let confirmTitle: String
  @Binding var name: String
  let isSaveEnabled: Bool
  let onSave: () -> Void
  let onCancel: () -> Void

  @FocusState private var isNameFieldFocused: Bool

  var body: some View {
    ZStack {
      Button(action: onCancel) {
        Color.black.opacity(0.4)
          .ignoresSafeArea()
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Cancel space naming")

      VStack(alignment: .leading, spacing: 0) {
        VStack(alignment: .leading, spacing: 16) {
          Text(title)
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(palette.primaryText)

          TextField("Space name", text: $name)
            .textFieldStyle(.plain)
            .font(.system(size: 13))
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(palette.dialogSecondaryFill, in: .rect(cornerRadius: 10))
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

            Spacer()

            DialogActionButton(
              palette: palette,
              title: confirmTitle,
              style: .secondary,
              shortcut: .symbol("return"),
              action: onSave
            )
            .keyboardShortcut(.defaultAction)
            .opacity(isSaveEnabled ? 1 : 0.5)
            .disabled(!isSaveEnabled)
          }
        }
        .frame(width: 360)
        .padding(12)
        .background(palette.dialogInnerBackground, in: .rect(cornerRadius: 11))
        .overlay {
          RoundedRectangle(cornerRadius: 11, style: .continuous)
            .stroke(palette.dialogBorder, lineWidth: 0.5)
        }
      }
      .padding(3)
      .background(palette.dialogOuterBackground, in: .rect(cornerRadius: 14))
      .shadow(color: .black.opacity(0.25), radius: 20, y: 8)
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
