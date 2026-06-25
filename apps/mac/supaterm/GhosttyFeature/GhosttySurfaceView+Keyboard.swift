import AppKit
import Carbon
import GhosttyKit

extension GhosttySurfaceView {
  public override func keyDown(with event: NSEvent) {
    guard let surface else {
      interpretKeyEvents([event])
      return
    }
    if focused {
      onDirectInteraction?()
    }
    bridge.state.bellCount = 0
    let (translationEvent, translationMods) = translationState(event, surface: surface)
    let action = event.isARepeat ? GHOSTTY_ACTION_REPEAT : GHOSTTY_ACTION_PRESS
    keyTextAccumulator = []
    defer { keyTextAccumulator = nil }
    let markedTextBefore = markedText.length > 0
    let keyboardIdBefore = markedTextBefore ? nil : keyboardLayoutId()
    lastPerformKeyEvent = nil
    interpretKeyEvents([translationEvent])
    if !markedTextBefore, keyboardIdBefore != keyboardLayoutId() {
      return
    }
    syncPreedit(clearIfNeeded: markedTextBefore)
    if let list = keyTextAccumulator, !list.isEmpty {
      for text in list {
        _ = sendKey(
          action: action,
          event: event,
          translationEvent: translationEvent,
          translationMods: translationMods,
          text: text,
          composing: false
        )
      }
    } else {
      _ = sendKey(
        action: action,
        event: event,
        translationEvent: translationEvent,
        translationMods: translationMods,
        text: GhosttyKeyEvent.characters(translationEvent),
        composing: markedText.length > 0 || markedTextBefore
      )
    }
  }

  public override func keyUp(with event: NSEvent) {
    sendKey(action: GHOSTTY_ACTION_RELEASE, event: event)
  }

  public override func flagsChanged(with event: NSEvent) {
    let mod: UInt32
    switch event.keyCode {
    case 0x39: mod = GHOSTTY_MODS_CAPS.rawValue
    case 0x38, 0x3C: mod = GHOSTTY_MODS_SHIFT.rawValue
    case 0x3B, 0x3E: mod = GHOSTTY_MODS_CTRL.rawValue
    case 0x3A, 0x3D: mod = GHOSTTY_MODS_ALT.rawValue
    case 0x37, 0x36: mod = GHOSTTY_MODS_SUPER.rawValue
    default: return
    }
    if hasMarkedText() { return }
    let mods = GhosttyKeyEvent.mods(event.modifierFlags)
    var action = GHOSTTY_ACTION_RELEASE
    if (mods.rawValue & mod) != 0 {
      let sidePressed: Bool
      switch event.keyCode {
      case 0x3C:
        sidePressed = event.modifierFlags.rawValue & UInt(NX_DEVICERSHIFTKEYMASK) != 0
      case 0x3E:
        sidePressed = event.modifierFlags.rawValue & UInt(NX_DEVICERCTLKEYMASK) != 0
      case 0x3D:
        sidePressed = event.modifierFlags.rawValue & UInt(NX_DEVICERALTKEYMASK) != 0
      case 0x36:
        sidePressed = event.modifierFlags.rawValue & UInt(NX_DEVICERCMDKEYMASK) != 0
      default:
        sidePressed = true
      }
      if sidePressed {
        action = GHOSTTY_ACTION_PRESS
      }
    }
    sendKey(action: action, event: event)
  }

  public override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard event.type == .keyDown else { return false }
    guard let surface else { return false }
    guard focused else { return false }

    if let bindingFlags = bindingFlags(for: event, surface: surface) {
      if shouldAttemptMenu(for: bindingFlags),
        (NSApp.delegate as? any GhosttyBindingMenuKeyPerforming)?
          .performGhosttyBindingMenuKeyEquivalent(with: event) == true
      {
        onDirectInteraction?()
        return true
      }
      keyDown(with: event)
      return true
    }

    guard let equivalent = equivalentKey(for: event) else { return false }

    guard
      let finalEvent = NSEvent.keyEvent(
        with: .keyDown,
        location: event.locationInWindow,
        modifierFlags: event.modifierFlags,
        timestamp: event.timestamp,
        windowNumber: event.windowNumber,
        context: nil,
        characters: equivalent,
        charactersIgnoringModifiers: equivalent,
        isARepeat: event.isARepeat,
        keyCode: event.keyCode
      )
    else {
      return false
    }
    keyDown(with: finalEvent)
    return true
  }

  private func bindingFlags(
    for event: NSEvent,
    surface: ghostty_surface_t
  ) -> ghostty_binding_flags_e? {
    var key = GhosttyKeyEvent.make(
      event,
      action: GHOSTTY_ACTION_PRESS,
      originalMods: event.modifierFlags,
      translationMods: event.modifierFlags
    )
    var flags = ghostty_binding_flags_e(0)
    let isBinding = (event.characters ?? "").withCString { ptr in
      key.text = ptr
      return ghostty_surface_key_is_binding(surface, key, &flags)
    }
    return isBinding ? flags : nil
  }

  private func equivalentKey(for event: NSEvent) -> String? {
    switch event.charactersIgnoringModifiers {
    case "\r":
      guard event.modifierFlags.contains(.control) else { return nil }
      return "\r"
    case "/":
      guard event.modifierFlags.contains(.control) else { return nil }
      guard event.modifierFlags.isDisjoint(with: [.shift, .command, .option]) else { return nil }
      return "_"
    default:
      if event.timestamp == 0 { return nil }
      if !event.modifierFlags.contains(.command) && !event.modifierFlags.contains(.control) {
        lastPerformKeyEvent = nil
        return nil
      }
      if let lastPerformKeyEvent {
        self.lastPerformKeyEvent = nil
        if lastPerformKeyEvent == event.timestamp {
          return event.characters ?? ""
        }
      }
      lastPerformKeyEvent = event.timestamp
      return nil
    }
  }

  public override func doCommand(by selector: Selector) {
    if let lastPerformKeyEvent,
      let current = NSApp.currentEvent,
      lastPerformKeyEvent == current.timestamp
    {
      NSApp.sendEvent(current)
      return
    }
    switch selector {
    case #selector(moveToBeginningOfDocument(_:)):
      performBindingAction("scroll_to_top")
    case #selector(moveToEndOfDocument(_:)):
      performBindingAction("scroll_to_bottom")
    default:
      break
    }
  }

  private func shouldAttemptMenu(for flags: ghostty_binding_flags_e) -> Bool {
    if bridge.state.keySequenceActive == true { return false }
    if bridge.state.keyTableDepth > 0 { return false }
    let raw = flags.rawValue
    let isAll = (raw & GHOSTTY_BINDING_FLAGS_ALL.rawValue) != 0
    let isPerformable = (raw & GHOSTTY_BINDING_FLAGS_PERFORMABLE.rawValue) != 0
    let isConsumed = (raw & GHOSTTY_BINDING_FLAGS_CONSUMED.rawValue) != 0
    return !isAll && !isPerformable && isConsumed
  }

  @discardableResult
  private func sendKey(
    action: ghostty_input_action_e,
    event: NSEvent,
    translationEvent: NSEvent? = nil,
    translationMods: NSEvent.ModifierFlags? = nil,
    text: String? = nil,
    composing: Bool = false
  ) -> Bool {
    guard let surface else { return false }
    let resolvedEvent: NSEvent
    let resolvedMods: NSEvent.ModifierFlags
    if let translationEvent, let translationMods {
      resolvedEvent = translationEvent
      resolvedMods = translationMods
    } else {
      (resolvedEvent, resolvedMods) = translationState(event, surface: surface)
    }
    var key = GhosttyKeyEvent.make(
      resolvedEvent,
      action: action,
      originalMods: event.modifierFlags,
      translationMods: resolvedMods,
      composing: composing
    )
    let finalText = text ?? GhosttyKeyEvent.characters(resolvedEvent)
    if let finalText, !finalText.isEmpty,
      let codepoint = finalText.utf8.first, codepoint >= 0x20
    {
      return finalText.withCString { ptr in
        key.text = ptr
        return ghostty_surface_key(surface, key)
      }
    }
    key.text = nil
    return ghostty_surface_key(surface, key)
  }

  public func performBindingAction(_ action: String) {
    guard let surface else { return }
    _ = action.withCString { ptr in
      ghostty_surface_binding_action(surface, ptr, UInt(action.lengthOfBytes(using: .utf8)))
    }
  }

  private func translationState(_ event: NSEvent, surface: ghostty_surface_t) -> (
    NSEvent, NSEvent.ModifierFlags
  ) {
    let translatedModsGhostty = ghostty_surface_key_translation_mods(
      surface, GhosttyKeyEvent.mods(event.modifierFlags))
    let translatedMods = GhosttyKeyEvent.appKitMods(translatedModsGhostty)
    var resolved = event.modifierFlags
    for flag in [NSEvent.ModifierFlags.shift, .control, .option, .command] {
      if translatedMods.contains(flag) {
        resolved.insert(flag)
      } else {
        resolved.remove(flag)
      }
    }
    if resolved == event.modifierFlags {
      return (event, resolved)
    }
    let translatedEvent =
      NSEvent.keyEvent(
        with: event.type,
        location: event.locationInWindow,
        modifierFlags: resolved,
        timestamp: event.timestamp,
        windowNumber: event.windowNumber,
        context: nil,
        characters: event.characters(byApplyingModifiers: resolved) ?? "",
        charactersIgnoringModifiers: event.charactersIgnoringModifiers ?? "",
        isARepeat: event.isARepeat,
        keyCode: event.keyCode
      ) ?? event
    return (translatedEvent, resolved)
  }

  func syncPreedit(clearIfNeeded: Bool = true) {
    guard let surface else { return }
    if markedText.length > 0 {
      let str = markedText.string
      let len = str.utf8CString.count
      if len > 0 {
        markedText.string.withCString { ptr in
          ghostty_surface_preedit(surface, ptr, UInt(len - 1))
        }
      }
    } else if clearIfNeeded {
      ghostty_surface_preedit(surface, nil, 0)
    }
  }

  private func keyboardLayoutId() -> String? {
    guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue() else {
      return nil
    }
    guard let raw = TISGetInputSourceProperty(source, kTISPropertyInputSourceID) else {
      return nil
    }
    let value = Unmanaged<CFString>.fromOpaque(raw).takeUnretainedValue()
    return value as String
  }
}
