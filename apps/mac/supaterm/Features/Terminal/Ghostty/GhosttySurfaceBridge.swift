import AppKit
import Carbon.HIToolbox
import Combine
import Foundation
import GhosttyKit
import SupatermCLIShared

enum GhosttyInputChunk: Equatable {
  case key(SupatermInputKey)
  case text(String)
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
  var surface: ghostty_surface_t?
  weak var surfaceView: GhosttySurfaceView?
  var onTitleChange: ((String) -> Void)?
  var onPromptSurfaceTitle: (() -> Void)?
  var onPromptTabTitle: (() -> Void)?
  var onPathChange: (() -> Void)?
  var onTabTitleChange: ((String?) -> Bool)?
  var onCopyTitleToClipboard: (() -> Bool)?
  var onSplitAction: ((GhosttySplitAction) -> Bool)?
  var onCloseRequest: ((Bool) -> Void)?
  var onNewTab: (() -> Bool)?
  var onCloseTab: ((ghostty_action_close_tab_mode_e) -> Bool)?
  var onGotoTab: ((ghostty_action_goto_tab_e) -> Bool)?
  var onMoveTab: ((ghostty_action_move_tab_s) -> Bool)?
  var onCommandPaletteToggle: (() -> Bool)?
  var onCommandFinished: (() -> Void)?
  var onProgressReport: ((ghostty_action_progress_report_state_e) -> Void)?
  var onDesktopNotification: ((String, String) -> Void)?
  var onStateChange: (() -> Void)?
  private var progressResetTask: Task<Void, Never>?
  private var searchNeedleCancellable: AnyCancellable?

  deinit {
    progressResetTask?.cancel()
  }

  func closeSearch() {
    guard state.searchState != nil else { return }
    surfaceView?.requestFocus()
    searchNeedleCancellable?.cancel()
    searchNeedleCancellable = nil
    state.searchState = nil
    surfaceView?.performBindingAction("end_search")
  }

  func titleDidChange(from previousTitle: String?) {
    let title = state.effectiveTitle
    guard title != previousTitle else { return }
    onTitleChange?(title ?? "")
    if let surfaceView {
      NSAccessibility.post(element: surfaceView, notification: .titleChanged)
    }
  }

  func handleAction(target: ghostty_target_s, action: ghostty_action_s) -> Bool {
    if let handled = handleAppAction(action) { return handled }
    if let handled = handleSplitAction(action) { return handled }
    if let handled = handleTabAction(action) { return handled }
    if handleTitleAndPath(action) {
      onStateChange?()
      return false
    }
    if handleCommandStatus(action) {
      onStateChange?()
      return false
    }
    if handleMouseAndLink(action) {
      onStateChange?()
      return false
    }
    if handleSearchAndScroll(action) {
      onStateChange?()
      return false
    }
    if handleSizeAndKey(action) {
      onStateChange?()
      return false
    }
    if handleConfigAndShell(action) {
      onStateChange?()
      return false
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
      sendKeyEvent(surface: surface, keycode: UInt32(kVK_ANSI_C), mods: GHOSTTY_MODS_CTRL)
    case .ctrlD:
      sendKeyEvent(surface: surface, keycode: UInt32(kVK_ANSI_D), mods: GHOSTTY_MODS_CTRL)
    case .ctrlL:
      sendKeyEvent(surface: surface, keycode: UInt32(kVK_ANSI_L), mods: GHOSTTY_MODS_CTRL)
    case .ctrlZ:
      sendKeyEvent(surface: surface, keycode: UInt32(kVK_ANSI_Z), mods: GHOSTTY_MODS_CTRL)
    }
  }

  private func sendKeyEvent(
    surface: ghostty_surface_t,
    keycode: UInt32,
    mods: ghostty_input_mods_e = GHOSTTY_MODS_NONE,
    text: String? = nil
  ) {
    var event = ghostty_input_key_s()
    event.action = GHOSTTY_ACTION_PRESS
    event.keycode = keycode
    event.mods = mods
    event.composing = false
    event.consumed_mods = GHOSTTY_MODS_NONE
    event.unshifted_codepoint = 0
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

  func sendCommand(_ command: String) {
    let finalCommand = command.hasSuffix("\n") ? command : "\(command)\n"
    sendText(finalCommand)
  }

  func closeSurface(processAlive: Bool) {
    onCloseRequest?(processAlive)
  }

  private func handleAppAction(_ action: ghostty_action_s) -> Bool? {
    let performer = NSApp.delegate as? any GhosttyAppActionPerforming
    switch action.tag {
    case GHOSTTY_ACTION_NEW_WINDOW:
      return performer?.performNewWindow() ?? false
    case GHOSTTY_ACTION_NEW_TAB:
      return onNewTab?() ?? false
    case GHOSTTY_ACTION_CLOSE_TAB:
      return onCloseTab?(action.action.close_tab_mode) ?? false
    case GHOSTTY_ACTION_CLOSE_WINDOW:
      guard let window = surfaceView?.window else { return false }
      window.performClose(nil)
      return true
    case GHOSTTY_ACTION_CLOSE_ALL_WINDOWS:
      return performer?.performCloseAllWindows() ?? false
    case GHOSTTY_ACTION_GOTO_TAB:
      return onGotoTab?(action.action.goto_tab) ?? false
    case GHOSTTY_ACTION_MOVE_TAB:
      return onMoveTab?(action.action.move_tab) ?? false
    case GHOSTTY_ACTION_TOGGLE_COMMAND_PALETTE:
      return onCommandPaletteToggle?() ?? false
    case GHOSTTY_ACTION_OPEN_CONFIG:
      return (NSApp.delegate as? any GhosttyOpenConfigPerforming)?.performOpenConfig() ?? false
    case GHOSTTY_ACTION_QUIT:
      return performer?.performQuit() ?? false
    case GHOSTTY_ACTION_GOTO_WINDOW,
      GHOSTTY_ACTION_TOGGLE_QUICK_TERMINAL:
      return false
    case GHOSTTY_ACTION_UNDO:
      NSApp.sendAction(#selector(UndoManager.undo), to: nil, from: nil)
      return true
    case GHOSTTY_ACTION_REDO:
      NSApp.sendAction(#selector(UndoManager.redo), to: nil, from: nil)
      return true
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
      let previousTitle = state.effectiveTitle
      if let title = string(from: action.action.set_title.title) {
        state.title = title
        titleDidChange(from: previousTitle)
      }
      return true

    case GHOSTTY_ACTION_PROMPT_TITLE:
      switch action.action.prompt_title {
      case GHOSTTY_PROMPT_TITLE_SURFACE:
        onPromptSurfaceTitle?()
      case GHOSTTY_PROMPT_TITLE_TAB:
        onPromptTabTitle?()
      default:
        break
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
      onDesktopNotification?(title, body)
      return true

    default:
      return false
    }
  }

  private func handleCommandStatus(_ action: ghostty_action_s) -> Bool {
    switch action.tag {
    case GHOSTTY_ACTION_PROGRESS_REPORT:
      let report = action.action.progress_report
      progressResetTask?.cancel()
      state.progressValue = report.progress == -1 ? nil : Int(report.progress)
      if report.state == GHOSTTY_PROGRESS_STATE_REMOVE {
        state.progressState = nil
        state.progressValue = nil
        progressResetTask = nil
      } else {
        state.progressState = report.state
        progressResetTask = Task { @MainActor [weak self] in
          try? await ContinuousClock().sleep(for: .seconds(15))
          guard let self, !Task.isCancelled else { return }
          self.state.progressState = nil
          self.state.progressValue = nil
          self.onProgressReport?(GHOSTTY_PROGRESS_STATE_REMOVE)
        }
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

  private func handleMouseAndLink(_ action: ghostty_action_s) -> Bool {
    switch action.tag {
    case GHOSTTY_ACTION_MOUSE_SHAPE:
      state.mouseShape = action.action.mouse_shape
      surfaceView?.setMouseShape(action.action.mouse_shape)
      return true

    case GHOSTTY_ACTION_MOUSE_VISIBILITY:
      state.mouseVisibility = action.action.mouse_visibility
      surfaceView?.setMouseVisibility(action.action.mouse_visibility == GHOSTTY_MOUSE_VISIBLE)
      return true

    case GHOSTTY_ACTION_MOUSE_OVER_LINK:
      let link = action.action.mouse_over_link
      state.mouseOverLink = string(from: link.url, length: link.len)
      return true

    case GHOSTTY_ACTION_RENDERER_HEALTH:
      state.rendererHealth = action.action.renderer_health
      return true

    case GHOSTTY_ACTION_OPEN_URL:
      let openUrl = action.action.open_url
      state.openUrlKind = openUrl.kind
      state.openUrl = string(from: openUrl.url, length: openUrl.len)
      if let urlString = state.openUrl, let url = URL(string: urlString) {
        NSWorkspace.shared.open(url)
      }
      return true

    case GHOSTTY_ACTION_COLOR_CHANGE:
      let change = action.action.color_change
      state.colorChangeKind = change.kind
      state.colorChangeR = change.r
      state.colorChangeG = change.g
      state.colorChangeB = change.b
      return true

    default:
      return false
    }
  }

  private func handleSearchAndScroll(_ action: ghostty_action_s) -> Bool {
    switch action.tag {
    case GHOSTTY_ACTION_SCROLLBAR:
      let scroll = action.action.scrollbar
      surfaceView?.updateScrollbar(
        total: scroll.total,
        offset: scroll.offset,
        length: scroll.len
      )
      return true

    case GHOSTTY_ACTION_START_SEARCH:
      let needle = string(from: action.action.start_search.needle) ?? ""
      if let searchState = state.searchState {
        if !needle.isEmpty {
          searchState.needle = needle
        }
        searchState.total = nil
        searchState.selected = nil
      } else {
        let searchState = GhosttySurfaceSearchState(needle: needle)
        bindSearchState(searchState)
        state.searchState = searchState
      }
      NotificationCenter.default.post(name: .ghosttySearchFocus, object: surfaceView)
      return true

    case GHOSTTY_ACTION_END_SEARCH:
      searchNeedleCancellable?.cancel()
      searchNeedleCancellable = nil
      state.searchState = nil
      return true

    case GHOSTTY_ACTION_SEARCH_TOTAL:
      let total = action.action.search_total.total
      state.searchState?.total = total < 0 ? nil : UInt(total)
      return true

    case GHOSTTY_ACTION_SEARCH_SELECTED:
      let selected = action.action.search_selected.selected
      state.searchState?.selected = selected < 0 ? nil : UInt(selected)
      return true

    default:
      return false
    }
  }

  private func bindSearchState(_ searchState: GhosttySurfaceSearchState) {
    searchNeedleCancellable = searchState.$needle
      .removeDuplicates()
      .map { needle -> AnyPublisher<String, Never> in
        if needle.isEmpty || needle.count >= 3 {
          return Just(needle).eraseToAnyPublisher()
        }
        return Just(needle)
          .delay(for: .milliseconds(300), scheduler: DispatchQueue.main)
          .eraseToAnyPublisher()
      }
      .switchToLatest()
      .sink { [weak self] needle in
        self?.surfaceView?.performBindingAction("search:\(needle)")
      }
  }

  private func handleSizeAndKey(_ action: ghostty_action_s) -> Bool {
    switch action.tag {
    case GHOSTTY_ACTION_SIZE_LIMIT:
      let sizeLimit = action.action.size_limit
      state.sizeLimitMinWidth = sizeLimit.min_width
      state.sizeLimitMinHeight = sizeLimit.min_height
      state.sizeLimitMaxWidth = sizeLimit.max_width
      state.sizeLimitMaxHeight = sizeLimit.max_height
      return true

    case GHOSTTY_ACTION_INITIAL_SIZE:
      let initial = action.action.initial_size
      state.initialSizeWidth = initial.width
      state.initialSizeHeight = initial.height
      return true

    case GHOSTTY_ACTION_CELL_SIZE:
      let cell = action.action.cell_size
      surfaceView?.updateCellSize(width: cell.width, height: cell.height)
      return true

    case GHOSTTY_ACTION_RESET_WINDOW_SIZE:
      state.resetWindowSizeCount += 1
      return true

    case GHOSTTY_ACTION_KEY_SEQUENCE:
      let seq = action.action.key_sequence
      state.keySequenceActive = seq.active
      state.keySequenceTrigger = seq.trigger
      return true

    case GHOSTTY_ACTION_KEY_TABLE:
      let table = action.action.key_table
      state.keyTableTag = table.tag
      switch table.tag {
      case GHOSTTY_KEY_TABLE_ACTIVATE:
        state.keyTableName = string(
          from: table.value.activate.name, length: table.value.activate.len)
        state.keyTableDepth += 1
      case GHOSTTY_KEY_TABLE_DEACTIVATE:
        state.keyTableName = nil
        if state.keyTableDepth > 0 {
          state.keyTableDepth -= 1
        }
      case GHOSTTY_KEY_TABLE_DEACTIVATE_ALL:
        state.keyTableName = nil
        state.keyTableDepth = 0
      default:
        state.keyTableName = nil
      }
      return true

    default:
      return false
    }
  }

  private func handleConfigAndShell(_ action: ghostty_action_s) -> Bool {
    switch action.tag {
    case GHOSTTY_ACTION_SECURE_INPUT:
      state.secureInput = action.action.secure_input
      switch action.action.secure_input {
      case GHOSTTY_SECURE_INPUT_ON:
        surfaceView?.passwordInput = true
      case GHOSTTY_SECURE_INPUT_OFF:
        surfaceView?.passwordInput = false
      case GHOSTTY_SECURE_INPUT_TOGGLE:
        surfaceView?.passwordInput.toggle()
      default:
        break
      }
      return true

    case GHOSTTY_ACTION_FLOAT_WINDOW:
      state.floatWindow = action.action.float_window
      return true

    case GHOSTTY_ACTION_RELOAD_CONFIG:
      state.reloadConfigSoft = action.action.reload_config.soft
      return true

    case GHOSTTY_ACTION_CONFIG_CHANGE:
      state.configChangeCount += 1
      return true

    case GHOSTTY_ACTION_PRESENT_TERMINAL:
      state.presentTerminalCount += 1
      return true
    case GHOSTTY_ACTION_QUIT_TIMER:
      state.quitTimer = action.action.quit_timer
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

  private func string(from pointer: UnsafePointer<CChar>?, length: UInt) -> String? {
    string(from: pointer, length: Int(length))
  }

  private func string(from pointer: UnsafePointer<CChar>?, length: UInt64) -> String? {
    string(from: pointer, length: Int(length))
  }
}
