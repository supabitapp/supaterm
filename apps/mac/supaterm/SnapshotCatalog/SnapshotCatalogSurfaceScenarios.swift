import SupaTheme
import SupatermUI
import SwiftUI

extension SnapshotCatalog {
  static let surfaceScenarios: [SnapshotScenario] =
    keyboardShortcutPillScenarios
    + dialogSurfaceScenarios
    + popoverSurfaceScenarios
    + searchPanelSurfaceScenarios
    + toastSurfaceScenarios

  private static let keyboardShortcutPillScenarios: [SnapshotScenario] = [
    scenario(
      "variants",
      group: "Keyboard Shortcut Pills",
      title: "Shortcut variants",
      size: CGSize(width: 560, height: 180)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
              KeyboardShortcutPill("⌘1", color: palette.secondaryText)
              KeyboardShortcutPill("⌘⇧D", color: palette.primaryText)
              KeyboardShortcutPill("↩", color: palette.accent)
            }
            HStack(spacing: 12) {
              KeyboardShortcutPill("Cmd-G", color: palette.secondaryText)
              KeyboardShortcutPill("Shift-Cmd-G", color: palette.primaryText)
              KeyboardShortcutPill("Esc", color: palette.accent)
            }
          }
          .padding(24)
          .background(palette.detailBackground, in: .rect(cornerRadius: 12))
        }
      )
    }
  ]

  private static let dialogSurfaceScenarios: [SnapshotScenario] = [
    scenario(
      "form",
      group: "Dialog Surface",
      title: "Input form",
      size: CGSize(width: 700, height: 620)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          DialogSurface(
            theme: .palette(palette),
            title: "Connect to host",
            subtitle: "Secure Shell",
            message: "Enter the host details used for this connection.",
            icon: .system("network", tone: .accent),
            layout: DialogSurfaceLayout(width: 410),
            actions: standardDialogActions
          ) {
            VStack(spacing: 14) {
              DialogTextField("Host", text: .constant("build.example.com"), theme: .palette(palette))
              DialogSecureField("Password", text: .constant("supaterm"), theme: .palette(palette))
              DialogDropdown("Protocol", selection: .constant("SSH"), theme: .palette(palette)) {
                Text("SSH").tag("SSH")
                Text("Mosh").tag("Mosh")
              }
              DialogCheckbox(
                "Remember this host",
                detail: "Save it to recent connections.",
                isOn: .constant(true),
                theme: .palette(palette)
              )
            }
          }
        }
      )
    },
    scenario(
      "validation",
      group: "Dialog Surface",
      title: "Validation and warning",
      size: CGSize(width: 700, height: 600)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          DialogSurface(
            theme: .palette(palette),
            title: "Share session notes",
            warning: "Anyone with the link can read these notes.",
            icon: .system("square.and.arrow.up", tone: .warning),
            layout: DialogSurfaceLayout(width: 410),
            actions: standardDialogActions
          ) {
            VStack(spacing: 14) {
              DialogTextField(
                "Title",
                text: .constant(""),
                state: .invalid("A title is required."),
                theme: .palette(palette)
              )
              DialogMultilineField(
                "Notes",
                text: .constant("Failed checks are isolated to the release build."),
                maximumCharacterCount: 120,
                theme: .palette(palette)
              )
            }
          }
        }
      )
    },
    scenario(
      "one-time-code-editing",
      group: "Dialog Surface",
      title: "One-time code editing",
      size: CGSize(width: 700, height: 420)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          DialogSurface(
            theme: .palette(palette),
            title: "Verify your account",
            message: "Enter the six-digit code sent to your device.",
            icon: .system("lock.shield", tone: .accent),
            layout: DialogSurfaceLayout(width: 410),
            actions: standardDialogActions
          ) {
            DialogOneTimeCodeField(
              "Verification code",
              code: .constant("284"),
              state: .editing,
              theme: .palette(palette)
            )
          }
        }
      )
    },
    scenario(
      "one-time-code-submitting",
      group: "Dialog Surface",
      title: "One-time code submitting",
      size: CGSize(width: 700, height: 440)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          DialogSurface(
            theme: .palette(palette),
            title: "Verifying code",
            icon: .system("lock.shield", tone: .accent),
            layout: DialogSurfaceLayout(width: 410),
            actions: [
              DialogSurfaceAction(id: "cancel", title: "Cancel", role: .secondary, shortcut: .cancel) {}
            ]
          ) {
            DialogOneTimeCodeField(
              "Verification code",
              code: .constant("284196"),
              state: .submitting,
              theme: .palette(palette)
            )
          }
        }
      )
    },
    scenario(
      "progress-countdown",
      group: "Dialog Surface",
      title: "Progress and countdown",
      size: CGSize(width: 700, height: 480)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          DialogSurface(
            theme: .palette(palette),
            title: "Preparing workspace",
            message: "Supaterm will open the session when setup finishes.",
            icon: .system("shippingbox.fill", tone: .success),
            layout: DialogSurfaceLayout(width: 410),
            actions: [
              DialogSurfaceAction(id: "cancel", title: "Cancel", role: .secondary, shortcut: .cancel) {}
            ]
          ) {
            VStack(spacing: 18) {
              DialogProgress("Downloading tools", detail: "72%", value: 0.72, theme: .palette(palette))
              DialogCountdown(
                "Retrying connection",
                remaining: .seconds(18),
                total: .seconds(30),
                theme: .palette(palette)
              )
            }
          }
        }
      )
    },
  ]

  private static let popoverSurfaceScenarios: [SnapshotScenario] = [
    scenario(
      "material",
      group: "Popover Surface",
      title: "Material",
      size: CGSize(width: 520, height: 320)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          PopoverSurface(
            theme: .palette(palette),
            size: CGSize(width: 300, height: 164)
          ) {
            SurfacePopoverContent(title: "Quick actions", detail: "Choose an action for this pane.")
          }
        }
      )
    },
    scenario(
      "solid-masked-corners",
      group: "Popover Surface",
      title: "Solid with masked corners",
      size: CGSize(width: 520, height: 320)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          PopoverSurface(
            theme: .palette(palette),
            style: SurfaceCardStyle(
              background: .solid,
              corners: SurfaceCorners(
                topLeading: 4,
                bottomLeading: 18,
                bottomTrailing: 18,
                topTrailing: 4
              )
            ),
            size: CGSize(width: 300, height: 164)
          ) {
            SurfacePopoverContent(title: "Pinned menu", detail: "Top corners follow the anchor.")
          }
        }
      )
    },
    scenario(
      "movable-resizable",
      group: "Popover Surface",
      title: "Movable and resizable",
      size: CGSize(width: 620, height: 420)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          PopoverSurface(
            theme: .palette(palette),
            geometry: .constant(
              PopoverSurfaceGeometry(size: CGSize(width: 340, height: 210), offset: CGSize(width: 26, height: -12))
            ),
            allowsMoving: true,
            allowsResizing: true
          ) {
            SurfacePopoverContent(title: "Inspector", detail: "Drag the handle or any edge to resize.")
          }
        }
      )
    },
  ]

  private static let searchPanelSurfaceScenarios: [SnapshotScenario] = [
    searchPanelScenario("results", title: "Results", query: "", selection: "open", items: searchItems),
    searchPanelScenario("filtered", title: "Filtered", query: "split", selection: "split", items: searchItems),
    searchPanelScenario("empty", title: "No results", query: "missing", selection: nil, items: []),
    searchPanelScenario(
      "nested-preview",
      title: "Nested actions and preview",
      query: "",
      selection: "workspace",
      items: nestedSearchItems,
      width: 1040
    ),
  ]

  private static let toastSurfaceScenarios: [SnapshotScenario] = [
    toastScenario(
      "neutral",
      title: "Neutral",
      tone: .neutral,
      message: "A background task has started.",
      position: .topLeading
    ),
    toastScenario(
      "success", title: "Success with action", tone: .success, message: "Snapshot baselines recorded.",
      position: .topTrailing, showsAction: true),
    toastScenario(
      "warning-progress", title: "Warning with progress", tone: .warning, message: "Connection is slower than usual.",
      position: .bottom, progress: 0.42),
    scenario(
      "danger-accessory",
      group: "Toast Surface",
      title: "Danger with accessory",
      size: CGSize(width: 560, height: 260)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          ToastSurfaceOverlay(position: .bottomTrailing) {
            ToastSurface(
              theme: .palette(palette),
              title: "Build failed",
              message: "Choose which log to open.",
              tone: .danger,
              onDismiss: {},
              accessory: {
                Picker("Log", selection: .constant("Errors")) {
                  Text("Errors").tag("Errors")
                  Text("Full log").tag("Full log")
                }
                .labelsHidden()
                .frame(width: 88)
              }
            )
          }
        }
      )
    },
  ]

  private static var standardDialogActions: [DialogSurfaceAction] {
    [
      DialogSurfaceAction(id: "cancel", title: "Cancel", role: .secondary, shortcut: .cancel) {},
      DialogSurfaceAction(id: "continue", title: "Continue", role: .primary, shortcut: .default) {},
    ]
  }

  private static var searchItems: [SearchPanelItem<String>] {
    [
      SearchPanelItem(
        id: "open",
        title: "Open recent workspace",
        subtitle: "~/code/supaterm",
        leadingIcon: "clock.arrow.circlepath",
        shortcut: "↩"
      ),
      SearchPanelItem(
        id: "split",
        title: "Split pane right",
        subtitle: "Terminal",
        leadingIcon: "rectangle.split.2x1",
        shortcut: "⌘D",
        isEmphasized: true
      ),
      SearchPanelItem(
        id: "settings",
        title: "Open Settings",
        subtitle: "Supaterm",
        leadingIcon: "gearshape",
        shortcut: "⌘,"
      ),
      SearchPanelItem(
        id: "disabled",
        title: "Install update",
        subtitle: "No update is ready",
        leadingIcon: "arrow.down.circle",
        isEnabled: false
      ),
    ]
  }

  private static var nestedSearchItems: [SearchPanelItem<String>] {
    [
      SearchPanelItem(
        id: "workspace",
        title: "Supaterm workspace",
        subtitle: "~/code/supaterm",
        detail: "3 active panes",
        leadingIcon: "folder.fill",
        badge: "3",
        showsPreview: true,
        children: [
          SearchPanelItem(id: "open-window", title: "Open in new window", leadingIcon: "macwindow.badge.plus"),
          SearchPanelItem(id: "copy-path", title: "Copy path", leadingIcon: "doc.on.doc"),
        ]
      ),
      SearchPanelItem(id: "docs", title: "Documentation", subtitle: "~/code/docs", leadingIcon: "folder"),
    ]
  }

  private static func searchPanelScenario(
    _ id: String,
    title: String,
    query: String,
    selection: String?,
    items: [SearchPanelItem<String>],
    width: CGFloat = 860
  ) -> SnapshotScenario {
    scenario(
      id,
      group: "Search Panel Surface",
      title: title,
      size: CGSize(width: width, height: 440)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          SearchPanelSurface(
            theme: .palette(palette),
            query: .constant(query),
            selection: .constant(selection),
            items: items,
            prompt: "Search commands and workspaces…",
            layout: SearchPanelLayout(width: 640, height: 288, accessoryWidth: 280),
            onActivate: { _ in },
            onDismiss: {},
            preview: { item in
              VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "macwindow")
                  .font(.system(size: 28))
                  .accessibilityHidden(true)
                Text(item.detail ?? "Preview")
                  .font(.system(size: 12, weight: .medium))
                Text("main · clean working tree")
                  .font(.system(size: 11))
                  .foregroundStyle(.secondary)
              }
              .padding(8)
            }
          )
        }
      )
    }
  }

  private static func toastScenario(
    _ id: String,
    title: String,
    tone: SurfaceTone,
    message: String,
    position: ToastSurfacePosition,
    showsAction: Bool = false,
    progress: Double? = nil
  ) -> SnapshotScenario {
    scenario(
      id,
      group: "Toast Surface",
      title: title,
      size: CGSize(width: 560, height: 260)
    ) { appearance in
      AnyView(
        SurfaceSnapshotBackdrop(appearance: appearance) { palette in
          ToastSurfaceOverlay(position: position) {
            ToastSurface(
              theme: .palette(palette),
              title: title,
              message: message,
              tone: tone,
              actions: showsAction
                ? [ToastSurfaceAction(id: "open", title: "Open snapshots") {}]
                : [],
              progress: progress,
              onDismiss: {}
            )
          }
        }
      )
    }
  }
}

private struct SurfaceSnapshotBackdrop<Content: View>: View {
  let appearance: SnapshotAppearance
  let content: (Palette) -> Content

  var body: some View {
    let palette = Palette(colorScheme: appearance.colorScheme)

    content(palette)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background {
        LinearGradient(
          colors: appearance == .dark
            ? [Color(red: 0.14, green: 0.15, blue: 0.18), Color(red: 0.05, green: 0.06, blue: 0.08)]
            : [Color(red: 0.98, green: 0.96, blue: 0.92), Color(red: 0.88, green: 0.92, blue: 0.97)],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
      }
  }
}

private struct SurfacePopoverContent: View {
  let title: String
  let detail: String

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Label(title, systemImage: "sparkles")
        .font(.system(size: 14, weight: .semibold))
      Text(detail)
        .font(.system(size: 12))
        .foregroundStyle(.secondary)
      Divider()
      Button("Open in New Tab") {}
      Button("Copy Path") {}
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
