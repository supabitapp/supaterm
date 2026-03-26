import Sharing
import SwiftUI

struct SettingsTabContentView: View {
  let tab: SettingsFeature.Tab

  var body: some View {
    switch tab {
    case .general:
      SettingsGeneralView()
    case .updates, .about:
      SettingsPlaceholderView(tab: tab)
    }
  }
}

private struct SettingsGeneralView: View {
  @Shared(.appPrefs) private var appPrefs = .default
  @Environment(\.colorScheme) private var colorScheme

  private var appearanceMode: Binding<AppearanceMode> {
    Binding(
      get: { appPrefs.appearanceMode },
      set: { newValue in
        $appPrefs.withLock {
          $0.appearanceMode = newValue
        }
      }
    )
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 22) {
      Text("Appearance")
        .font(.title2.weight(.semibold))

      VStack(alignment: .leading, spacing: 20) {
        HStack(spacing: 16) {
          let selectedMode = appearanceMode.wrappedValue
          ForEach(AppearanceMode.allCases) { mode in
            AppearanceOptionCardView(
              mode: mode,
              isSelected: mode == selectedMode
            ) {
              appearanceMode.wrappedValue = mode
            }
          }
        }

        Rectangle()
          .fill(dividerColor)
          .frame(height: 1)

        VStack(alignment: .leading, spacing: 8) {
          Text("Terminal theming follows Ghostty config")
          Text("For example, add the following line to `~/.config/ghostty/config`")
          Text("theme = light:Monokai Pro Light Sun,dark:Dimmed Monokai")
            .monospaced()
        }
        .font(.body.weight(.semibold))
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
      }
      .padding(20)
      .background(sectionBackground)
      .clipShape(.rect(cornerRadius: 24))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(24)
  }

  private var dividerColor: Color {
    colorScheme == .dark ? Color.white.opacity(0.08) : Color.black.opacity(0.08)
  }

  private var sectionBackground: Color {
    colorScheme == .dark
      ? Color(red: 0.18, green: 0.19, blue: 0.2)
      : Color.white
  }
}

private struct AppearanceOptionCardView: View {
  @Environment(\.colorScheme) private var colorScheme
  let mode: AppearanceMode
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(spacing: 18) {
        ZStack {
          RoundedRectangle(cornerRadius: 22)
            .fill(mode.previewBackground)

          VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 10) {
              Circle()
                .fill(Color(red: 1, green: 0.27, blue: 0.32))
                .frame(width: 12, height: 12)
              Circle()
                .fill(Color(red: 1, green: 0.83, blue: 0.02))
                .frame(width: 12, height: 12)
              Circle()
                .fill(Color(red: 0.22, green: 0.79, blue: 0.33))
                .frame(width: 12, height: 12)
            }

            RoundedRectangle(cornerRadius: 6)
              .fill(mode.previewPrimary)
              .frame(height: 20)

            RoundedRectangle(cornerRadius: 6)
              .fill(mode.previewSecondary)
              .frame(height: 16)

            RoundedRectangle(cornerRadius: 6)
              .fill(mode.previewAccent)
              .frame(width: 128, height: 14)
          }
          .padding(32)
        }
        .aspectRatio(1.18, contentMode: .fit)

        Text(mode.title)
          .font(.title3.weight(.semibold))
      }
      .frame(maxWidth: .infinity)
      .padding(18)
      .background(cardBackground)
      .clipShape(.rect(cornerRadius: 22))
      .overlay {
        RoundedRectangle(cornerRadius: 22)
          .stroke(cardStroke, lineWidth: isSelected ? 4 : 1.5)
      }
    }
    .buttonStyle(.plain)
  }

  private var cardBackground: Color {
    if isSelected {
      return Color(red: 0.18, green: 0.25, blue: 0.37)
    }
    return colorScheme == .dark
      ? Color.white.opacity(0.03)
      : Color.black.opacity(0.03)
  }

  private var cardStroke: Color {
    if isSelected {
      return .accentColor
    }
    return colorScheme == .dark
      ? Color.white.opacity(0.18)
      : Color.black.opacity(0.12)
  }
}

private struct SettingsPlaceholderView: View {
  let tab: SettingsFeature.Tab

  var body: some View {
    VStack(spacing: 12) {
      Text(tab.title)
        .font(.title2.weight(.semibold))

      Text(tab.detail)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(24)
  }
}
