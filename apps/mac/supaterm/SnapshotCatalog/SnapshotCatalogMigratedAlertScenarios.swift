import AppKit
import ComposableArchitecture
import SupaTheme
import SupatermUI
import SwiftUI

@testable import SupatermLicenseFeature
@testable import SupatermSettingsFeature
@testable import SupatermUpdateFeature

extension SnapshotCatalog {
  static let migratedNativeAlertGroup = "Migrated Native Alerts"

  static let migratedNativeAlertScenarios: [SnapshotScenario] =
    launchAlertScenarios
    + settingsAlertScenarios
    + terminalCloseAlertScenarios
    + terminalSecurityAlertScenarios
    + terminalClipboardAlertScenarios
    + updateAlertScenarios
    + quitAlertScenarios

  private static let launchAlertScenarios: [SnapshotScenario] = [
    migratedAlertScenario(
      "launch-instance-conflict",
      title: "Instance already running",
      size: CGSize(width: 760, height: 500)
    ) { _ in
      LaunchFailureDialog(
        title: "Supaterm is already running",
        message: """
          Another Supaterm process owns the instance name “default”, and processes that share a name \
          also share their terminal sessions and their saved layout.

          Set SUPATERM_INSTANCE_NAME to run a second instance.
          """,
        onQuit: {}
      )
    },
    migratedAlertScenario(
      "launch-bootstrap-failure",
      title: "Terminal bootstrap failure",
      size: CGSize(width: 760, height: 440)
    ) { _ in
      LaunchFailureDialog(
        title: "Supaterm could not start",
        message: "Ghostty could not load its terminal resources.",
        onQuit: {}
      )
    },
  ]

  private static let settingsAlertScenarios: [SnapshotScenario] = [
    migratedAlertScenario(
      "settings-restart-required",
      title: "Settings restart required"
    ) { _ in
      SettingsAlertDialog(
        alert: SettingsFeature().zmxRestartRequiredAlert(),
        send: { _ in }
      )
    },
    migratedAlertScenario(
      "settings-notification-permission",
      title: "Notification permission",
      size: CGSize(width: 720, height: 460)
    ) { _ in
      SettingsAlertDialog(
        alert: SettingsFeature().notificationPermissionAlert(
          errorMessage: "Notifications are disabled for Supaterm."
        ),
        send: { _ in }
      )
    },
    migratedAlertScenario(
      "settings-restore-shortcuts",
      title: "Restore keyboard shortcuts"
    ) { _ in
      RestoreKeyboardShortcutsDialog(onRestore: {}, onCancel: {})
    },
    migratedAlertScenario(
      "settings-agent-install-failure",
      title: "Agent integration install failure",
      size: CGSize(width: 820, height: 620)
    ) { _ in
      AgentInstallFailureDialog(
        failure: SettingsAgentIntegrationInstallFailure(
          agent: .codex,
          log: """
            Failed to update ~/.codex/config.toml
            Permission denied while replacing the generated hooks section.
            The existing configuration was left unchanged.
            """
        ),
        dismiss: {}
      )
    },
  ]

  private static let terminalCloseAlertScenarios: [SnapshotScenario] = [
    migratedCloseAlertScenario(
      "terminal-close-pane",
      title: "Close pane",
      target: .surface(uuid("30000000-0000-0000-0000-000000000001"))
    ),
    migratedCloseAlertScenario(
      "terminal-close-tab",
      title: "Close tab",
      target: .tab(TerminalTabID(rawValue: uuid("30000000-0000-0000-0000-000000000002")))
    ),
    migratedCloseAlertScenario(
      "terminal-close-tabs",
      title: "Close multiple tabs",
      target: .tabs([
        TerminalTabID(rawValue: uuid("30000000-0000-0000-0000-000000000003")),
        TerminalTabID(rawValue: uuid("30000000-0000-0000-0000-000000000004")),
      ])
    ),
    migratedCloseAlertScenario(
      "terminal-close-group",
      title: "Close group",
      target: .group(
        TerminalTabGroupID(rawValue: uuid("30000000-0000-0000-0000-000000000005"))
      )
    ),
    migratedAlertScenario(
      "terminal-delete-empty-space",
      title: "Delete empty space"
    ) { palette in
      TerminalSpaceDeleteDialog(
        palette: palette,
        spaceName: "Scratch",
        paneCount: 0,
        onConfirm: {},
        onCancel: {}
      )
    },
    migratedAlertScenario(
      "terminal-delete-active-space",
      title: "Delete active space"
    ) { palette in
      TerminalSpaceDeleteDialog(
        palette: palette,
        spaceName: "Release work",
        paneCount: 4,
        onConfirm: {},
        onCancel: {}
      )
    },
    migratedAlertScenario(
      "terminal-change-title",
      title: "Change terminal title"
    ) { _ in
      GhosttyTitleDialog(
        title: "Change Terminal Title",
        model: GhosttyTitleDialogModel(title: "mac-check"),
        onConfirm: {},
        onCancel: {}
      )
    },
  ]

  private static let terminalSecurityAlertScenarios: [SnapshotScenario] = [
    migratedAlertScenario(
      "terminal-untrusted-link",
      title: "Open untrusted link",
      size: CGSize(width: 760, height: 500)
    ) { _ in
      GhosttyUntrustedURLConfirmationDialog(
        handler: "“Safari”",
        target: "ssh://deploy@production.example.com:2222",
        onOpen: {},
        onCancel: {}
      )
    },
    migratedAlertScenario(
      "terminal-blocked-link",
      title: "Blocked unsafe link",
      size: CGSize(width: 760, height: 500)
    ) { _ in
      GhosttyBlockedURLDialog(
        message: GhosttyUntrustedURL.DenialReason.unsafeCharacters.message,
        target: "https://example.com/release\\u{A}rm -rf workspace",
        onCopy: {},
        onDismiss: {}
      )
    },
  ]

  private static let terminalClipboardAlertScenarios: [SnapshotScenario] = [
    clipboardScenario(
      "clipboard-unsafe-paste",
      title: "Potentially unsafe paste",
      request: .paste,
      preview: "git status\nmake mac-test\ngit push",
      canRemember: true,
      remember: true
    ),
    clipboardScenario(
      "clipboard-read",
      title: "Clipboard read",
      request: .osc52Read,
      preview: "release-token-••••••••",
      canRemember: false
    ),
    clipboardScenario(
      "clipboard-write",
      title: "Clipboard write",
      request: .kittyWrite,
      preview: "https://github.com/supabitapp/supaterm/pull/252",
      canRemember: true
    ),
    clipboardScenario(
      "clipboard-image",
      title: "Clipboard image preview",
      request: .kittyWrite,
      preview: "image/png · 1280 × 720",
      previewImage: clipboardPreviewImage,
      canRemember: true,
      size: CGSize(width: 820, height: 720)
    ),
  ]

  private static let updateAlertScenarios: [SnapshotScenario] = [
    restartToUpdateScenario(
      "update-restart",
      title: "Restart to update",
      preservesSessions: false
    ),
    restartToUpdateScenario(
      "update-restart-preserving-sessions",
      title: "Restart to update while preserving sessions",
      preservesSessions: true
    ),
    ownershipEndedScenario(
      "update-ownership-ended",
      title: "Updates entitlement ended",
      latestIncludedReleaseURL: nil
    ),
    ownershipEndedScenario(
      "update-ownership-ended-with-download",
      title: "Updates entitlement ended with included release",
      latestIncludedReleaseURL: URL(string: "https://supaterm.com/download/26.8.0")
    ),
  ]

  private static let quitAlertScenarios: [SnapshotScenario] = [
    migratedAlertScenario(
      "quit-preserve",
      title: "Quit preserving sessions",
      size: CGSize(width: 760, height: 460)
    ) { palette in
      QuitConfirmationOverlay(
        palette: palette,
        content: QuitConfirmationContent(terminatesSessions: false),
        onPreserve: {},
        onTerminate: {},
        onCancel: {}
      )
    },
    migratedAlertScenario(
      "quit-terminate",
      title: "Quit terminating sessions",
      size: CGSize(width: 760, height: 460)
    ) { palette in
      QuitConfirmationOverlay(
        palette: palette,
        content: QuitConfirmationContent(terminatesSessions: true),
        onPreserve: {},
        onTerminate: {},
        onCancel: {}
      )
    },
  ]

  private static func migratedAlertScenario<Content: View>(
    _ id: String,
    title: String,
    size: CGSize = CGSize(width: 700, height: 420),
    content: @escaping @MainActor (Palette) -> Content
  ) -> SnapshotScenario {
    scenario(
      id,
      group: migratedNativeAlertGroup,
      title: title,
      size: size
    ) { appearance in
      AnyView(
        DialogSnapshotFixture(appearance: appearance) { palette in
          content(palette)
        }
      )
    }
  }

  private static func migratedCloseAlertScenario(
    _ id: String,
    title: String,
    target: TerminalCloseTarget
  ) -> SnapshotScenario {
    migratedAlertScenario(id, title: title) { palette in
      let request = TerminalWindowFeature().pendingCloseRequest(for: target)
      ConfirmationOverlay(
        palette: palette,
        title: request.title,
        message: request.message,
        confirmTitle: "Close",
        onConfirm: {},
        onCancel: {}
      )
    }
  }

  private static func clipboardScenario(
    _ id: String,
    title: String,
    request: GhosttyClipboardConfirmationRequest,
    preview: String,
    previewImage: NSImage? = nil,
    canRemember: Bool,
    remember: Bool = false,
    size: CGSize = CGSize(width: 820, height: 600)
  ) -> SnapshotScenario {
    migratedAlertScenario(id, title: title, size: size) { _ in
      let state = GhosttyClipboardConfirmationDialogState()
      state.remember = remember
      return GhosttyClipboardConfirmationDialog(
        presentation: GhosttyClipboardConfirmationCoordinator.presentation(
          for: request,
          programName: "deploy-agent"
        ),
        preview: preview,
        previewImage: previewImage,
        canRemember: canRemember,
        state: state,
        onConfirm: {},
        onCancel: {}
      )
    }
  }

  private static func restartToUpdateScenario(
    _ id: String,
    title: String,
    preservesSessions: Bool
  ) -> SnapshotScenario {
    migratedAlertScenario(id, title: title) { palette in
      let phase = UpdatePhase.installing(
        UpdatePhase.Installing(
          isAutoUpdate: true,
          version: "26.9.0"
        )
      )
      return RestartToUpdateDialog(
        palette: palette,
        message: TerminalSidebarUpdatePresentation.detailText(
          for: phase,
          preservesSessionsOnRestart: preservesSessions
        ),
        onRestart: {},
        onCancel: {}
      )
    }
  }

  private static func ownershipEndedScenario(
    _ id: String,
    title: String,
    latestIncludedReleaseURL: URL?
  ) -> SnapshotScenario {
    migratedAlertScenario(
      id,
      title: title,
      size: CGSize(width: 820, height: 500)
    ) { _ in
      let phase = UpdatePhase.ownershipEnded(
        UpdatePhase.OwnershipEnded(
          licenseID: "snapshot-license",
          latestIncludedReleaseURL: latestIncludedReleaseURL,
          updatesThrough: LicenseDay("2026-08-31")!,
          version: "26.9.0"
        )
      )
      return UpdateOwnershipEndedDialog(
        phase: phase,
        presentations: UpdateDriver.standardPresentations(phase.actionPresentations),
        onSelect: { _ in },
        onDismiss: {}
      )
    }
  }

  private static var clipboardPreviewImage: NSImage {
    NSImage(size: NSSize(width: 640, height: 320), flipped: false) { rect in
      NSColor(calibratedRed: 0.08, green: 0.10, blue: 0.14, alpha: 1).setFill()
      rect.fill()

      let inset = rect.insetBy(dx: 42, dy: 36)
      NSColor(calibratedRed: 0.98, green: 0.66, blue: 0.18, alpha: 1).setFill()
      NSBezierPath(roundedRect: inset, xRadius: 28, yRadius: 28).fill()

      let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.monospacedSystemFont(ofSize: 30, weight: .semibold),
        .foregroundColor: NSColor.black,
      ]
      NSString(string: "Supaterm clipboard preview").draw(
        at: NSPoint(x: 76, y: 142),
        withAttributes: attributes
      )
      return true
    }
  }

  static var migratedNativeAlertApplicationIcon: NSImage {
    NSImage(size: NSSize(width: 512, height: 512), flipped: false) { rect in
      NSColor(calibratedWhite: 0.08, alpha: 1).setFill()
      NSBezierPath(roundedRect: rect, xRadius: 112, yRadius: 112).fill()

      let bolt = NSBezierPath()
      bolt.move(to: NSPoint(x: 298, y: 42))
      bolt.line(to: NSPoint(x: 110, y: 286))
      bolt.line(to: NSPoint(x: 224, y: 286))
      bolt.line(to: NSPoint(x: 174, y: 470))
      bolt.line(to: NSPoint(x: 402, y: 202))
      bolt.line(to: NSPoint(x: 282, y: 202))
      bolt.close()
      NSColor(calibratedRed: 0.98, green: 0.66, blue: 0.18, alpha: 1).setFill()
      bolt.fill()
      return true
    }
  }

  private static func uuid(_ value: String) -> UUID {
    UUID(uuidString: value)!
  }
}
