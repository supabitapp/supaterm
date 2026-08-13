import AppKit
import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermSettingsFeature
import SupatermUI
import SwiftUI

struct TerminalWindowConfirmationView: View {
  let store: StoreOf<TerminalWindowFeature>
  @Bindable var terminal: TerminalHostState
  @Shared(.supatermSettings) private var supatermSettings = .default
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var chromeColorScheme: ColorScheme {
    supatermSettings.appearanceMode.colorScheme ?? terminal.terminalChromeColorScheme
  }

  private var palette: Palette {
    Palette(colorScheme: chromeColorScheme, tint: terminal.displayedSpace.color)
  }

  var body: some View {
    Group {
      if let confirmationRequest = store.confirmationRequest {
        ConfirmationOverlay(
          palette: palette,
          title: confirmationRequest.title,
          message: confirmationRequest.message,
          confirmTitle: confirmationRequest.confirmTitle,
          onConfirm: {
            _ = store.send(.confirmationConfirmButtonTapped)
          },
          onCancel: {
            _ = store.send(.confirmationCancelButtonTapped)
          }
        )
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .terminalAnimation(
      .spring(response: 0.3, dampingFraction: 0.82),
      value: store.confirmationRequest,
      reduceMotion: reduceMotion
    )
    .environment(\.colorScheme, chromeColorScheme)
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
    DialogSurface(
      theme: .palette(palette),
      title: title,
      message: message,
      icon: .application,
      layout: DialogSurfaceLayout(width: 360),
      actions: [
        DialogSurfaceAction(
          id: "cancel",
          title: "Cancel",
          role: .secondary,
          shortcut: .cancel,
          accessibilityIdentifier: "dialog.cancel",
          action: onCancel
        ),
        DialogSurfaceAction(
          id: "confirm",
          title: confirmTitle,
          role: .destructive,
          shortcut: .default,
          accessibilityIdentifier: "dialog.confirm",
          action: onConfirm
        ),
      ],
      scrimLabel: "Cancel confirmation",
      onDismiss: onCancel
    )
  }
}

struct QuitConfirmationOverlay: View {
  let palette: Palette
  let content: QuitConfirmationContent
  let onPreserve: () -> Void
  let onTerminate: () -> Void
  let onCancel: () -> Void

  var body: some View {
    DialogSurface(
      theme: .palette(palette),
      title: "Quit Supaterm?",
      message: content.message,
      icon: .application,
      layout: DialogSurfaceLayout(width: 520),
      actions: actions,
      scrimLabel: "Cancel quit confirmation",
      onDismiss: onCancel
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.clear)
    .accessibilityIdentifier("dialog.quit")
  }

  private var actions: [DialogSurfaceAction] {
    var actions = [
      DialogSurfaceAction(
        id: "cancel",
        title: "Cancel",
        role: .secondary,
        shortcut: .cancel,
        accessibilityIdentifier: "dialog.cancel",
        action: onCancel
      ),
      DialogSurfaceAction(
        id: "terminate",
        title: content.terminatingSessionsTitle,
        role: .destructive,
        shortcut: content.preservingSessionsTitle == nil
          ? .default
          : .key(.return, modifiers: .shift, label: "⇧↩"),
        accessibilityIdentifier: "dialog.quit.terminate",
        action: onTerminate
      ),
    ]

    if let preservingSessionsTitle = content.preservingSessionsTitle {
      actions.append(
        DialogSurfaceAction(
          id: "preserve",
          title: preservingSessionsTitle,
          role: .secondary,
          shortcut: .default,
          accessibilityIdentifier: "dialog.quit.preserve",
          action: onPreserve
        )
      )
    }

    return actions
  }
}

struct SpaceEditorOverlay: View {
  let palette: Palette
  let title: String
  let confirmTitle: String
  @Binding var name: String
  @Binding var color: ThemeTint
  let isSaveEnabled: Bool
  let onSave: () -> Void
  let onCancel: () -> Void

  @FocusState private var isNameFieldFocused: Bool

  var body: some View {
    DialogSurface(
      theme: .palette(palette),
      title: title,
      layout: DialogSurfaceLayout(width: 360),
      actions: [
        DialogSurfaceAction(
          id: "cancel",
          title: "Cancel",
          role: .secondary,
          shortcut: .cancel,
          accessibilityIdentifier: "dialog.cancel",
          action: onCancel
        ),
        DialogSurfaceAction(
          id: "save",
          title: confirmTitle,
          role: .secondary,
          shortcut: .default,
          isEnabled: isSaveEnabled,
          accessibilityIdentifier: "dialog.confirm",
          action: onSave
        ),
      ],
      scrimLabel: "Cancel space naming",
      onDismiss: onCancel
    ) {
      VStack(alignment: .leading, spacing: 16) {
        DialogTextField(
          "Space name",
          text: $name,
          theme: .palette(palette),
          accessibilityIdentifier: "dialog.space-name"
        )
        .focused($isNameFieldFocused)
        .onSubmit {
          guard isSaveEnabled else { return }
          onSave()
        }

        HStack(spacing: 10) {
          ForEach(ThemeTint.allCases, id: \.self) { tint in
            SpaceColorSwatch(
              palette: palette,
              tint: tint,
              isSelected: tint == color,
              action: { color = tint }
            )
          }
        }
      }
    }
    .task {
      await focusNameField()
    }
  }

  private func focusNameField() async {
    isNameFieldFocused = false
    await Task.yield()
    isNameFieldFocused = true
    await Task.yield()
    NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: nil)
  }
}

private struct SpaceColorSwatch: View {
  let palette: Palette
  let tint: ThemeTint
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Circle()
        .fill(tint.sidebarColor(palette: palette))
        .frame(width: 18, height: 18)
        .overlay {
          Circle()
            .strokeBorder(palette.selectedPillStroke, lineWidth: 1)
        }
        .padding(3)
        .overlay {
          if isSelected {
            Circle()
              .strokeBorder(palette.selectedText, lineWidth: 1.5)
          }
        }
    }
    .buttonStyle(.plain)
    .accessibilityLabel(tint.displayName)
    .accessibilityIdentifier("dialog.space-color-\(tint.rawValue)")
  }
}
