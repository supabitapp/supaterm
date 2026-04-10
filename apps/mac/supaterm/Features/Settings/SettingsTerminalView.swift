import ComposableArchitecture
import SwiftUI

struct SettingsTerminalView: View {
  let store: StoreOf<SettingsFeature>

  private let defaultFontFamilyTag = "__supaterm_default_font_family__"

  private var controlsDisabled: Bool {
    store.terminal.isApplying || store.terminal.isLoading
  }

  private var fontFamilySelection: Binding<String> {
    Binding(
      get: { store.terminal.fontFamily ?? defaultFontFamilyTag },
      set: { newValue in
        _ = store.send(
          .terminalFontFamilySelected(
            newValue == defaultFontFamilyTag ? nil : newValue
          )
        )
      }
    )
  }

  private var fontSizeSelection: Binding<Double> {
    Binding(
      get: { store.terminal.fontSize },
      set: { newValue in
        _ = store.send(.terminalFontSizeChanged(newValue))
      }
    )
  }

  private var lightThemeSelection: Binding<String?> {
    Binding(
      get: { store.terminal.lightTheme },
      set: { newValue in
        _ = store.send(.terminalLightThemeSelected(newValue))
      }
    )
  }

  private var darkThemeSelection: Binding<String?> {
    Binding(
      get: { store.terminal.darkTheme },
      set: { newValue in
        _ = store.send(.terminalDarkThemeSelected(newValue))
      }
    )
  }

  private var confirmCloseSurfaceSelection: Binding<GhosttyTerminalCloseConfirmation> {
    Binding(
      get: { store.terminal.confirmCloseSurface },
      set: { newValue in
        _ = store.send(.terminalConfirmCloseSurfaceSelected(newValue))
      }
    )
  }

  private var availableLightThemes: [String] {
    themeOptions(
      from: store.terminal.availableLightThemes,
      selected: store.terminal.lightTheme
    )
  }

  private var availableDarkThemes: [String] {
    themeOptions(
      from: store.terminal.availableDarkThemes,
      selected: store.terminal.darkTheme
    )
  }

  private var resolvedConfigPath: String {
    if store.terminal.configPath.isEmpty {
      GhosttySupport.configFileLocations().preferred.path
    } else {
      store.terminal.configPath
    }
  }

  var body: some View {
    Form {
      Section {
        if let warningMessage = store.terminal.warningMessage {
          Text(warningMessage)
            .font(.callout)
            .foregroundStyle(.orange)
            .fixedSize(horizontal: false, vertical: true)
        }

        if let errorMessage = store.terminal.errorMessage {
          Text(errorMessage)
            .font(.callout)
            .foregroundStyle(.red)
            .fixedSize(horizontal: false, vertical: true)
        }
      }

      Section {
        LabeledContent("Light/Dark Theme") {
          HStack(spacing: 12) {
            themePicker(
              selection: lightThemeSelection,
              themes: availableLightThemes,
              selectedTheme: store.terminal.lightTheme
            )
            themePicker(
              selection: darkThemeSelection,
              themes: availableDarkThemes,
              selectedTheme: store.terminal.darkTheme
            )
          }
          .frame(maxWidth: .infinity, alignment: .trailing)
        }

        Picker(selection: fontFamilySelection) {
          Text("Default").tag(defaultFontFamilyTag)
          ForEach(store.terminal.availableFontFamilies, id: \.self) { fontFamily in
            Text(fontFamily).tag(fontFamily)
          }
        } label: {
          SettingsRowLabel(
            title: "Font"
          )
        }
        .disabled(controlsDisabled)

        LabeledContent {
          HStack(spacing: 12) {
            Spacer(minLength: 0)

            Text("\(Int(store.terminal.fontSize.rounded())) pt")
              .font(.callout.monospaced())
              .frame(minWidth: 64, alignment: .trailing)

            Stepper("", value: fontSizeSelection, in: 6...72, step: 1)
              .labelsHidden()
              .fixedSize()
          }
          .disabled(controlsDisabled)
        } label: {
          SettingsRowLabel(
            title: "Font Size"
          )
        }

        Picker(selection: confirmCloseSurfaceSelection) {
          ForEach(GhosttyTerminalCloseConfirmation.allCases) { option in
            Text(option.title).tag(option)
          }
        } label: {
          SettingsRowLabel(
            title: "Close Confirmation",
            subtitle: "Choose when closing a tab, split, or window asks for confirmation."
          )
        }
        .disabled(controlsDisabled)
      }

      Section {
        VStack(alignment: .leading, spacing: 8) {
          Text("Config File")
            .font(.callout.weight(.semibold))

          Text(resolvedConfigPath)
            .font(.callout.monospaced())
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
        }
      } footer: {
        VStack(alignment: .leading, spacing: 4) {
          Text("Supaterm reads and writes your Ghostty config, so changes here stay in sync with Ghostty itself.")
          Text("Some configurations require an app restart to take effect.")
        }
      }
    }
    .navigationTitle("Terminal")
    .settingsFormLayout()
  }

  private func themeOptions(from themes: [String], selected: String?) -> [String] {
    guard let selected, !selected.isEmpty else {
      return themes
    }
    guard !themes.contains(selected) else {
      return themes
    }
    return [selected] + themes
  }

  @ViewBuilder
  private func themePicker(
    selection: Binding<String?>,
    themes: [String],
    selectedTheme: String?
  ) -> some View {
    Picker(selection: selection) {
      if selectedTheme == nil {
        Text("Select Theme").tag(Optional<String>.none)
      }
      ForEach(themes, id: \.self) { theme in
        Text(theme).tag(theme as String?)
      }
    } label: {
      EmptyView()
    }
    .labelsHidden()
    .disabled(controlsDisabled)
  }
}
