import AppKit
import SwiftUI

public enum DialogFieldState: Sendable {
  case enabled
  case disabled
  case invalid(String)
}

public struct DialogTextField: View {
  private let title: String
  private let prompt: String
  private let text: Binding<String>
  private let state: DialogFieldState
  private let theme: SurfaceTheme
  private let accessibilityIdentifier: String?

  public init(
    _ title: String,
    text: Binding<String>,
    prompt: String = "",
    state: DialogFieldState = .enabled,
    theme: SurfaceTheme = .system,
    accessibilityIdentifier: String? = nil
  ) {
    self.title = title
    self.text = text
    self.prompt = prompt
    self.state = state
    self.theme = theme
    self.accessibilityIdentifier = accessibilityIdentifier
  }

  public var body: some View {
    DialogFieldShell(title: title, state: state, theme: theme) {
      TextField(prompt, text: text)
        .textFieldStyle(.plain)
        .accessibilityIdentifier(accessibilityIdentifier ?? "dialog.field.\(title)")
    }
  }
}

public struct DialogSecureField: View {
  private let title: String
  private let prompt: String
  private let text: Binding<String>
  private let state: DialogFieldState
  private let theme: SurfaceTheme

  public init(
    _ title: String,
    text: Binding<String>,
    prompt: String = "",
    state: DialogFieldState = .enabled,
    theme: SurfaceTheme = .system
  ) {
    self.title = title
    self.text = text
    self.prompt = prompt
    self.state = state
    self.theme = theme
  }

  public var body: some View {
    DialogFieldShell(title: title, state: state, theme: theme) {
      SecureField(prompt, text: text)
        .textFieldStyle(.plain)
        .accessibilityIdentifier("dialog.secure-field.\(title)")
    }
  }
}

public struct DialogMultilineField: View {
  private let title: String
  private let text: Binding<String>
  private let maximumCharacterCount: Int?
  private let minimumHeight: CGFloat
  private let state: DialogFieldState
  private let theme: SurfaceTheme

  public init(
    _ title: String,
    text: Binding<String>,
    maximumCharacterCount: Int? = nil,
    minimumHeight: CGFloat = 88,
    state: DialogFieldState = .enabled,
    theme: SurfaceTheme = .system
  ) {
    self.title = title
    self.text = text
    self.maximumCharacterCount = maximumCharacterCount
    self.minimumHeight = minimumHeight
    self.state = state
    self.theme = theme
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      DialogFieldShell(title: title, state: state, theme: theme) {
        TextEditor(text: limitedText)
          .font(.system(size: 13))
          .scrollContentBackground(.hidden)
          .frame(minHeight: minimumHeight)
          .accessibilityIdentifier("dialog.multiline-field.\(title)")
      }

      if let maximumCharacterCount {
        Text("\(text.wrappedValue.count) / \(maximumCharacterCount)")
          .font(.system(size: 10, weight: .medium).monospacedDigit())
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .trailing)
      }
    }
  }

  private var limitedText: Binding<String> {
    Binding(
      get: { text.wrappedValue },
      set: { value in
        text.wrappedValue = maximumCharacterCount.map { String(value.prefix($0)) } ?? value
      }
    )
  }
}

public struct DialogCheckbox: View {
  private let title: String
  private let detail: String?
  private let isOn: Binding<Bool>
  private let theme: SurfaceTheme

  @Environment(\.colorScheme) private var colorScheme

  public init(
    _ title: String,
    detail: String? = nil,
    isOn: Binding<Bool>,
    theme: SurfaceTheme = .system
  ) {
    self.title = title
    self.detail = detail
    self.isOn = isOn
    self.theme = theme
  }

  public var body: some View {
    let colors = theme.colors(for: colorScheme)

    Toggle(isOn: isOn) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(colors.primaryText)
        if let detail {
          Text(detail)
            .font(.system(size: 11))
            .foregroundStyle(colors.secondaryText)
        }
      }
    }
    .toggleStyle(.checkbox)
  }
}

public struct DialogDropdown<Selection: Hashable, Options: View>: View {
  private let title: String
  private let selection: Binding<Selection>
  private let theme: SurfaceTheme
  private let options: Options

  public init(
    _ title: String,
    selection: Binding<Selection>,
    theme: SurfaceTheme = .system,
    @ViewBuilder options: () -> Options
  ) {
    self.title = title
    self.selection = selection
    self.theme = theme
    self.options = options()
  }

  public var body: some View {
    DialogFieldShell(title: title, state: .enabled, theme: theme) {
      Picker(title, selection: selection) {
        options
      }
      .labelsHidden()
      .pickerStyle(.menu)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

public enum DialogOneTimeCodeState: Sendable {
  case editing
  case submitting
}

enum DialogOneTimeCodeValue {
  static func normalized(_ value: String, length: Int) -> String {
    String(value.filter(\.isNumber).prefix(max(0, length)))
  }
}

public struct DialogOneTimeCodeField: View {
  private let title: String
  private let code: Binding<String>
  private let length: Int
  private let state: DialogOneTimeCodeState
  private let theme: SurfaceTheme

  @FocusState private var isFocused: Bool
  @Environment(\.colorScheme) private var colorScheme

  public init(
    _ title: String,
    code: Binding<String>,
    length: Int = 6,
    state: DialogOneTimeCodeState = .editing,
    theme: SurfaceTheme = .system
  ) {
    self.title = title
    self.code = code
    self.length = max(1, length)
    self.state = state
    self.theme = theme
  }

  public var body: some View {
    let colors = theme.colors(for: colorScheme)

    VStack(alignment: .leading, spacing: 7) {
      Text(title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(colors.secondaryText)

      ZStack {
        HStack(spacing: 8) {
          ForEach(0..<length, id: \.self) { index in
            Text(character(at: index))
              .font(.system(size: 18, weight: .semibold).monospacedDigit())
              .foregroundStyle(colors.primaryText)
              .frame(width: 36, height: 42)
              .background(colors.mutedBackground, in: .rect(cornerRadius: 9))
              .overlay {
                RoundedRectangle(cornerRadius: 9)
                  .stroke(index == code.wrappedValue.count && state == .editing ? colors.accent : colors.border)
              }
          }
        }

        TextField("Code", text: normalizedCode)
          .textFieldStyle(.plain)
          .focused($isFocused)
          .opacity(0.01)
          .disabled(state != .editing)
          .accessibilityIdentifier("dialog.one-time-code")
      }

      if state == .submitting {
        DotsSpinner(size: 12, color: colors.accent)
          .frame(maxWidth: .infinity, alignment: .center)
      }
    }
    .contentShape(.rect)
    .onTapGesture {
      guard state == .editing else { return }
      isFocused = true
    }
    .accessibilityAddTraits(.isButton)
  }

  private var normalizedCode: Binding<String> {
    Binding(
      get: { code.wrappedValue },
      set: { code.wrappedValue = DialogOneTimeCodeValue.normalized($0, length: length) }
    )
  }

  private func character(at index: Int) -> String {
    let value = code.wrappedValue
    guard index < value.count else { return "" }
    let characterIndex = value.index(value.startIndex, offsetBy: index)
    return String(value[characterIndex])
  }
}

public struct DialogProgress: View {
  private let title: String
  private let detail: String?
  private let value: Double?
  private let theme: SurfaceTheme

  @Environment(\.colorScheme) private var colorScheme

  public init(
    _ title: String,
    detail: String? = nil,
    value: Double? = nil,
    theme: SurfaceTheme = .system
  ) {
    self.title = title
    self.detail = detail
    self.value = value
    self.theme = theme
  }

  public var body: some View {
    let colors = theme.colors(for: colorScheme)

    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(title)
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(colors.primaryText)
        Spacer()
        if let detail {
          Text(detail)
            .font(.system(size: 11).monospacedDigit())
            .foregroundStyle(colors.secondaryText)
        }
      }

      if let value {
        ProgressView(value: min(max(value, 0), 1))
          .tint(colors.accent)
      } else {
        DotsSpinner(size: 12, color: colors.accent)
      }
    }
  }
}

public struct DialogCountdown: View {
  private let title: String
  private let remaining: Duration
  private let total: Duration
  private let theme: SurfaceTheme

  public init(
    _ title: String,
    remaining: Duration,
    total: Duration,
    theme: SurfaceTheme = .system
  ) {
    self.title = title
    self.remaining = remaining
    self.total = total
    self.theme = theme
  }

  public var body: some View {
    DialogProgress(
      title,
      detail: remaining.formatted(.time(pattern: .minuteSecond)),
      value: progress,
      theme: theme
    )
  }

  private var progress: Double {
    let totalSeconds = total.components.seconds
    guard totalSeconds > 0 else { return 0 }
    return Double(remaining.components.seconds) / Double(totalSeconds)
  }
}

public struct DialogTextPreview: View {
  private let text: String
  private let minimumHeight: CGFloat
  private let maximumHeight: CGFloat
  private let theme: SurfaceTheme
  private let accessibilityIdentifier: String?

  @Environment(\.colorScheme) private var colorScheme

  public init(
    _ text: String,
    minimumHeight: CGFloat = 72,
    maximumHeight: CGFloat = 220,
    theme: SurfaceTheme = .system,
    accessibilityIdentifier: String? = nil
  ) {
    self.text = text
    self.minimumHeight = minimumHeight
    self.maximumHeight = maximumHeight
    self.theme = theme
    self.accessibilityIdentifier = accessibilityIdentifier
  }

  public var body: some View {
    let colors = theme.colors(for: colorScheme)

    DialogTextPreviewRepresentable(
      text: text,
      textColor: NSColor(colors.primaryText)
    )
    .frame(
      minHeight: minimumHeight,
      idealHeight: maximumHeight,
      maxHeight: maximumHeight
    )
    .background(colors.mutedBackground, in: .rect(cornerRadius: 9))
    .overlay {
      RoundedRectangle(cornerRadius: 9)
        .stroke(colors.border)
    }
    .accessibilityIdentifier(accessibilityIdentifier ?? "dialog.text-preview")
  }
}

private struct DialogTextPreviewRepresentable: NSViewRepresentable {
  let text: String
  let textColor: NSColor

  func makeNSView(context: Context) -> NSScrollView {
    let scrollView = NSTextView.scrollableTextView()
    scrollView.hasVerticalScroller = true
    scrollView.hasHorizontalScroller = false
    scrollView.autohidesScrollers = true
    scrollView.drawsBackground = false

    guard let textView = scrollView.documentView as? NSTextView else {
      return scrollView
    }
    textView.drawsBackground = false
    textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
    textView.isEditable = false
    textView.isHorizontallyResizable = false
    textView.isRichText = false
    textView.isSelectable = true
    textView.textContainer?.widthTracksTextView = true
    textView.textContainerInset = NSSize(width: 10, height: 10)
    return scrollView
  }

  func updateNSView(_ scrollView: NSScrollView, context: Context) {
    guard let textView = scrollView.documentView as? NSTextView else { return }
    if textView.string != text {
      textView.string = text
    }
    textView.textColor = textColor
  }
}

private struct DialogFieldShell<Content: View>: View {
  let title: String
  let state: DialogFieldState
  let theme: SurfaceTheme
  @ViewBuilder let content: () -> Content

  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    let colors = theme.colors(for: colorScheme)

    VStack(alignment: .leading, spacing: 7) {
      Text(title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(colors.secondaryText)

      content()
        .font(.system(size: 13))
        .foregroundStyle(colors.primaryText)
        .tint(colors.accent)
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .background(colors.mutedBackground, in: .rect(cornerRadius: 9))
        .overlay {
          RoundedRectangle(cornerRadius: 9)
            .stroke(borderColor(colors: colors), lineWidth: 1)
        }
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.55 : 1)

      if case .invalid(let message) = state {
        Text(message)
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(colors.danger)
      }
    }
  }

  private var isDisabled: Bool {
    if case .disabled = state { true } else { false }
  }

  private func borderColor(colors: SurfaceColors) -> Color {
    if case .invalid = state { colors.danger } else { colors.border }
  }
}
