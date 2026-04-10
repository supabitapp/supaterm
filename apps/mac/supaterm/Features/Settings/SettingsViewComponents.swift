import SupatermCLIShared
import SwiftUI

struct SettingsToggleRow: View {
  let title: String
  let subtitle: String
  let isOn: Binding<Bool>

  var body: some View {
    Toggle(isOn: isOn) {
      SettingsRowLabel(
        title: title,
        subtitle: subtitle
      )
    }
  }
}

struct SettingsCompactToggleRow: View {
  let title: String
  let isOn: Binding<Bool>

  var body: some View {
    Toggle(isOn: isOn) {
      Text(title)
        .font(.callout)
    }
    .controlSize(.small)
    .toggleStyle(.checkbox)
  }
}

struct AppearanceOptionCardView: View {
  let mode: AppearanceMode
  let isSelected: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(spacing: 4) {
        Image(mode.imageName)
          .resizable()
          .interpolation(.high)
          .aspectRatio(contentMode: .fit)
          .clipShape(.rect(cornerRadius: 8))
          .accessibilityLabel(mode.title)
          .overlay {
            RoundedRectangle(cornerRadius: 8)
              .strokeBorder(
                isSelected ? Color.accentColor : .clear,
                lineWidth: 2
              )
          }
        Text(mode.title)
          .font(.callout)
          .foregroundStyle(isSelected ? .primary : .secondary)
      }
    }
    .buttonStyle(.plain)
  }
}

struct SettingsRowLabel: View {
  let title: String
  let subtitle: String?

  init(
    title: String,
    subtitle: String? = nil
  ) {
    self.title = title
    self.subtitle = subtitle
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title)
      if let subtitle {
        Text(subtitle)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }
}

struct SettingsSurfaceCard<Content: View>: View {
  let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
    content
      .padding(24)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .fill(Color(nsColor: .controlBackgroundColor))
      )
      .overlay {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
          .strokeBorder(.quaternary, lineWidth: 1)
      }
  }
}

extension View {
  func settingsFormLayout() -> some View {
    formStyle(.grouped)
      .padding(.top, -20)
      .padding(.leading, -8)
      .padding(.trailing, -6)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}
