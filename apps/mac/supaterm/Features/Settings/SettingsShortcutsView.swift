import AppKit
import Carbon.HIToolbox
import ComposableArchitecture
import SupatermSupport
import SupatermUI
import SwiftUI

private struct ShortcutTableItem: Identifiable {
  enum Kind {
    case group(SupatermShortcutCategory)
    case shortcut(SupatermShortcut)
  }

  let id: String
  let kind: Kind
  let children: [ShortcutTableItem]?
}

struct SettingsShortcutsView: View {
  let store: StoreOf<SettingsFeature>

  @State private var expandedGroups = Set(SupatermShortcuts.groups.map(\.id))
  @State private var isRestoreConfirmationPresented = false
  @State private var keyboardLayoutRefreshID = UUID()
  @State private var searchText = ""

  private var filteredGroups: [SupatermShortcutGroup] {
    guard !searchText.isEmpty else {
      return SupatermShortcuts.groups
    }
    let matcher = ShortcutSearchMatcher(query: searchText)
    return SupatermShortcuts.groups.compactMap { group in
      let shortcuts = group.shortcuts.filter { shortcut in
        matcher.matches(shortcut, overrides: store.shortcutOverrides)
      }
      guard !shortcuts.isEmpty else {
        return nil
      }
      return SupatermShortcutGroup(category: group.category, shortcuts: shortcuts)
    }
  }

  private var tableItems: [ShortcutTableItem] {
    filteredGroups.map { group in
      ShortcutTableItem(
        id: group.id,
        kind: .group(group.category),
        children: group.shortcuts.map { shortcut in
          ShortcutTableItem(
            id: shortcut.displayName,
            kind: .shortcut(shortcut),
            children: nil
          )
        }
      )
    }
  }

  private var warnings: [SupatermShortcutID: String] {
    SupatermShortcuts.warnings(
      overrides: store.shortcutOverrides,
      terminalDisplays: store.terminalShortcutDisplays
    )
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      shortcutsTable
      Text("Shortcuts not listed here, like ⌘1–9 for switching tabs, are managed by your Ghostty config.")
        .font(.callout)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
    .searchable(text: $searchText, placement: .toolbar, prompt: "Search")
    .navigationTitle("Shortcuts")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          isRestoreConfirmationPresented = true
        } label: {
          Image(systemName: "arrow.counterclockwise")
            .accessibilityLabel("Restore Defaults")
        }
        .help("Restore all shortcuts to their defaults.")
        .disabled(store.shortcutOverrides.isEmpty)
        .confirmationDialog(
          "Restore all keyboard shortcuts to their defaults?",
          isPresented: $isRestoreConfirmationPresented,
          titleVisibility: .visible
        ) {
          Button("Restore Defaults", role: .destructive) {
            _ = store.send(.restoreShortcutDefaultsButtonTapped)
          }
        }
      }
    }
  }

  private var shortcutsTable: some View {
    Table(of: ShortcutTableItem.self) {
      TableColumn("Name") { item in
        ShortcutNameCell(
          item: item,
          overrides: store.shortcutOverrides
        )
      }
      TableColumn("Hotkey") { item in
        ShortcutHotkeyCell(
          item: item,
          store: store,
          warning: warnings
        )
        .id(keyboardLayoutRefreshID)
      }
      .width(min: 100, ideal: 140, max: 220)
      TableColumn("Enabled") { item in
        ShortcutEnabledCell(item: item, store: store)
      }
      .width(min: 60, max: 90)
    } rows: {
      ForEach(tableItems) { group in
        DisclosureTableRow(
          group,
          isExpanded: Binding(
            get: { expandedGroups.contains(group.id) },
            set: { isExpanded in
              if isExpanded {
                expandedGroups.insert(group.id)
              } else {
                expandedGroups.remove(group.id)
              }
            }
          )
        ) {
          ForEach(group.children ?? []) { child in
            TableRow(child)
          }
        }
      }
    }
    .alternatingRowBackgrounds()
    .padding(.leading, -6)
    .onReceive(
      NotificationCenter.default.publisher(
        for: NSTextInputContext.keyboardSelectionDidChangeNotification
      )
    ) { _ in
      keyboardLayoutRefreshID = UUID()
    }
  }
}

private struct ShortcutNameCell: View {
  let item: ShortcutTableItem
  let overrides: [SupatermShortcutID: SupatermShortcutOverride]

  var body: some View {
    switch item.kind {
    case .group(let category):
      Text(category.displayName)
        .padding(.vertical, 4)
    case .shortcut(let shortcut):
      Text(shortcut.displayName)
        .foregroundStyle(
          overrides[shortcut.id]?.isEnabled ?? true
            ? .primary
            : .secondary
        )
        .padding(.vertical, 4)
    }
  }
}

private struct ShortcutHotkeyCell: View {
  let item: ShortcutTableItem
  let store: StoreOf<SettingsFeature>
  let warning: [SupatermShortcutID: String]

  var body: some View {
    switch item.kind {
    case .group:
      EmptyView()
    case .shortcut(let shortcut):
      ShortcutHotkeyButton(
        shortcut: shortcut,
        override: store.shortcutOverrides[shortcut.id],
        warning: warning[shortcut.id],
        onRecorded: { override in
          _ = store.send(.shortcutRecorded(shortcut.id, override))
        },
        onReset: {
          _ = store.send(.shortcutResetButtonTapped(shortcut.id))
        },
        conflict: { override in
          SupatermShortcuts.conflict(
            for: SupatermShortcutBinding(override),
            replacing: shortcut.id,
            overrides: store.shortcutOverrides,
            terminalDisplays: store.terminalShortcutDisplays
          )
        }
      )
    }
  }
}

private struct ShortcutEnabledCell: View {
  let item: ShortcutTableItem
  let store: StoreOf<SettingsFeature>

  var body: some View {
    switch item.kind {
    case .group:
      EmptyView()
    case .shortcut(let shortcut):
      Toggle(
        "",
        isOn: Binding(
          get: { store.shortcutOverrides[shortcut.id]?.isEnabled ?? true },
          set: { isEnabled in
            _ = store.send(.shortcutEnabledChanged(shortcut.id, isEnabled))
          }
        )
      )
      .toggleStyle(.checkbox)
      .labelsHidden()
      .frame(maxWidth: .infinity, alignment: .center)
    }
  }
}

private struct ShortcutHotkeyButton: View {
  let shortcut: SupatermShortcut
  let override: SupatermShortcutOverride?
  let warning: String?
  let onRecorded: (SupatermShortcutOverride) -> Void
  let onReset: () -> Void
  let conflict: (SupatermShortcutOverride) -> String?

  @State private var isRecording = false

  private var isEnabled: Bool {
    override?.isEnabled ?? true
  }

  private var display: String {
    override.map(SupatermShortcutBinding.init)?.display
      ?? shortcut.defaultBinding.display
  }

  var body: some View {
    if isEnabled {
      Button {
        isRecording = true
      } label: {
        HStack(spacing: 4) {
          Text(display)
            .foregroundStyle(override == nil ? .secondary : .primary)
          if let warning {
            Image(systemName: "exclamationmark.triangle.fill")
              .font(.caption2)
              .foregroundStyle(.yellow)
              .accessibilityLabel("Warning")
              .help(warning)
          }
          Spacer()
        }
        .frame(maxWidth: .infinity)
        .contentShape(.rect)
      }
      .buttonStyle(.borderless)
      .popover(isPresented: $isRecording) {
        ShortcutRecorderPopover(
          onRecorded: onRecorded,
          onCancelled: { isRecording = false },
          conflict: conflict
        )
      }
      .contextMenu {
        Button("Change Shortcut…") {
          isRecording = true
        }
        Divider()
        Button("Reset to Default") {
          onReset()
        }
        .disabled(override == nil)
      }
    } else {
      Text("—")
        .foregroundStyle(.tertiary)
    }
  }
}

private struct ShortcutKeycap: View {
  let symbol: String

  var body: some View {
    Text(symbol)
      .font(.body.weight(.medium).monospaced())
      .padding(.horizontal, 6)
      .frame(minWidth: 28, minHeight: 28)
      .background(.quaternary, in: .rect(cornerRadius: 6))
  }
}

private struct ShortcutKeycaps: View {
  let symbols: [String]

  var body: some View {
    HStack(spacing: 3) {
      ForEach(Array(symbols.enumerated()), id: \.offset) { _, symbol in
        ShortcutKeycap(symbol: symbol)
      }
    }
    .frame(minHeight: 28)
  }
}

private struct ShortcutRecorderPopover: View {
  let onRecorded: (SupatermShortcutOverride) -> Void
  let onCancelled: () -> Void
  let conflict: (SupatermShortcutOverride) -> String?

  private enum Status {
    case recording
    case recorded(SupatermShortcutOverride)
    case conflict(SupatermShortcutOverride, String)
  }

  @State private var activeModifiers: SupatermShortcutOverride.Modifiers = []
  @State private var dismissTask: Task<Void, Never>?
  @State private var status = Status.recording

  var body: some View {
    PopoverSurface(theme: .system, contentPadding: 0) {
      VStack(spacing: 8) {
        switch status {
        case .recording:
          if activeModifiers.isEmpty {
            HStack(spacing: 4) {
              Text("e.g.")
                .foregroundStyle(.tertiary)
              ShortcutKeycap(symbol: "⇧")
              ShortcutKeycap(symbol: "⌘")
              ShortcutKeycap(symbol: "Space")
            }
            .opacity(0.4)
          } else {
            ShortcutKeycaps(symbols: modifierSymbols)
          }
          Text("Recording…")
            .font(.caption)
            .foregroundStyle(.secondary)
        case .recorded(let override):
          ShortcutKeycaps(symbols: SupatermShortcutBinding(override).displaySymbols)
          Label("Recorded", systemImage: "checkmark.circle.fill")
            .font(.caption)
            .foregroundStyle(.green)
        case .conflict(let override, let name):
          ShortcutKeycaps(symbols: SupatermShortcutBinding(override).displaySymbols)
          Text("Already used by \(name).")
            .font(.caption)
            .foregroundStyle(.red)
        }
      }
      .fixedSize()
      .padding(.horizontal, 32)
      .padding(.vertical, 16)
      .overlay(alignment: .topTrailing) {
        Button {
          onCancelled()
        } label: {
          Image(systemName: "xmark")
            .font(.caption2)
            .accessibilityLabel("Cancel")
        }
        .buttonStyle(.plain)
        .padding(8)
      }
      .background {
        if case .recording = status {
          ShortcutRecorderView(
            onRecorded: handleRecorded,
            onCancelled: onCancelled,
            onModifiersChanged: { activeModifiers = $0 }
          )
          .frame(width: 0, height: 0)
        }
      }
    }
    .onDisappear {
      dismissTask?.cancel()
    }
  }

  private var modifierSymbols: [String] {
    var symbols: [String] = []
    if activeModifiers.contains(.command) { symbols.append("⌘") }
    if activeModifiers.contains(.shift) { symbols.append("⇧") }
    if activeModifiers.contains(.option) { symbols.append("⌥") }
    if activeModifiers.contains(.control) { symbols.append("⌃") }
    return symbols
  }

  private func handleRecorded(_ override: SupatermShortcutOverride) {
    dismissTask?.cancel()
    if let name = conflict(override) {
      status = .conflict(override, name)
      dismissTask = Task { @MainActor in
        try? await Task.sleep(for: .seconds(1.5))
        guard !Task.isCancelled else { return }
        status = .recording
      }
    } else {
      status = .recorded(override)
      onRecorded(override)
      dismissTask = Task { @MainActor in
        try? await Task.sleep(for: .milliseconds(700))
        guard !Task.isCancelled else { return }
        onCancelled()
      }
    }
  }
}

private struct ShortcutRecorderView: NSViewRepresentable {
  let onRecorded: (SupatermShortcutOverride) -> Void
  let onCancelled: () -> Void
  let onModifiersChanged: (SupatermShortcutOverride.Modifiers) -> Void

  func makeNSView(context: Context) -> ShortcutRecorderNSView {
    let view = ShortcutRecorderNSView()
    view.onRecorded = onRecorded
    view.onCancelled = onCancelled
    view.onModifiersChanged = onModifiersChanged
    return view
  }

  func updateNSView(_ view: ShortcutRecorderNSView, context: Context) {
    view.onRecorded = onRecorded
    view.onCancelled = onCancelled
    view.onModifiersChanged = onModifiersChanged
    view.window?.makeFirstResponder(view)
  }
}

private final class ShortcutRecorderNSView: NSView {
  var onRecorded: ((SupatermShortcutOverride) -> Void)?
  var onCancelled: (() -> Void)?
  var onModifiersChanged: ((SupatermShortcutOverride.Modifiers) -> Void)?

  override var acceptsFirstResponder: Bool {
    true
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    window?.makeFirstResponder(self)
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    keyDown(with: event)
    return true
  }

  override func keyDown(with event: NSEvent) {
    guard !event.isARepeat else {
      return
    }
    if event.keyCode == UInt16(kVK_Escape) {
      onCancelled?()
      return
    }

    let modifiers = Self.modifiers(from: event)
    guard !modifiers.isEmpty else {
      return
    }
    onRecorded?(
      SupatermShortcutOverride(
        keyCode: event.keyCode,
        modifiers: modifiers
      )
    )
  }

  override func flagsChanged(with event: NSEvent) {
    onModifiersChanged?(Self.modifiers(from: event))
  }

  private static func modifiers(
    from event: NSEvent
  ) -> SupatermShortcutOverride.Modifiers {
    let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    var modifiers: SupatermShortcutOverride.Modifiers = []
    if flags.contains(.command) { modifiers.insert(.command) }
    if flags.contains(.option) { modifiers.insert(.option) }
    if flags.contains(.control) { modifiers.insert(.control) }
    if flags.contains(.shift) { modifiers.insert(.shift) }
    return modifiers
  }
}
