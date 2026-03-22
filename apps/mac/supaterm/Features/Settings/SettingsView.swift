import AppKit
import ComposableArchitecture
import SwiftUI

struct SettingsView: View {
  let store: StoreOf<SettingsFeature>

  @Environment(\.colorScheme) private var colorScheme

  private var palette: TerminalPalette {
    TerminalPalette(colorScheme: colorScheme)
  }

  private var displayVersion: String {
    let version = AppBuild.version
    let buildNumber = AppBuild.buildNumber
    switch (version.isEmpty, buildNumber.isEmpty) {
    case (false, false):
      return "\(version) (\(buildNumber))"
    case (false, true):
      return version
    case (true, false):
      return buildNumber
    case (true, true):
      return "Preview"
    }
  }

  var body: some View {
    HStack(spacing: 0) {
      SettingsTabRail(
        store: store,
        palette: palette
      )

      Rectangle()
        .fill(palette.detailStroke)
        .frame(width: 1)

      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          SettingsHeader(
            title: store.selectedTab.title,
            detail: store.selectedTab.detail,
            palette: palette
          )

          currentTabContent
        }
        .padding(28)
        .frame(maxWidth: .infinity, alignment: .topLeading)
      }
      .background(contentBackground)
    }
    .frame(minWidth: 720, minHeight: 520)
    .background(windowBackground)
  }

  @ViewBuilder
  private var currentTabContent: some View {
    switch store.selectedTab {
    case .general:
      generalTab
    case .updates:
      updatesTab
    case .about:
      aboutTab
    }
  }

  private var generalTab: some View {
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .top, spacing: 18) {
        generalHeroCard
          .frame(width: 260)

        generalCards
      }

      VStack(alignment: .leading, spacing: 18) {
        generalHeroCard
        generalCards
      }
    }
  }

  private var updatesTab: some View {
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .top, spacing: 18) {
        updatesHeroCard
          .frame(width: 260)

        updatesCards
      }

      VStack(alignment: .leading, spacing: 18) {
        updatesHeroCard
        updatesCards
      }
    }
  }

  private var aboutTab: some View {
    ViewThatFits(in: .horizontal) {
      HStack(alignment: .top, spacing: 18) {
        aboutHeroCard
          .frame(width: 260)

        aboutCards
      }

      VStack(alignment: .leading, spacing: 18) {
        aboutHeroCard
        aboutCards
      }
    }
  }

  private var generalHeroCard: some View {
    SettingsHeroCard(
      palette: palette,
      accent: [palette.sky.opacity(0.32), palette.mint.opacity(0.28), palette.clearFill],
      badge: AnyView(AppIconBadge()),
      eyebrow: "Workspace defaults",
      title: "Shape the window before the logic lands.",
      detail:
        """
        This first pass establishes the layout, spacing, and hierarchy for Supaterm settings
        without storing any preferences yet.
        """
    )
  }

  private var generalCards: some View {
    VStack(alignment: .leading, spacing: 18) {
      SettingsSectionCard(
        palette: palette,
        title: "Startup",
        detail: "Launch and restore behavior"
      ) {
        SettingsToggleRow(
          palette: palette,
          title: "Confirm before quitting",
          detail: "Keep Supaterm from closing without a final confirmation.",
          isOn: true
        )
        SettingsToggleRow(
          palette: palette,
          title: "Restore previous workspace",
          detail: "Rebuild the last terminal layout when the app opens.",
          isOn: false
        )
        SettingsToggleRow(
          palette: palette,
          title: "Open a fresh tab on launch",
          detail: "Start each new session with an empty workspace.",
          isOn: true
        )
      }

      SettingsSectionCard(
        palette: palette,
        title: "Appearance",
        detail: "Window chrome and density"
      ) {
        SettingsPickerRow(
          palette: palette,
          title: "Window style",
          detail: "Choose how much chrome surrounds the terminal content.",
          value: "System"
        )
        SettingsPickerRow(
          palette: palette,
          title: "Sidebar density",
          detail: "Control how much space the tab chrome consumes.",
          value: "Comfortable"
        )
        SettingsPickerRow(
          palette: palette,
          title: "Accent palette",
          detail: "Set the tone used across the window chrome.",
          value: "Warm"
        )
      }

      SettingsSectionCard(
        palette: palette,
        title: "Behavior",
        detail: "Defaults for shell sessions"
      ) {
        SettingsPickerRow(
          palette: palette,
          title: "Default shell",
          detail: "Pick the shell profile used for new panes.",
          value: "Login shell"
        )
        SettingsPickerRow(
          palette: palette,
          title: "Tab placement",
          detail: "Control where new tabs appear in the strip.",
          value: "Next to current"
        )
        SettingsToggleRow(
          palette: palette,
          title: "Keep focus in the terminal",
          detail: "Prefer the active pane when the window becomes key again.",
          isOn: true
        )
      }
    }
  }

  private var updatesHeroCard: some View {
    SettingsHeroCard(
      palette: palette,
      accent: [palette.amber.opacity(0.3), palette.coral.opacity(0.24), palette.clearFill],
      badge: AnyView(
        Image(systemName: "arrow.trianglehead.clockwise")
          .font(.system(size: 28, weight: .medium))
          .foregroundStyle(palette.primaryText)
          .accessibilityHidden(true)
      ),
      eyebrow: "Release flow",
      title: "Present now, wire later.",
      detail:
        """
        The existing update engine remains in the terminal window for now. This screen is the
        stable landing zone for future update controls.
        """
    )
  }

  private var updatesCards: some View {
    VStack(alignment: .leading, spacing: 18) {
      SettingsSectionCard(
        palette: palette,
        title: "Status",
        detail: "Current release context"
      ) {
        SettingsValueRow(
          palette: palette,
          title: "Current version",
          detail: "The build bundled in this app.",
          value: displayVersion
        )
        SettingsValueRow(
          palette: palette,
          title: "Release channel",
          detail: "Which appcast stream the window will eventually observe.",
          value: "Stable"
        )
        SettingsValueRow(
          palette: palette,
          title: "Last checked",
          detail: "No settings-window integration has been connected yet.",
          value: "Not connected"
        )
      }

      SettingsSectionCard(
        palette: palette,
        title: "Automation",
        detail: "Background and install behavior"
      ) {
        SettingsToggleRow(
          palette: palette,
          title: "Check automatically",
          detail: "Look for releases in the background.",
          isOn: true
        )
        SettingsToggleRow(
          palette: palette,
          title: "Download in the background",
          detail: "Prepare a relaunch when an update is ready.",
          isOn: true
        )
        SettingsPickerRow(
          palette: palette,
          title: "Install timing",
          detail: "Choose when Supaterm should apply downloaded releases.",
          value: "On relaunch"
        )
      }

      SettingsSectionCard(
        palette: palette,
        title: "Actions",
        detail: "Placeholder affordances"
      ) {
        Button("Check for Updates...") {}
          .buttonStyle(SettingsPrimaryButtonStyle(palette: palette))
          .disabled(true)

        SettingsCallout(
          palette: palette,
          symbol: "doc.text",
          title: "Release notes",
          detail: "Release notes will appear here once this screen is connected to the update runtime."
        )
      }
    }
  }

  private var aboutHeroCard: some View {
    SettingsHeroCard(
      palette: palette,
      accent: [palette.violet.opacity(0.28), palette.sky.opacity(0.24), palette.clearFill],
      badge: AnyView(AppIconBadge()),
      eyebrow: "Supaterm",
      title: appName,
      detail: "A focused terminal for shaping panes, tabs, and workspaces around how you actually work."
    )
  }

  private var aboutCards: some View {
    VStack(alignment: .leading, spacing: 18) {
      SettingsSectionCard(
        palette: palette,
        title: "Build",
        detail: "Bundled application metadata"
      ) {
        SettingsValueRow(
          palette: palette,
          title: "Version",
          detail: "Marketing version and build number from the app bundle.",
          value: displayVersion
        )
        SettingsValueRow(
          palette: palette,
          title: "Platform",
          detail: "Minimum supported operating system.",
          value: "macOS 26+"
        )
      }

      SettingsSectionCard(
        palette: palette,
        title: "Engine",
        detail: "Runtime foundations"
      ) {
        SettingsValueRow(
          palette: palette,
          title: "Terminal engine",
          detail: "The terminal runtime embedded inside Supaterm.",
          value: "GhosttyKit"
        )
        SettingsValueRow(
          palette: palette,
          title: "Architecture",
          detail: "Application state and side effects.",
          value: "The Composable Architecture"
        )
        SettingsValueRow(
          palette: palette,
          title: "License",
          detail: "Packaging and distribution details.",
          value: "Details coming soon"
        )
      }

      SettingsSectionCard(
        palette: palette,
        title: "Links",
        detail: "External references"
      ) {
        SettingsLinkRow(
          palette: palette,
          title: "Website",
          detail: "Product home and downloads.",
          label: "supaterm.com",
          destination: URL(string: "https://supaterm.com")!
        )
      }
    }
  }

  private var appName: String {
    let keys = ["CFBundleDisplayName", "CFBundleName"]
    for key in keys {
      if let value = Bundle.main.object(forInfoDictionaryKey: key) as? String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
          return trimmed
        }
      }
    }
    return ProcessInfo.processInfo.processName
  }

  private var windowBackground: some View {
    LinearGradient(
      colors: [
        palette.detailBackground,
        palette.detailBackground.opacity(0.94),
        palette.clearFill.opacity(0.5),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }

  private var contentBackground: some View {
    LinearGradient(
      colors: [
        palette.clearFill.opacity(0.24),
        palette.detailBackground.opacity(0.04),
      ],
      startPoint: .topLeading,
      endPoint: .bottomTrailing
    )
  }
}

private struct SettingsHeader: View {
  let title: String
  let detail: String
  let palette: TerminalPalette

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(.system(size: 30, weight: .semibold, design: .rounded))
        .foregroundStyle(palette.primaryText)

      Text(detail)
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(palette.secondaryText)
    }
  }
}

private struct SettingsTabRail: View {
  let store: StoreOf<SettingsFeature>
  let palette: TerminalPalette

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 12) {
        AppIconBadge()

        VStack(alignment: .leading, spacing: 2) {
          Text("Supaterm")
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .foregroundStyle(palette.primaryText)

          Text("Settings")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(palette.secondaryText)
        }
      }

      VStack(alignment: .leading, spacing: 6) {
        ForEach(SettingsFeature.Tab.allCases, id: \.self) { tab in
          SettingsTabButton(
            palette: palette,
            isSelected: store.selectedTab == tab,
            tab: tab
          ) {
            withAnimation(SwiftUI.Animation.easeInOut(duration: 0.16)) {
              _ = store.send(.tabSelected(tab))
            }
          }
        }
      }

      Spacer()

      SettingsCallout(
        palette: palette,
        symbol: "wand.and.stars.inverse",
        title: "TCA shell",
        detail: "This window is app-global and independent from the per-window terminal store."
      )
    }
    .padding(20)
    .frame(width: 220)
    .frame(maxHeight: .infinity, alignment: .topLeading)
    .background {
      Rectangle()
        .fill(palette.clearFill)
        .opacity(0.35)
    }
  }
}

private struct SettingsTabButton: View {
  let palette: TerminalPalette
  let isSelected: Bool
  let tab: SettingsFeature.Tab
  let action: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 12) {
        Image(systemName: tab.symbol)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(iconColor)
          .frame(width: 18)
          .accessibilityHidden(true)

        VStack(alignment: .leading, spacing: 1) {
          Text(tab.title)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(textColor)

          Text(tab.detail)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(subtextColor)
            .lineLimit(1)
        }

        Spacer(minLength: 0)
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 11)
      .background(background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .stroke(border, lineWidth: 1)
      }
      .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    .buttonStyle(.plain)
    .onHover { hovering in
      isHovering = hovering
    }
  }

  private var background: Color {
    if isSelected {
      return palette.selectedFill
    }
    if isHovering {
      return palette.rowFill
    }
    return .clear
  }

  private var border: Color {
    isSelected ? palette.selectionStroke : .clear
  }

  private var iconColor: Color {
    isSelected ? palette.selectedIcon : palette.primaryText
  }

  private var textColor: Color {
    isSelected ? palette.selectedText : palette.primaryText
  }

  private var subtextColor: Color {
    isSelected ? palette.selectedText.opacity(0.68) : palette.secondaryText
  }
}

private struct SettingsHeroCard: View {
  let palette: TerminalPalette
  let accent: [Color]
  let badge: AnyView
  let eyebrow: String
  let title: String
  let detail: String

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      badge
        .frame(width: 56, height: 56)

      Text(eyebrow.uppercased())
        .font(.system(size: 11, weight: .bold, design: .rounded))
        .tracking(1.2)
        .foregroundStyle(palette.secondaryText)

      Text(title)
        .font(.system(size: 24, weight: .semibold, design: .rounded))
        .foregroundStyle(palette.primaryText)

      Text(detail)
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(palette.secondaryText)
        .fixedSize(horizontal: false, vertical: true)

      Spacer(minLength: 0)
    }
    .padding(22)
    .frame(maxWidth: .infinity, minHeight: 220, alignment: .topLeading)
    .background(
      LinearGradient(
        colors: accent,
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      ),
      in: RoundedRectangle(cornerRadius: 26, style: .continuous)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 26, style: .continuous)
        .stroke(palette.detailStroke, lineWidth: 1)
    }
  }
}

private struct SettingsSectionCard<Content: View>: View {
  let palette: TerminalPalette
  let title: String
  let detail: String
  let content: Content

  init(
    palette: TerminalPalette,
    title: String,
    detail: String,
    @ViewBuilder content: () -> Content
  ) {
    self.palette = palette
    self.title = title
    self.detail = detail
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.system(size: 16, weight: .semibold, design: .rounded))
          .foregroundStyle(palette.primaryText)

        Text(detail)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(palette.secondaryText)
      }

      VStack(alignment: .leading, spacing: 14) {
        content
      }
    }
    .padding(20)
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .background(palette.clearFill.opacity(0.56), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 22, style: .continuous)
        .stroke(palette.detailStroke, lineWidth: 1)
    }
  }
}

private struct SettingsToggleRow: View {
  let palette: TerminalPalette
  let title: String
  let detail: String
  let isOn: Bool

  var body: some View {
    Toggle(isOn: .constant(isOn)) {
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(palette.primaryText)

        Text(detail)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(palette.secondaryText)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .disabled(true)
  }
}

private struct SettingsPickerRow: View {
  let palette: TerminalPalette
  let title: String
  let detail: String
  let value: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 14) {
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(palette.primaryText)

        Text(detail)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(palette.secondaryText)
          .fixedSize(horizontal: false, vertical: true)
      }

      Spacer(minLength: 12)

      Picker(title, selection: .constant(value)) {
        Text(value).tag(value)
      }
      .labelsHidden()
      .pickerStyle(.menu)
      .frame(width: 170)
      .disabled(true)
    }
  }
}

private struct SettingsValueRow: View {
  let palette: TerminalPalette
  let title: String
  let detail: String
  let value: String

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(palette.primaryText)

        Text(detail)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(palette.secondaryText)
          .fixedSize(horizontal: false, vertical: true)
      }

      Spacer(minLength: 12)

      Text(value)
        .font(.system(size: 12, weight: .semibold, design: .monospaced))
        .foregroundStyle(palette.primaryText)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(palette.rowFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .textSelection(.enabled)
    }
  }
}

private struct SettingsLinkRow: View {
  let palette: TerminalPalette
  let title: String
  let detail: String
  let label: String
  let destination: URL

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(palette.primaryText)

        Text(detail)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(palette.secondaryText)
          .fixedSize(horizontal: false, vertical: true)
      }

      Spacer(minLength: 12)

      Link(destination: destination) {
        HStack(spacing: 6) {
          Text(label)
          Image(systemName: "arrow.up.right")
            .accessibilityHidden(true)
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(palette.primaryText)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(palette.rowFill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
      }
      .buttonStyle(.plain)
    }
  }
}

private struct SettingsCallout: View {
  let palette: TerminalPalette
  let symbol: String
  let title: String
  let detail: String

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: symbol)
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(palette.primaryText)
        .frame(width: 24, height: 24)
        .background(palette.rowFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(palette.primaryText)

        Text(detail)
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(palette.secondaryText)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(palette.rowFill, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
  }
}

private struct AppIconBadge: View {
  var body: some View {
    Image(nsImage: NSApp.applicationIconImage)
      .resizable()
      .scaledToFit()
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
      .accessibilityHidden(true)
  }
}

private struct SettingsPrimaryButtonStyle: ButtonStyle {
  let palette: TerminalPalette

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 13, weight: .semibold))
      .foregroundStyle(palette.selectedText)
      .padding(.horizontal, 14)
      .padding(.vertical, 9)
      .background(background(configuration: configuration), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .opacity(configuration.isPressed ? 0.9 : 1)
  }

  private func background(configuration: Configuration) -> Color {
    if configuration.isPressed {
      return palette.selectedFill.opacity(0.92)
    }
    return palette.selectedFill
  }
}
