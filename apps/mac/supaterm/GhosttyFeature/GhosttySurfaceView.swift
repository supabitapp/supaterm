import AppKit
import Carbon
import CoreText
import GhosttyKit
import QuartzCore
import SupatermCLIShared
import SupatermSupport

public final class GhosttySurfaceView: NSView, Identifiable {
  private struct ScrollbarState {
    let total: UInt64
    let offset: UInt64
    let length: UInt64
  }

  private final class CachedValue<T> {
    private var value: T?
    private let fetch: () -> T
    private let duration: Duration
    private var expiryTask: Task<Void, Never>?

    init(duration: Duration, fetch: @escaping () -> T) {
      self.duration = duration
      self.fetch = fetch
    }

    deinit {
      expiryTask?.cancel()
    }

    func get() -> T {
      if let value {
        return value
      }

      let fetched = fetch()
      value = fetched
      expiryTask?.cancel()
      expiryTask = Task { [weak self] in
        guard let self else { return }
        try? await ContinuousClock().sleep(for: self.duration)
        guard !Task.isCancelled else { return }
        self.value = nil
        self.expiryTask = nil
      }
      return fetched
    }
  }

  private let runtime: GhosttyRuntime
  public let id: UUID
  public let bridge: GhosttySurfaceBridge
  public private(set) var surface: ghostty_surface_t?
  private var surfaceRef: GhosttyRuntime.SurfaceReference?
  private let workingDirectoryCString: UnsafeMutablePointer<CChar>?
  private let commandCString: UnsafeMutablePointer<CChar>?
  private let commandWrapper: [String]
  private let environmentVariables: [SupatermCLIEnvironmentVariable]
  private let fontSize: Float32
  private let context: ghostty_surface_context_e
  private let managesWindowAppearance: Bool
  private var trackingArea: NSTrackingArea?
  private var lastBackingSize: CGSize = .zero
  private var lastPerformKeyEvent: TimeInterval?
  private var currentCursor: NSCursor = .iBeam
  private var focused = false
  private var handledSearchFocusCount = 0
  var markedText = NSMutableAttributedString()
  var keyTextAccumulator: [String]?
  var cellSize: CGSize = .zero
  private var lastScrollbar: ScrollbarState?
  private var lastOcclusion: Bool?
  private var lastSurfaceFocus: Bool?
  private var eventMonitor: Any?
  private var notificationObservers: [NSObjectProtocol] = []
  private var prevPressureStage: Int = 0
  private lazy var cachedScreenContents = CachedValue<String>(duration: .milliseconds(500)) {
    [weak self] in
    self?.readScreenContents() ?? ""
  }
  public internal(set) var passwordInput: Bool = false {
    didSet {
      let input = SecureInput.shared
      let id = ObjectIdentifier(self)
      if passwordInput {
        input.setScoped(id, focused: focused)
      } else {
        input.removeScoped(id)
      }
    }
  }
  weak var scrollWrapper: GhosttySurfaceScrollView? {
    didSet {
      if let lastScrollbar {
        scrollWrapper?.updateScrollbar(
          total: lastScrollbar.total,
          offset: lastScrollbar.offset,
          length: lastScrollbar.length
        )
      }
    }
  }
  public var onFocusChange: ((Bool) -> Void)?
  public var onDirectInteraction: (() -> Void)?

  private var accessibilityPaneIndexHelp: String?

  private static let mouseCursorMap: [ghostty_action_mouse_shape_e: NSCursor] = [
    GHOSTTY_MOUSE_SHAPE_DEFAULT: .arrow,
    GHOSTTY_MOUSE_SHAPE_TEXT: .iBeam,
    GHOSTTY_MOUSE_SHAPE_GRAB: .openHand,
    GHOSTTY_MOUSE_SHAPE_GRABBING: .closedHand,
    GHOSTTY_MOUSE_SHAPE_POINTER: .pointingHand,
    GHOSTTY_MOUSE_SHAPE_VERTICAL_TEXT: .iBeamCursorForVerticalLayout,
    GHOSTTY_MOUSE_SHAPE_CONTEXT_MENU: .contextualMenu,
    GHOSTTY_MOUSE_SHAPE_CROSSHAIR: .crosshair,
    GHOSTTY_MOUSE_SHAPE_NOT_ALLOWED: .operationNotAllowed,
  ]

  private static let mouseResizeLeftRightShapes: Set<ghostty_action_mouse_shape_e> = [
    GHOSTTY_MOUSE_SHAPE_COL_RESIZE,
    GHOSTTY_MOUSE_SHAPE_W_RESIZE,
    GHOSTTY_MOUSE_SHAPE_E_RESIZE,
    GHOSTTY_MOUSE_SHAPE_EW_RESIZE,
  ]

  private static let mouseResizeUpDownShapes: Set<ghostty_action_mouse_shape_e> = [
    GHOSTTY_MOUSE_SHAPE_ROW_RESIZE,
    GHOSTTY_MOUSE_SHAPE_N_RESIZE,
    GHOSTTY_MOUSE_SHAPE_S_RESIZE,
    GHOSTTY_MOUSE_SHAPE_NS_RESIZE,
  ]
  static func accessibilityLine(for index: Int, in content: String) -> Int {
    let clampedIndex = min(max(index, 0), content.count)
    let prefix = String(content.prefix(clampedIndex))
    return max(0, prefix.components(separatedBy: .newlines).count - 1)
  }

  static func accessibilityString(for range: NSRange, in content: String) -> String? {
    guard let swiftRange = Range(range, in: content) else { return nil }
    return String(content[swiftRange])
  }

  public override var acceptsFirstResponder: Bool { true }

  public init(
    id: UUID = UUID(),
    runtime: GhosttyRuntime,
    tabID: UUID,
    workingDirectory: URL?,
    command: String? = nil,
    commandWrapper: [String] = [],
    fontSize: Float32? = nil,
    context: ghostty_surface_context_e,
    managesWindowAppearance: Bool = false,
    zmxSessionsEnabled: Bool = true
  ) {
    self.runtime = runtime
    self.id = id
    self.bridge = GhosttySurfaceBridge()
    self.environmentVariables = Self.supatermEnvironmentVariables(
      surfaceID: id,
      tabID: tabID,
      socketPath: SupatermProcessSocketEndpoint.current()?.path,
      cliPath: GhosttySupport.bundledCLIPath(resourcesURL: Bundle.main.resourceURL),
      zmxSessionsEnabled: zmxSessionsEnabled
    )
    self.commandWrapper = commandWrapper
    self.fontSize = fontSize ?? 0
    self.context = context
    self.managesWindowAppearance = managesWindowAppearance
    let initialWorkingDirectoryPath: String?
    if let workingDirectory {
      let path = Self.normalizedWorkingDirectoryPath(
        workingDirectory.path(percentEncoded: false)
      )
      initialWorkingDirectoryPath = path
      workingDirectoryCString = path.withCString { strdup($0) }
    } else {
      initialWorkingDirectoryPath = nil
      workingDirectoryCString = nil
    }
    if let command {
      commandCString = command.withCString { strdup($0) }
    } else {
      commandCString = nil
    }
    super.init(frame: NSRect(x: 0, y: 0, width: 800, height: 600))
    wantsLayer = true
    bridge.state.pwd = initialWorkingDirectoryPath
    bridge.surfaceView = self
    bridge.onPromptSurfaceTitle = { [weak self] in
      self?.promptSurfaceTitle()
    }
    createSurface()
    if let surface {
      surfaceRef = runtime.registerSurface(surface)
    }
    syncRuntimeConfigState()
    registerSupportedDragTypes()

    eventMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyUp, .leftMouseDown]) {
      [weak self] event in
      self?.localEventHandler(event)
    }
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  isolated deinit {
    if let eventMonitor {
      NSEvent.removeMonitor(eventMonitor)
    }
    clearNotificationObservers()
    let id = ObjectIdentifier(self)
    MainActor.assumeIsolated {
      SecureInput.shared.removeScoped(id)
    }
    closeSurface()
    if let workingDirectoryCString {
      free(workingDirectoryCString)
    }
    if let commandCString {
      free(commandCString)
    }
  }

  public func closeSurface() {
    clearNotificationObservers()
    if let surface {
      if let surfaceRef {
        runtime.unregisterSurface(surfaceRef)
        self.surfaceRef = nil
      }
      ghostty_surface_free(surface)
      self.surface = nil
      bridge.surface = nil
      lastOcclusion = nil
      lastSurfaceFocus = nil
    }
  }

  private func updateScreenObservers() {
    clearNotificationObservers()
    guard let window else { return }
    let center = NotificationCenter.default
    notificationObservers.append(
      center.addObserver(
        forName: NSWindow.didChangeScreenNotification,
        object: window,
        queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          self?.windowDidChangeScreen()
        }
      })
    notificationObservers.append(
      center.addObserver(
        forName: NSWindow.didEnterFullScreenNotification,
        object: window,
        queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          self?.applyWindowBackgroundAppearance()
        }
      })
    notificationObservers.append(
      center.addObserver(
        forName: NSWindow.didExitFullScreenNotification,
        object: window,
        queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          self?.applyWindowBackgroundAppearance()
        }
      })
    notificationObservers.append(
      center.addObserver(
        forName: NSWindow.didBecomeKeyNotification,
        object: window,
        queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          self?.applyWindowBackgroundAppearance()
        }
      })
    notificationObservers.append(
      center.addObserver(
        forName: NSWindow.didChangeOcclusionStateNotification,
        object: window,
        queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          self?.applyWindowBackgroundAppearance()
        }
      })
    notificationObservers.append(
      center.addObserver(
        forName: .ghosttyRuntimeConfigDidChange,
        object: runtime,
        queue: .main
      ) { [weak self] _ in
        Task { @MainActor [weak self] in
          self?.applyWindowBackgroundAppearance()
        }
      })
  }

  private func windowDidChangeScreen() {
    guard let surface, let screen = window?.screen else { return }
    let displayID =
      screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? UInt32 ?? 0
    ghostty_surface_set_display_id(surface, displayID)
    DispatchQueue.main.async { [weak self] in
      self?.viewDidChangeBackingProperties()
    }
  }

  private func clearNotificationObservers() {
    let center = NotificationCenter.default
    for observer in notificationObservers {
      center.removeObserver(observer)
    }
    notificationObservers.removeAll()
  }

  public override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    updateScreenObservers()
    updateContentScale()
    notifySizeChanged()
    applyWindowBackgroundAppearance()
  }

  public override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    if let window {
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      layer?.contentsScale = window.backingScaleFactor
      CATransaction.commit()
    }
    updateContentScale()
    notifySizeChanged()
  }

  public override func layout() {
    super.layout()
    notifySizeChanged()
  }

  private func notifySizeChanged() {
    if let scrollWrapper {
      scrollWrapper.updateSurfaceSize()
    } else {
      updateSurfaceSize()
    }
  }

  public override func updateTrackingAreas() {
    if let trackingArea {
      removeTrackingArea(trackingArea)
    }
    let area = NSTrackingArea(
      rect: bounds,
      options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect],
      owner: self,
      userInfo: nil
    )
    addTrackingArea(area)
    trackingArea = area
  }

  public override func resetCursorRects() {
    addCursorRect(bounds, cursor: currentCursor)
  }

  private func applyWindowBackgroundAppearance() {
    guard managesWindowAppearance else { return }
    guard let window, window.isVisible else { return }
    let opacity = runtime.backgroundOpacity()
    if !window.styleMask.contains(.fullScreen), opacity < 1 {
      window.isOpaque = false
      window.titlebarAppearsTransparent = true
      window.backgroundColor = .white.withAlphaComponent(0.001)
      if let app = runtime.app {
        ghostty_set_window_background_blur(
          app,
          Unmanaged.passUnretained(window).toOpaque()
        )
      }
      return
    }
    window.isOpaque = true
    window.titlebarAppearsTransparent = false
    window.backgroundColor = runtime.backgroundColor().withAlphaComponent(1)
  }

  public func focusDidChange(_ focused: Bool) {
    guard surface != nil else { return }
    guard self.focused != focused else { return }
    self.focused = focused
    if focused {
      bridge.state.bellCount = 0
    }
    setSurfaceFocus(focused)
    onFocusChange?(focused)
    if passwordInput {
      SecureInput.shared.setScoped(ObjectIdentifier(self), focused: focused)
    }
  }

  public func setAccessibilityPaneIndex(index: Int, total: Int) {
    guard total > 0, index > 0, index <= total else {
      accessibilityPaneIndexHelp = nil
      return
    }
    accessibilityPaneIndexHelp = "Pane \(index) of \(total)"
  }

  public override func isAccessibilityElement() -> Bool {
    // Avoid interacting with panes after teardown.
    surface != nil
  }

  public override func accessibilityRole() -> NSAccessibility.Role? {
    // Match Ghostty.app so speech/input tools can treat the surface as editable text.
    .textArea
  }

  public override func accessibilityLabel() -> String? {
    if let title = bridge.state.effectiveTitle {
      return title
    }
    let pwd = bridge.state.pwd?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !pwd.isEmpty {
      return pwd
    }
    return "Terminal pane"
  }

  public override func accessibilityValue() -> Any? {
    cachedScreenContents.get()
  }

  public override func accessibilityHelp() -> String? {
    accessibilityPaneIndexHelp
  }

  public override func accessibilitySelectedTextRange() -> NSRange {
    selectedRange()
  }

  public override func accessibilitySelectedText() -> String? {
    guard let surface else { return nil }
    var text = ghostty_text_s()
    guard ghostty_surface_read_selection(surface, &text) else { return nil }
    defer { ghostty_surface_free_text(surface, &text) }
    let value = String(cString: text.text)
    return value.isEmpty ? nil : value
  }

  public override func accessibilityNumberOfCharacters() -> Int {
    cachedScreenContents.get().count
  }

  public override func accessibilityVisibleCharacterRange() -> NSRange {
    let content = cachedScreenContents.get()
    return NSRange(location: 0, length: content.count)
  }

  public override func accessibilityLine(for index: Int) -> Int {
    Self.accessibilityLine(for: index, in: cachedScreenContents.get())
  }

  public override func accessibilityString(for range: NSRange) -> String? {
    Self.accessibilityString(for: range, in: cachedScreenContents.get())
  }

  public override func accessibilityAttributedString(for range: NSRange) -> NSAttributedString? {
    guard let surface else { return nil }
    guard let plainString = accessibilityString(for: range) else { return nil }

    var attributes: [NSAttributedString.Key: Any] = [:]
    if let fontRaw = ghostty_surface_quicklook_font(surface) {
      let font = Unmanaged<CTFont>.fromOpaque(fontRaw)
      attributes[.font] = font.takeUnretainedValue()
      font.release()
    }

    return NSAttributedString(string: plainString, attributes: attributes)
  }

  public override func becomeFirstResponder() -> Bool {
    let result = super.becomeFirstResponder()
    if result {
      focusDidChange(true)
      postAccessibilityFocusChanged()
    }
    return result
  }

  public override func resignFirstResponder() -> Bool {
    let result = super.resignFirstResponder()
    if result {
      focusDidChange(false)
    }
    return result
  }

  private func postAccessibilityFocusChanged() {
    guard surface != nil else { return }
    // Post on the window so assistive tech can query the focused element from it.
    if let window {
      NSAccessibility.post(element: window, notification: .focusedUIElementChanged)
    } else {
      NSAccessibility.post(element: self, notification: .focusedUIElementChanged)
    }
  }

  private func readScreenContents() -> String {
    readText(
      topLeftTag: GHOSTTY_POINT_SCREEN,
      bottomRightTag: GHOSTTY_POINT_SCREEN
    ) ?? ""
  }

  public func captureText(
    scope: SupatermCapturePaneScope,
    lines: Int?
  ) -> String? {
    let text =
      switch scope {
      case .scrollback:
        readText(
          topLeftTag: GHOSTTY_POINT_SURFACE,
          bottomRightTag: GHOSTTY_POINT_SCREEN
        )
      case .visible:
        readText(
          topLeftTag: GHOSTTY_POINT_SCREEN,
          bottomRightTag: GHOSTTY_POINT_SCREEN
        )
      }
    guard let text else { return nil }
    guard let lines, lines > 0 else { return text }
    let components = text.components(separatedBy: .newlines)
    guard components.count > lines else { return text }
    return components.suffix(lines).joined(separator: "\n")
  }

  private func readText(
    topLeftTag: ghostty_point_tag_e,
    bottomRightTag: ghostty_point_tag_e
  ) -> String? {
    guard let surface else { return nil }
    var text = ghostty_text_s()
    let selection = ghostty_selection_s(
      top_left: ghostty_point_s(
        tag: topLeftTag,
        coord: GHOSTTY_POINT_COORD_TOP_LEFT,
        x: 0,
        y: 0
      ),
      bottom_right: ghostty_point_s(
        tag: bottomRightTag,
        coord: GHOSTTY_POINT_COORD_BOTTOM_RIGHT,
        x: 0,
        y: 0
      ),
      rectangle: false
    )
    guard ghostty_surface_read_text(surface, selection, &text) else { return nil }
    defer { ghostty_surface_free_text(surface, &text) }
    return String(cString: text.text)
  }

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

  public override func mouseMoved(with event: NSEvent) {
    sendMousePosition(event)
    if let window, window.isKeyWindow, !focused, runtime.focusFollowsMouse() {
      requestFocus()
    }
  }

  public override func mouseEntered(with event: NSEvent) {
    super.mouseEntered(with: event)
    sendMousePosition(event)
  }

  public override func mouseExited(with event: NSEvent) {
    if NSEvent.pressedMouseButtons != 0 {
      return
    }
    guard let surface else { return }
    let mods = GhosttyKeyEvent.mods(event.modifierFlags)
    ghostty_surface_mouse_pos(surface, -1, -1, mods)
  }

  public override func mouseDown(with event: NSEvent) {
    if focused {
      onDirectInteraction?()
    }
    sendMouseButton(event, state: GHOSTTY_MOUSE_PRESS, button: GHOSTTY_MOUSE_LEFT)
  }

  public override func mouseUp(with event: NSEvent) {
    prevPressureStage = 0
    sendMouseButton(event, state: GHOSTTY_MOUSE_RELEASE, button: GHOSTTY_MOUSE_LEFT)
    if let surface {
      ghostty_surface_mouse_pressure(surface, 0, 0)
    }
  }

  public override func rightMouseDown(with event: NSEvent) {
    guard let surface else {
      super.rightMouseDown(with: event)
      return
    }
    let mods = GhosttyKeyEvent.mods(event.modifierFlags)
    if ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_RIGHT, mods) {
      return
    }
    super.rightMouseDown(with: event)
  }

  public override func rightMouseUp(with event: NSEvent) {
    guard let surface else {
      super.rightMouseUp(with: event)
      return
    }
    let mods = GhosttyKeyEvent.mods(event.modifierFlags)
    if ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_RELEASE, GHOSTTY_MOUSE_RIGHT, mods) {
      return
    }
    super.rightMouseUp(with: event)
  }

  public override func otherMouseDown(with event: NSEvent) {
    sendMouseButton(event, state: GHOSTTY_MOUSE_PRESS, button: Self.ghosttyMouseButton(from: event.buttonNumber))
  }

  public override func otherMouseUp(with event: NSEvent) {
    sendMouseButton(event, state: GHOSTTY_MOUSE_RELEASE, button: Self.ghosttyMouseButton(from: event.buttonNumber))
  }

  private static func ghosttyMouseButton(from buttonNumber: Int) -> ghostty_input_mouse_button_e {
    switch buttonNumber {
    case 0: GHOSTTY_MOUSE_LEFT
    case 1: GHOSTTY_MOUSE_RIGHT
    case 2: GHOSTTY_MOUSE_MIDDLE
    case 3: GHOSTTY_MOUSE_EIGHT
    case 4: GHOSTTY_MOUSE_NINE
    case 5: GHOSTTY_MOUSE_SIX
    case 6: GHOSTTY_MOUSE_SEVEN
    case 7: GHOSTTY_MOUSE_FOUR
    case 8: GHOSTTY_MOUSE_FIVE
    case 9: GHOSTTY_MOUSE_TEN
    case 10: GHOSTTY_MOUSE_ELEVEN
    default: GHOSTTY_MOUSE_UNKNOWN
    }
  }

  public override func mouseDragged(with event: NSEvent) {
    sendMousePosition(event)
  }

  public override func rightMouseDragged(with event: NSEvent) {
    sendMousePosition(event)
  }

  public override func otherMouseDragged(with event: NSEvent) {
    sendMousePosition(event)
  }

  public override func scrollWheel(with event: NSEvent) {
    if focused {
      onDirectInteraction?()
    }
    guard let surface else { return }
    var scrollX = event.scrollingDeltaX
    var scrollY = event.scrollingDeltaY
    if event.hasPreciseScrollingDeltas {
      scrollX *= 2
      scrollY *= 2
    }
    ghostty_surface_mouse_scroll(surface, scrollX, scrollY, scrollMods(for: event))
  }

  public override func pressureChange(with event: NSEvent) {
    guard let surface else { return }
    ghostty_surface_mouse_pressure(surface, UInt32(event.stage), Double(event.pressure))
    guard prevPressureStage < 2 else { return }
    prevPressureStage = event.stage
    guard event.stage == 2 else { return }
    guard UserDefaults.standard.bool(forKey: "com.apple.trackpad.forceClick") else { return }
    quickLook(with: event)
  }

  public override func quickLook(with event: NSEvent) {
    guard let surface else { return super.quickLook(with: event) }
    var text = ghostty_text_s()
    guard ghostty_surface_quicklook_word(surface, &text) else { return super.quickLook(with: event) }
    defer { ghostty_surface_free_text(surface, &text) }
    guard text.text_len > 0 else { return super.quickLook(with: event) }

    var attributes: [NSAttributedString.Key: Any] = [:]
    if let fontRaw = ghostty_surface_quicklook_font(surface) {
      let font = Unmanaged<CTFont>.fromOpaque(fontRaw)
      attributes[.font] = font.takeUnretainedValue()
      font.release()
    }

    let str = NSAttributedString(string: String(cString: text.text), attributes: attributes)
    let point = NSPoint(x: text.tl_px_x, y: frame.size.height - text.tl_px_y)
    showDefinition(for: str, at: point)
  }

  private func localEventHandler(_ event: NSEvent) -> NSEvent? {
    switch event.type {
    case .keyUp:
      localEventKeyUp(event)
    case .leftMouseDown:
      localEventLeftMouseDown(event)
    default:
      event
    }
  }

  private func localEventKeyUp(_ event: NSEvent) -> NSEvent? {
    if !event.modifierFlags.contains(.command) { return event }
    guard focused else { return event }
    keyUp(with: event)
    return nil
  }

  private func localEventLeftMouseDown(_ event: NSEvent) -> NSEvent? {
    guard let window, event.window != nil, window == event.window else { return event }
    let location = convert(event.locationInWindow, from: nil)
    guard hitTest(location) == self else { return event }
    guard !NSApp.isActive || !window.isKeyWindow else { return event }
    guard !focused else { return event }
    window.makeFirstResponder(self)
    return event
  }

  func updateSurfaceSize(contentSize: CGSize? = nil) {
    guard let surface else { return }
    let backingSize = convertToBacking(contentSize ?? bounds.size)
    if backingSize == lastBackingSize {
      return
    }
    lastBackingSize = backingSize
    let width = UInt32(max(1, Int(backingSize.width.rounded(.down))))
    let height = UInt32(max(1, Int(backingSize.height.rounded(.down))))
    let currentSize = ghostty_surface_size(surface)
    guard currentSize.cell_width_px > 0, currentSize.cell_height_px > 0 else {
      ghostty_surface_set_size(surface, width, height)
      return
    }
    let columns = Int(width) / Int(currentSize.cell_width_px)
    let rows = Int(height) / Int(currentSize.cell_height_px)
    guard columns >= 5, rows >= 2 else { return }
    ghostty_surface_set_size(surface, width, height)
  }

  func updateCellSize(width: UInt32, height: UInt32) {
    cellSize = CGSize(width: CGFloat(width), height: CGFloat(height))
    scrollWrapper?.updateSurfaceSize()
  }

  func updateScrollbar(total: UInt64, offset: UInt64, length: UInt64) {
    lastScrollbar = ScrollbarState(total: total, offset: offset, length: length)
    scrollWrapper?.updateScrollbar(total: total, offset: offset, length: length)
  }

  public func currentCellSize() -> CGSize {
    cellSize
  }

  public func currentFontSizePoints() -> Double? {
    guard let surface else { return nil }
    guard let fontRaw = ghostty_surface_quicklook_font(surface) else { return nil }
    let font = Unmanaged<CTFont>.fromOpaque(fontRaw)
    defer { font.release() }
    return Double(CTFontGetSize(font.takeUnretainedValue()))
  }

  func shouldShowScrollbar() -> Bool {
    runtime.shouldShowScrollbar()
  }

  func scrollbarAppearanceName() -> NSAppearance.Name {
    runtime.scrollbarAppearanceName()
  }

  func setMouseShape(_ shape: ghostty_action_mouse_shape_e) {
    let newCursor = cursor(for: shape)
    guard let newCursor else { return }
    guard newCursor != currentCursor else { return }
    currentCursor = newCursor
    window?.invalidateCursorRects(for: self)
  }

  private func cursor(for shape: ghostty_action_mouse_shape_e) -> NSCursor? {
    if let cursor = Self.mouseCursorMap[shape] {
      return cursor
    }
    if Self.mouseResizeLeftRightShapes.contains(shape) {
      return .resizeLeftRight
    }
    if Self.mouseResizeUpDownShapes.contains(shape) {
      return .resizeUpDown
    }
    return nil
  }

  func setMouseVisibility(_ visible: Bool) {
    NSCursor.setHiddenUntilMouseMoves(!visible)
  }

  private func createSurface() {
    guard let app = runtime.app else { return }
    var config = ghostty_surface_config_new()
    config.userdata = Unmanaged.passUnretained(bridge).toOpaque()
    config.platform_tag = GHOSTTY_PLATFORM_MACOS
    config.platform = ghostty_platform_u(
      macos: ghostty_platform_macos_s(
        nsview: Unmanaged.passUnretained(self).toOpaque()
      ))
    config.scale_factor = backingScaleFactor()
    config.font_size = fontSize
    config.working_directory = workingDirectoryCString.map { UnsafePointer($0) }
    config.command = commandCString.map { UnsafePointer($0) }
    config.context = context
    Self.withEnvironmentVariables(environmentVariables) { envVars, count in
      config.env_vars = envVars
      config.env_var_count = count
      Self.withCStringArray(commandWrapper) { wrapper, wrapperCount in
        config.command_wrapper = wrapper
        config.command_wrapper_count = wrapperCount
        surface = ghostty_surface_new(app, &config)
      }
    }
    bridge.surface = surface
    lastOcclusion = nil
    lastSurfaceFocus = nil
    updateSurfaceSize()
  }

  func syncRuntimeConfigState() {
    bridge.state.progressStyleEnabled = runtime.progressStyle()
  }

  private static func withEnvironmentVariables<Result>(
    _ environmentVariables: [SupatermCLIEnvironmentVariable],
    _ body: (UnsafeMutablePointer<ghostty_env_var_s>?, Int) -> Result
  ) -> Result {
    guard !environmentVariables.isEmpty else {
      return body(nil, 0)
    }

    var envVars = environmentVariables.map { variable in
      ghostty_env_var_s(
        key: strdup(variable.key),
        value: strdup(variable.value)
      )
    }
    defer {
      for envVar in envVars {
        if let key = envVar.key {
          free(UnsafeMutableRawPointer(mutating: key))
        }
        if let value = envVar.value {
          free(UnsafeMutableRawPointer(mutating: value))
        }
      }
    }

    return envVars.withUnsafeMutableBufferPointer { buffer in
      body(buffer.baseAddress, buffer.count)
    }
  }

  private static func withCStringArray<Result>(
    _ values: [String],
    _ body: (UnsafePointer<UnsafePointer<CChar>?>?, Int) -> Result
  ) -> Result {
    guard !values.isEmpty else {
      return body(nil, 0)
    }

    let cStrings: [UnsafePointer<CChar>?] = values.map { value in
      UnsafePointer(value.withCString { strdup($0)! })
    }
    defer {
      for cString in cStrings {
        free(UnsafeMutablePointer(mutating: cString))
      }
    }

    return cStrings.withUnsafeBufferPointer { buffer in
      body(buffer.baseAddress, buffer.count)
    }
  }

  private func updateContentScale() {
    guard let surface else { return }
    let scale = backingScaleFactor()
    ghostty_surface_set_content_scale(surface, scale, scale)
  }

  private func backingScaleFactor() -> Double {
    if let window {
      return window.backingScaleFactor
    }
    if let screen = NSScreen.main {
      return screen.backingScaleFactor
    }
    return 2.0
  }

  public func setOcclusion(_ visible: Bool) {
    guard let surface else { return }
    if lastOcclusion == visible {
      return
    }
    lastOcclusion = visible
    ghostty_surface_set_occlusion(surface, visible)
  }

  private func setSurfaceFocus(_ focused: Bool) {
    guard let surface else { return }
    if lastSurfaceFocus == focused {
      return
    }
    lastSurfaceFocus = focused
    ghostty_surface_set_focus(surface, focused)
  }

  public func requestFocus() {
    Self.moveFocus(to: self)
  }

  public func consumeSearchFocusRequest(_ count: Int) -> Bool {
    guard count > handledSearchFocusCount else { return false }
    handledSearchFocusCount = count
    return true
  }

  public static func moveFocus(
    to view: GhosttySurfaceView,
    from previous: GhosttySurfaceView? = nil,
    delay: TimeInterval? = nil
  ) {
    let maxDelay: TimeInterval = 0.5
    let currentDelay = delay ?? 0
    guard currentDelay < maxDelay else { return }
    let nextDelay: TimeInterval = if let delay { delay * 2 } else { 0.05 }
    Task { @MainActor in
      if let delay {
        try? await ContinuousClock().sleep(for: .seconds(delay))
      }
      guard let window = view.window else {
        moveFocus(to: view, from: previous, delay: nextDelay)
        return
      }
      if let previous, previous !== view {
        _ = previous.resignFirstResponder()
      }
      window.makeFirstResponder(view)
    }
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

  public func effectiveTitle() -> String? {
    bridge.state.effectiveTitle
  }

  public func setTitleOverride(_ title: String?) {
    let previousTitle = bridge.state.effectiveTitle
    let previousOverride = bridge.state.titleOverride
    bridge.state.titleOverride = title
    if previousTitle != bridge.state.effectiveTitle {
      bridge.titleDidChange(from: previousTitle)
    } else if previousOverride != title {
      bridge.onTitleChange?(bridge.state.effectiveTitle ?? "")
    }
  }

  public func promptTitle(
    messageText: String,
    initialValue: String,
    handler: @escaping (String) -> Void
  ) {
    let alert = NSAlert()
    alert.messageText = messageText
    alert.informativeText = "Leave blank to restore the default."
    alert.alertStyle = .informational

    let textField = NSTextField(frame: NSRect(x: 0, y: 0, width: 250, height: 24))
    textField.stringValue = initialValue
    alert.accessoryView = textField

    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    alert.window.initialFirstResponder = textField

    let completionHandler: (NSApplication.ModalResponse) -> Void = { response in
      guard response == .alertFirstButtonReturn else { return }
      handler(textField.stringValue)
    }

    if let window {
      alert.beginSheetModal(for: window, completionHandler: completionHandler)
    } else {
      completionHandler(alert.runModal())
    }
  }

  func promptSurfaceTitle() {
    promptTitle(
      messageText: "Change Terminal Title",
      initialValue: bridge.state.titleOverride ?? bridge.state.title ?? ""
    ) { [weak self] title in
      self?.setTitleOverride(Self.titleOverride(from: title))
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

  private func scrollMods(for event: NSEvent) -> ghostty_input_scroll_mods_t {
    var value: Int32 = 0
    if event.hasPreciseScrollingDeltas {
      value |= 0b0000_0001
    }
    let momentum: Int32
    switch event.momentumPhase {
    case .began:
      momentum = 1
    case .stationary:
      momentum = 2
    case .changed:
      momentum = 3
    case .ended:
      momentum = 4
    case .cancelled:
      momentum = 5
    case .mayBegin:
      momentum = 6
    default:
      momentum = 0
    }
    value |= (momentum << 1)
    return ghostty_input_scroll_mods_t(value)
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

  private func sendMousePosition(_ event: NSEvent) {
    guard let surface else { return }
    let point = convert(event.locationInWindow, from: nil)
    let yPosition = bounds.height - point.y
    let mods = GhosttyKeyEvent.mods(event.modifierFlags)
    ghostty_surface_mouse_pos(surface, point.x, yPosition, mods)
  }

  private func sendMouseButton(
    _ event: NSEvent,
    state: ghostty_input_mouse_state_e,
    button: ghostty_input_mouse_button_e
  ) {
    guard let surface else { return }
    let mods = GhosttyKeyEvent.mods(event.modifierFlags)
    ghostty_surface_mouse_button(surface, state, button, mods)
  }

}
