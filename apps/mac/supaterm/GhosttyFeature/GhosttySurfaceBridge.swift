import AppKit
import Carbon.HIToolbox
import Foundation
import GhosttyKit
import SupatermCLIShared

enum GhosttyInputChunk: Equatable {
  case key(SupatermInputKey)
  case text(String)
}

enum GhosttyOpenURLKind: Equatable {
  case unknown
  case text
  case html

  init(_ value: ghostty_action_open_url_kind_e) {
    switch value {
    case GHOSTTY_ACTION_OPEN_URL_KIND_TEXT:
      self = .text
    case GHOSTTY_ACTION_OPEN_URL_KIND_HTML:
      self = .html
    default:
      self = .unknown
    }
  }
}

struct GhosttyOpenURLRequest: Equatable {
  let kind: GhosttyOpenURLKind
  let url: URL
}

func ghosttyOpenURLRequest(from action: ghostty_action_open_url_s) -> GhosttyOpenURLRequest? {
  guard let pointer = action.url, action.len > 0 else { return nil }
  let data = Data(bytes: pointer, count: Int(action.len))
  guard let urlString = String(data: data, encoding: .utf8) else { return nil }
  let url: URL
  if let candidate = URL(string: urlString), candidate.scheme != nil {
    url = candidate
  } else {
    url = URL(filePath: NSString(string: urlString).standardizingPath)
  }
  return GhosttyOpenURLRequest(kind: GhosttyOpenURLKind(action.kind), url: url)
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
public final class GhosttySurfaceBridge {
  public let state = GhosttySurfaceState()
  public var surface: ghostty_surface_t?
  weak var surfaceView: GhosttySurfaceView?
  public var onTitleChange: ((String) -> Void)?
  public var onPromptSurfaceTitle: (() -> Void)?
  public var onPromptTabTitle: (() -> Void)?
  public var onPathChange: (() -> Void)?
  public var onTabTitleChange: ((String?) -> Bool)?
  public var onCopyTitleToClipboard: (() -> Bool)?
  public var onSplitAction: ((GhosttySplitAction) -> Bool)?
  public var onCloseRequest: ((Bool) -> Void)?
  public var onNewTab: (() -> Bool)?
  public var onCloseTab: ((ghostty_action_close_tab_mode_e) -> Bool)?
  public var onGotoTab: ((ghostty_action_goto_tab_e) -> Bool)?
  public var onMoveTab: ((ghostty_action_move_tab_s) -> Bool)?
  public var onCommandPaletteToggle: (() -> Bool)?
  public var onCommandFinished: (() -> Void)?
  public var onChildExited: (() -> Bool)?
  public var onProgressReport: ((ghostty_action_progress_report_state_e) -> Void)?
  public var onDesktopNotification: ((String, String) -> Void)?
  public var onStateChange: (() -> Void)?
  var progressResetTask: Task<Void, Never>?

  deinit {
    progressResetTask?.cancel()
  }

  func titleDidChange(from previousTitle: String?) {
    let title = state.effectiveTitle
    guard title != previousTitle else { return }
    onTitleChange?(title ?? "")
    if let surfaceView {
      NSAccessibility.post(element: surfaceView, notification: .titleChanged)
    }
  }
  public func sendText(_ text: String) {
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

  public func sendKey(_ key: SupatermInputKey) {
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

  func closeSurface(processAlive: Bool) {
    onCloseRequest?(processAlive)
  }
}
