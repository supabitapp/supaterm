import AppKit
import Carbon.HIToolbox
import Foundation
import GhosttyKit
import SupatermCLIShared
import SupatermSupport

enum GhosttyInputChunk: Equatable {
  case key(SupatermInputKey)
  case text(String)
}

enum GhosttyOpenURLKind: Equatable {
  case unknown
  case text
  case html
  case osc8

  init(_ value: ghostty_action_open_url_kind_e) {
    switch value {
    case GHOSTTY_ACTION_OPEN_URL_KIND_TEXT:
      self = .text
    case GHOSTTY_ACTION_OPEN_URL_KIND_HTML:
      self = .html
    case GHOSTTY_ACTION_OPEN_URL_KIND_OSC8:
      self = .osc8
    default:
      self = .unknown
    }
  }
}

struct GhosttyOpenURLRequest: Equatable {
  let kind: GhosttyOpenURLKind
  let value: String

  var url: URL {
    if let candidate = URL(string: value), candidate.scheme != nil {
      return candidate
    }
    return URL(filePath: NSString(string: value).standardizingPath)
  }
}

func ghosttyOpenURLRequest(from action: ghostty_action_open_url_s) -> GhosttyOpenURLRequest? {
  guard let pointer = action.url, action.len > 0 else { return nil }
  let data = Data(bytes: pointer, count: Int(action.len))
  guard let value = String(data: data, encoding: .utf8) else { return nil }
  return GhosttyOpenURLRequest(kind: GhosttyOpenURLKind(action.kind), value: value)
}

func ghosttyInputKey(for scalar: UnicodeScalar) -> SupatermInputKey? {
  switch scalar.value {
  case 0x03:
    return .ctrlC
  case 0x04:
    return .ctrlD
  case 0x09:
    return .tab
  case 0x0A, 0x0D:
    return .enter
  case 0x0C:
    return .ctrlL
  case 0x1A:
    return .ctrlZ
  case 0x1B:
    return .escape
  case 0x7F:
    return .backspace
  default:
    return nil
  }
}

func ghosttyInputChunks(_ text: String) -> [GhosttyInputChunk] {
  guard !text.isEmpty else { return [] }

  var chunks: [GhosttyInputChunk] = []
  var bufferedText = ""
  bufferedText.reserveCapacity(text.count)

  func flushBufferedText() {
    guard !bufferedText.isEmpty else { return }
    chunks.append(.text(bufferedText))
    bufferedText.removeAll(keepingCapacity: true)
  }

  for scalar in text.unicodeScalars {
    if let key = ghosttyInputKey(for: scalar) {
      flushBufferedText()
      chunks.append(.key(key))
    } else {
      bufferedText.unicodeScalars.append(scalar)
    }
  }

  flushBufferedText()
  return chunks
}

@MainActor
final class GhosttySurfaceBridge {
  let state = GhosttySurfaceState()
  private let findPasteboard: NSPasteboard
  private let sendAction: (Selector) -> Bool
  private let openURL: (URL) -> Bool
  var surface: ghostty_surface_t?
  weak var surfaceView: GhosttySurfaceView?
  var onTitleChange: ((String) -> Void)?
  var onTitleOverrideChange: (() -> Void)?
  var onPromptSurfaceTitle: (() -> Void)?
  var onPromptTabTitle: (() -> Void)?
  var onPathChange: (() -> Void)?
  var onTabTitleChange: ((String?) -> Bool)?
  var onCopyTitleToClipboard: (() -> Bool)?
  var onSplitAction: ((GhosttySplitAction) -> Bool)?
  var onCloseRequest: ((Bool) -> Void)?
  var onNewTab: (() -> Bool)?
  var canMoveToNewTab: (() -> Bool)?
  var onMoveToNewTab: (() -> Bool)?
  var onCloseTab: ((ghostty_action_close_tab_mode_e) -> Bool)?
  var onGotoTab: ((ghostty_action_goto_tab_e) -> Bool)?
  var onMoveTab: ((ghostty_action_move_tab_s) -> Bool)?
  var onCommandPaletteToggle: (() -> Bool)?
  var onCommandFinished: (() -> Void)?
  var onChildExited: (() -> Bool)?
  var onProgressReport: ((ghostty_action_progress_report_state_e) -> Void)?
  var onDesktopNotification: ((String, String) -> Void)?
  var onStateChange: (() -> Void)?
  private var progressResetTask: Task<Void, Never>?

  init(
    findPasteboard: NSPasteboard = NSPasteboard(name: .find),
    openURL: @escaping (URL) -> Bool = { NSWorkspace.shared.open($0) },
    sendAction: @escaping (Selector) -> Bool = {
      NSApp.sendAction($0, to: nil, from: nil)
    }
  ) {
    self.findPasteboard = findPasteboard
    self.openURL = openURL
    self.sendAction = sendAction
  }

  deinit {
    progressResetTask?.cancel()
  }

  func titleDidChange(from previousDisplayTitle: String?) {
    let title = state.effectiveDisplayTitle
    guard title != previousDisplayTitle else { return }
    onTitleChange?(title ?? "")
    if let surfaceView {
      NSAccessibility.post(element: surfaceView, notification: .titleChanged)
    }
  }

  func clearMouseOverLink() {
    state.mouseOverLink = nil
  }

  func updateSurfaceConfig(_ config: GhosttySurfaceConfig) {
    state.derivedConfig = config
    if let oscBackgroundColor = state.oscBackgroundColor,
      oscBackgroundColor != config.backgroundColor
    {
      state.oscBackgroundColor = nil
    }
    surfaceView?.surfaceAppearanceDidChange()
  }

  func handleAction(target _: ghostty_target_s, action: ghostty_action_s) -> Bool {
    if action.tag == GHOSTTY_ACTION_SELECTION_CHANGED {
      guard let surfaceView else { return false }
      surfaceView.selectionDidChange()
      return true
    }
    if action.tag == GHOSTTY_ACTION_SHELL_READY {
      surfaceView?.shellDidBecomeReady()
      return true
    }
    if let handled = handleAppAction(action) { return handled }
    if let handled = handleSplitAction(action) { return handled }
    if let handled = handleTabAction(action) { return handled }
    if handleTitleAndPath(action) {
      onStateChange?()
      return true
    }
    if handleCommandStatus(action) {
      onStateChange?()
      if action.tag == GHOSTTY_ACTION_SHOW_CHILD_EXITED {
        let handled = onChildExited?() ?? false
        if handled {
          onCloseRequest = nil
        }
        return handled
      }
      return true
    }
    if handleMouseAndLink(action) {
      onStateChange?()
      return true
    }
    if handleSearchAndScroll(action) {
      onStateChange?()
      return true
    }
    if handleSizeAndKey(action) {
      onStateChange?()
      return true
    }
    if handleConfigAndShell(action) {
      onStateChange?()
      return true
    }
    return false
  }

  private func handleTabAction(_ action: ghostty_action_s) -> Bool? {
    switch action.tag {
    case GHOSTTY_ACTION_SET_TAB_TITLE:
      let title = string(from: action.action.set_tab_title.title) ?? ""
      return onTabTitleChange?(title.isEmpty ? nil : title) ?? false

    case GHOSTTY_ACTION_COPY_TITLE_TO_CLIPBOARD:
      return onCopyTitleToClipboard?() ?? false

    default:
      return nil
    }
  }

  func sendText(_ text: String) {
    guard let surface else { return }
    for chunk in ghosttyInputChunks(text) {
      switch chunk {
      case .key(let key):
        sendKey(key, surface: surface)
      case .text(let value):
        sendText(value, surface: surface)
      }
    }
  }

  func sendKey(_ key: SupatermInputKey) {
    guard let surface else { return }
    sendKey(key, surface: surface)
  }

  func submitText(_ text: String) {
    guard let surface else { return }
    let length = text.utf8.count
    text.withCString { pointer in
      ghostty_surface_text(surface, pointer, UInt(length))
    }
    sendKey(.enter, surface: surface)
  }

  private func sendText(_ text: String, surface: ghostty_surface_t) {
    sendKeyEvent(surface: surface, keycode: 0, text: text)
  }

  private func sendKey(_ key: SupatermInputKey, surface: ghostty_surface_t) {
    switch key {
    case .enter:
      sendKeyEvent(surface: surface, keycode: UInt32(kVK_Return))
    case .tab:
      sendKeyEvent(surface: surface, keycode: UInt32(kVK_Tab))
    case .escape:
      sendKeyEvent(surface: surface, keycode: UInt32(kVK_Escape))
    case .backspace:
      sendKeyEvent(surface: surface, keycode: UInt32(kVK_Delete))
    case .ctrlC:
      sendKeyEvent(
        surface: surface,
        keycode: UInt32(kVK_ANSI_C),
        mods: GHOSTTY_MODS_CTRL,
        unshiftedCodepoint: "c"
      )
    case .ctrlD:
      sendKeyEvent(
        surface: surface,
        keycode: UInt32(kVK_ANSI_D),
        mods: GHOSTTY_MODS_CTRL,
        unshiftedCodepoint: "d"
      )
    case .ctrlL:
      sendKeyEvent(
        surface: surface,
        keycode: UInt32(kVK_ANSI_L),
        mods: GHOSTTY_MODS_CTRL,
        unshiftedCodepoint: "l"
      )
    case .ctrlZ:
      sendKeyEvent(
        surface: surface,
        keycode: UInt32(kVK_ANSI_Z),
        mods: GHOSTTY_MODS_CTRL,
        unshiftedCodepoint: "z"
      )
    }
  }

  private func sendKeyEvent(
    surface: ghostty_surface_t,
    keycode: UInt32,
    mods: ghostty_input_mods_e = GHOSTTY_MODS_NONE,
    unshiftedCodepoint: UnicodeScalar? = nil,
    text: String? = nil
  ) {
    var event = ghostty_input_key_s()
    event.action = GHOSTTY_ACTION_PRESS
    event.keycode = keycode
    event.mods = mods
    event.composing = false
    event.consumed_mods = GHOSTTY_MODS_NONE
    event.unshifted_codepoint = unshiftedCodepoint?.value ?? 0
    if let text {
      text.withCString { ptr in
        event.text = ptr
        _ = ghostty_surface_key(surface, event)
      }
    } else {
      event.text = nil
      _ = ghostty_surface_key(surface, event)
    }
  }

  func closeSurface(processAlive: Bool) {
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.close.ghosttyCallback",
      fields: [
        "surfaceID=\(SupatermLog.uuid(surfaceView?.id))",
        "processAlive=\(processAlive)",
        "hasSurfaceView=\(surfaceView != nil)",
        "hasCloseHandler=\(onCloseRequest != nil)",
      ]
    )
    onCloseRequest?(processAlive)
  }

  private func handleAppAction(_ action: ghostty_action_s) -> Bool? {
    if let result = handleSharedAppAction(action) {
      return result
    }
    switch action.tag {
    case GHOSTTY_ACTION_NEW_TAB:
      return onNewTab?() ?? false
    case GHOSTTY_ACTION_CLOSE_TAB:
      return onCloseTab?(action.action.close_tab_mode) ?? false
    case GHOSTTY_ACTION_CLOSE_WINDOW:
      guard let window = surfaceView?.window else { return false }
      window.performClose(nil)
      return true
    case GHOSTTY_ACTION_GOTO_TAB:
      return onGotoTab?(action.action.goto_tab) ?? false
    case GHOSTTY_ACTION_MOVE_TAB:
      return onMoveTab?(action.action.move_tab) ?? false
    case GHOSTTY_ACTION_TOGGLE_COMMAND_PALETTE:
      return onCommandPaletteToggle?() ?? false
    case GHOSTTY_ACTION_GOTO_WINDOW,
      GHOSTTY_ACTION_TOGGLE_QUICK_TERMINAL:
      return false
    case GHOSTTY_ACTION_UNDO:
      return sendAction(#selector(UndoManager.undo))
    case GHOSTTY_ACTION_REDO:
      return sendAction(#selector(UndoManager.redo))
    default:
      return nil
    }
  }

  private func handleSharedAppAction(_ action: ghostty_action_s) -> Bool? {
    switch action.tag {
    case GHOSTTY_ACTION_NEW_WINDOW,
      GHOSTTY_ACTION_CLOSE_ALL_WINDOWS,
      GHOSTTY_ACTION_OPEN_CONFIG,
      GHOSTTY_ACTION_QUIT,
      GHOSTTY_ACTION_TOGGLE_VISIBILITY:
      return GhosttyRuntime.dispatchAppAction(action)
    default:
      return nil
    }
  }

  private func handleSplitAction(_ action: ghostty_action_s) -> Bool? {
    switch action.tag {
    case GHOSTTY_ACTION_NEW_SPLIT:
      let direction = splitDirection(from: action.action.new_split)
      guard let direction else { return false }
      return onSplitAction?(.newSplit(direction: direction)) ?? false

    case GHOSTTY_ACTION_GOTO_SPLIT:
      let direction = focusDirection(from: action.action.goto_split)
      guard let direction else { return false }
      return onSplitAction?(.gotoSplit(direction: direction)) ?? false

    case GHOSTTY_ACTION_RESIZE_SPLIT:
      let resize = action.action.resize_split
      let direction = resizeDirection(from: resize.direction)
      guard let direction else { return false }
      return onSplitAction?(.resizeSplit(direction: direction, amount: resize.amount)) ?? false

    case GHOSTTY_ACTION_EQUALIZE_SPLITS:
      return onSplitAction?(.equalizeSplits) ?? false

    case GHOSTTY_ACTION_TOGGLE_SPLIT_ZOOM:
      return onSplitAction?(.toggleSplitZoom) ?? false

    default:
      return nil
    }
  }

  private func splitDirection(from value: ghostty_action_split_direction_e) -> GhosttySplitAction
    .NewDirection?
  {
    switch value {
    case GHOSTTY_SPLIT_DIRECTION_LEFT:
      return .left
    case GHOSTTY_SPLIT_DIRECTION_RIGHT:
      return .right
    case GHOSTTY_SPLIT_DIRECTION_UP:
      return .up
    case GHOSTTY_SPLIT_DIRECTION_DOWN:
      return .down
    default:
      return nil
    }
  }

  private func focusDirection(from value: ghostty_action_goto_split_e) -> GhosttySplitAction
    .FocusDirection?
  {
    switch value {
    case GHOSTTY_GOTO_SPLIT_PREVIOUS:
      return .previous
    case GHOSTTY_GOTO_SPLIT_NEXT:
      return .next
    case GHOSTTY_GOTO_SPLIT_LEFT:
      return .left
    case GHOSTTY_GOTO_SPLIT_RIGHT:
      return .right
    case GHOSTTY_GOTO_SPLIT_UP:
      return .up
    case GHOSTTY_GOTO_SPLIT_DOWN:
      return .down
    default:
      return nil
    }
  }

  private func resizeDirection(from value: ghostty_action_resize_split_direction_e)
    -> GhosttySplitAction.ResizeDirection?
  {
    switch value {
    case GHOSTTY_RESIZE_SPLIT_LEFT:
      return .left
    case GHOSTTY_RESIZE_SPLIT_RIGHT:
      return .right
    case GHOSTTY_RESIZE_SPLIT_UP:
      return .up
    case GHOSTTY_RESIZE_SPLIT_DOWN:
      return .down
    default:
      return nil
    }
  }

  private func handleTitleAndPath(_ action: ghostty_action_s) -> Bool {
    switch action.tag {
    case GHOSTTY_ACTION_SET_TITLE:
      let previousTitle = state.effectiveDisplayTitle
      guard let title = string(from: action.action.set_title.title) else { return false }
      state.title = title
      titleDidChange(from: previousTitle)
      return true

    case GHOSTTY_ACTION_PROMPT_TITLE:
      switch action.action.prompt_title {
      case GHOSTTY_PROMPT_TITLE_SURFACE:
        guard let onPromptSurfaceTitle else { return false }
        onPromptSurfaceTitle()
      case GHOSTTY_PROMPT_TITLE_TAB:
        guard let onPromptTabTitle else { return false }
        onPromptTabTitle()
      default:
        return false
      }
      return true

    case GHOSTTY_ACTION_PWD:
      state.pwd = string(from: action.action.pwd.pwd)
      onPathChange?()
      if let surfaceView {
        NSAccessibility.post(element: surfaceView, notification: .valueChanged)
        let title = state.effectiveTitle ?? ""
        if title.isEmpty {
          NSAccessibility.post(element: surfaceView, notification: .titleChanged)
        }
      }
      return true

    case GHOSTTY_ACTION_DESKTOP_NOTIFICATION:
      let note = action.action.desktop_notification
      let title = string(from: note.title) ?? ""
      let body = string(from: note.body) ?? ""
      guard !(title.isEmpty && body.isEmpty) else { return true }
      guard let onDesktopNotification else { return false }
      onDesktopNotification(title, body)
      return true

    default:
      return false
    }
  }

  private func handleCommandStatus(_ action: ghostty_action_s) -> Bool {
    switch action.tag {
    case GHOSTTY_ACTION_PROGRESS_REPORT:
      let report = action.action.progress_report
      state.agentOSCProgress = agentOSCProgress(report)
      state.agentOSCProgressProcessGroupID = surfaceView?.foregroundProcessGroupID
      guard
        state.progressStyleEnabled,
        report.state != GHOSTTY_PROGRESS_STATE_REMOVE
      else {
        clearProgressReport()
        return true
      }
      progressResetTask?.cancel()
      state.progressState = report.state
      state.progressValue = report.progress == -1 ? nil : Int(report.progress)
      progressResetTask = Task { @MainActor [weak self] in
        try? await ContinuousClock().sleep(for: .seconds(15))
        guard let self, !Task.isCancelled else { return }
        self.clearProgressReport()
      }
      onProgressReport?(report.state)
      return true

    case GHOSTTY_ACTION_COMMAND_FINISHED:
      let info = action.action.command_finished
      state.commandExitCode = info.exit_code == -1 ? nil : Int(info.exit_code)
      state.commandDuration = info.duration
      onCommandFinished?()
      return true

    case GHOSTTY_ACTION_SHOW_CHILD_EXITED:
      let info = action.action.child_exited
      state.childExitCode = info.exit_code
      state.childExitTimeMs = info.timetime_ms
      return true

    case GHOSTTY_ACTION_READONLY:
      state.readOnly = action.action.readonly
      return true

    case GHOSTTY_ACTION_RING_BELL:
      state.bellCount += 1
      return true

    default:
      return false
    }
  }

  private func agentOSCProgress(_ report: ghostty_action_progress_report_s) -> String {
    let stateCode: Int
    switch report.state {
    case GHOSTTY_PROGRESS_STATE_REMOVE:
      stateCode = 0
    case GHOSTTY_PROGRESS_STATE_SET:
      stateCode = 1
    case GHOSTTY_PROGRESS_STATE_ERROR:
      stateCode = 2
    case GHOSTTY_PROGRESS_STATE_INDETERMINATE:
      stateCode = 3
    case GHOSTTY_PROGRESS_STATE_PAUSE:
      stateCode = 4
    default:
      return ""
    }
    if report.progress >= 0 {
      return "4;\(stateCode);\(report.progress)"
    }
    return "4;\(stateCode);"
  }

  private func clearProgressReport() {
    progressResetTask?.cancel()
    progressResetTask = nil
    state.progressState = nil
    state.progressValue = nil
    onProgressReport?(GHOSTTY_PROGRESS_STATE_REMOVE)
  }

  private func handleMouseAndLink(_ action: ghostty_action_s) -> Bool {
    switch action.tag {
    case GHOSTTY_ACTION_MOUSE_SHAPE:
      guard let surfaceView else { return false }
      surfaceView.setMouseShape(action.action.mouse_shape)
      return true

    case GHOSTTY_ACTION_MOUSE_VISIBILITY:
      guard let surfaceView else { return false }
      surfaceView.setMouseVisibility(action.action.mouse_visibility == GHOSTTY_MOUSE_VISIBLE)
      return true

    case GHOSTTY_ACTION_MOUSE_OVER_LINK:
      let link = action.action.mouse_over_link
      state.mouseOverLink = string(from: link.url, length: link.len)
      return true

    case GHOSTTY_ACTION_RENDERER_HEALTH:
      state.failure =
        action.action.renderer_health == GHOSTTY_RENDERER_HEALTH_HEALTHY
        ? nil
        : .rendererUnavailable
      return true

    case GHOSTTY_ACTION_OPEN_URL:
      let openUrl = action.action.open_url
      guard let request = ghosttyOpenURLRequest(from: openUrl) else {
        return GhosttyOpenURLKind(openUrl.kind) == .osc8
      }
      guard request.kind == .osc8 else {
        _ = openURL(request.url)
        return true
      }

      let target = GhosttyUntrustedURL(request.value)
      switch target.decision {
      case .allow(let url):
        _ = openURL(url)
      case .confirm(let url):
        GhosttyUntrustedURLAlert.presentConfirmation(
          for: url,
          displayString: target.displayString
        )
      case .deny(let reason):
        GhosttyUntrustedURLAlert.presentBlock(
          reason: reason,
          displayString: target.displayString
        )
      }
      return true

    default:
      return false
    }
  }

  private func handleSearchAndScroll(_ action: ghostty_action_s) -> Bool {
    switch action.tag {
    case GHOSTTY_ACTION_SCROLLBAR:
      guard let surfaceView else { return false }
      let scroll = action.action.scrollbar
      surfaceView.updateScrollbar(
        total: scroll.total,
        offset: scroll.offset,
        length: scroll.len
      )
      return true

    case GHOSTTY_ACTION_START_SEARCH:
      let needle = string(from: action.action.start_search.needle) ?? ""
      if !needle.isEmpty {
        setSearchNeedle(needle)
      } else if state.searchNeedle == nil {
        state.searchNeedle = ""
        restoreSearchNeedle()
      }
      state.searchTotal = nil
      state.searchSelected = nil
      state.searchFocusCount += 1
      return true

    case GHOSTTY_ACTION_END_SEARCH:
      endSearch()
      return true

    case GHOSTTY_ACTION_SEARCH_TOTAL:
      let total = action.action.search_total.total
      state.searchTotal = total < 0 ? nil : Int(total)
      return true

    case GHOSTTY_ACTION_SEARCH_SELECTED:
      let selected = action.action.search_selected.selected
      state.searchSelected = selected < 0 ? nil : Int(selected)
      return true

    default:
      return false
    }
  }

  private func endSearch() {
    surfaceView?.requestFocus()
    state.searchNeedle = nil
    state.searchTotal = nil
    state.searchSelected = nil
  }

  func setSearchNeedle(_ needle: String) {
    if state.searchNeedle != needle {
      state.searchNeedle = needle
    }
    findPasteboard.clearContents()
    _ = findPasteboard.setString(needle, forType: .string)
  }

  func restoreSearchNeedle() {
    guard
      let currentNeedle = state.searchNeedle,
      let pasteboardNeedle = findPasteboard.string(forType: .string),
      pasteboardNeedle != currentNeedle
    else { return }
    state.searchNeedle = pasteboardNeedle
    state.searchSelectionRequestCount += 1
  }

  private func handleSizeAndKey(_ action: ghostty_action_s) -> Bool {
    switch action.tag {
    case GHOSTTY_ACTION_CELL_SIZE:
      guard let surfaceView else { return false }
      let cell = action.action.cell_size
      surfaceView.updateCellSize(width: cell.width, height: cell.height)
      return true

    case GHOSTTY_ACTION_KEY_SEQUENCE:
      state.keySequenceActive = action.action.key_sequence.active
      return true

    case GHOSTTY_ACTION_KEY_TABLE:
      let table = action.action.key_table
      switch table.tag {
      case GHOSTTY_KEY_TABLE_ACTIVATE:
        state.keyTableDepth += 1
      case GHOSTTY_KEY_TABLE_DEACTIVATE:
        if state.keyTableDepth > 0 {
          state.keyTableDepth -= 1
        }
      case GHOSTTY_KEY_TABLE_DEACTIVATE_ALL:
        state.keyTableDepth = 0
      default:
        return false
      }
      return true

    default:
      return false
    }
  }

  private func handleConfigAndShell(_ action: ghostty_action_s) -> Bool {
    switch action.tag {
    case GHOSTTY_ACTION_CONFIG_CHANGE:
      updateSurfaceConfig(GhosttySurfaceConfig(action.action.config_change.config))
      return true

    case GHOSTTY_ACTION_COLOR_CHANGE:
      let change = action.action.color_change
      if change.kind == GHOSTTY_ACTION_COLOR_KIND_BACKGROUND {
        state.oscBackgroundColor = NSColor(
          red: Double(change.r) / 255,
          green: Double(change.g) / 255,
          blue: Double(change.b) / 255,
          alpha: 1
        )
        surfaceView?.surfaceAppearanceDidChange()
      }
      return true

    case GHOSTTY_ACTION_SECURE_INPUT:
      guard let surfaceView else { return false }
      switch action.action.secure_input {
      case GHOSTTY_SECURE_INPUT_ON:
        surfaceView.passwordInput = true
      case GHOSTTY_SECURE_INPUT_OFF:
        surfaceView.passwordInput = false
      case GHOSTTY_SECURE_INPUT_TOGGLE:
        surfaceView.passwordInput.toggle()
      default:
        return false
      }
      return true

    default:
      return false
    }
  }

  private func string(from pointer: UnsafePointer<CChar>?) -> String? {
    guard let pointer else { return nil }
    return String(cString: pointer)
  }

  private func string(from pointer: UnsafePointer<CChar>?, length: Int) -> String? {
    guard let pointer, length > 0 else { return nil }
    let data = Data(bytes: pointer, count: length)
    return String(data: data, encoding: .utf8)
  }

}
