import AppKit
import SwiftUI

/// Presents a SwiftUI dialog surface above an AppKit window.
///
/// Most SwiftUI views should use ``SwiftUI/View/dialogSurface(isPresented:content:)``. This
/// presenter is the narrow imperative bridge for call sites that originate in AppKit callbacks.
@MainActor
public final class DialogSurfacePresenter {
  private var presentation: DialogSurfacePanelPresentation?
  private var modalResponse: NSApplication.ModalResponse?

  public init() {}

  public var isPresented: Bool {
    presentation != nil
  }

  public static func isPresenting(over parentWindow: NSWindow) -> Bool {
    parentWindow.childWindows?.contains { $0 is DialogSurfacePanel } == true
  }

  @discardableResult
  public func present<Content: View>(
    over parentWindow: NSWindow?,
    standaloneSize: CGSize = CGSize(width: 680, height: 480),
    onDismiss: (() -> Void)? = nil,
    keyDownHandler: ((NSEvent) -> Bool)? = nil,
    @ViewBuilder content: () -> Content,
  ) -> Bool {
    guard presentation == nil else { return false }
    if let parentWindow, Self.isPresenting(over: parentWindow) {
      return false
    }

    let panel = DialogSurfacePanel(
      contentRect: NSRect(origin: .zero, size: standaloneSize),
      styleMask: [.borderless],
      backing: .buffered,
      defer: false,
    )
    panel.keyDownHandler = keyDownHandler
    let presentation = DialogSurfacePanelPresentation(
      panel: panel,
      parentWindow: parentWindow,
      content: AnyView(content()),
      onParentClose: { [weak self] in
        self?.finish(with: .cancel)
      },
      onDismiss: onDismiss,
    )
    self.presentation = presentation
    presentation.show()
    return true
  }

  public func update<Content: View>(@ViewBuilder content: () -> Content) {
    presentation?.update(content: AnyView(content()))
  }

  public func dismiss() {
    finish(with: .cancel)
  }

  public func finish(with response: NSApplication.ModalResponse) {
    guard let presentation else { return }
    modalResponse = response
    if NSApp.modalWindow === presentation.panel {
      NSApp.stopModal(withCode: response)
    }
    self.presentation = nil
    presentation.dismiss()
  }

  public func runModal<Content: View>(
    over parentWindow: NSWindow?,
    standaloneSize: CGSize = CGSize(width: 680, height: 480),
    keyDownHandler: ((NSEvent) -> Bool)? = nil,
    @ViewBuilder content: () -> Content,
  ) -> NSApplication.ModalResponse {
    modalResponse = nil
    guard
      present(
        over: parentWindow,
        standaloneSize: standaloneSize,
        keyDownHandler: keyDownHandler,
        content: content,
      ),
      let panel = presentation?.panel
    else {
      return .abort
    }

    let response = NSApp.runModal(for: panel)
    if let presentation = self.presentation {
      self.presentation = nil
      presentation.dismiss()
    }
    return modalResponse ?? response
  }

  fileprivate func dismissWithoutNotification() {
    guard let presentation else { return }
    if NSApp.modalWindow === presentation.panel {
      NSApp.abortModal()
    }
    self.presentation = nil
    presentation.dismiss(notify: false)
  }
}

extension View {
  /// Presents custom dialog content over the view's containing window.
  public func dialogSurface<DialogContent: View>(
    isPresented: Binding<Bool>,
    @ViewBuilder content: @escaping () -> DialogContent,
  ) -> some View {
    background {
      DialogSurfacePresentationAnchor(
        isPresented: isPresented,
        dialogContent: content,
      )
      .frame(width: 0, height: 0)
    }
  }
}

private struct DialogSurfacePresentationAnchor<DialogContent: View>: NSViewRepresentable {
  @Binding var isPresented: Bool
  let dialogContent: () -> DialogContent

  func makeCoordinator() -> Coordinator {
    Coordinator()
  }

  func makeNSView(context: Context) -> DialogSurfaceWindowAnchorView {
    let view = DialogSurfaceWindowAnchorView()
    view.onWindowChange = { [weak coordinator = context.coordinator, weak view] in
      guard let coordinator, let view else { return }
      coordinator.updatePresentation(from: view)
    }
    return view
  }

  func updateNSView(_ view: DialogSurfaceWindowAnchorView, context: Context) {
    context.coordinator.requestedPresentation = isPresented
    context.coordinator.setPresented = { isPresented = $0 }
    context.coordinator.dialogContent = { AnyView(dialogContent()) }
    context.coordinator.updatePresentation(from: view)
  }

  static func dismantleNSView(
    _ view: DialogSurfaceWindowAnchorView,
    coordinator: Coordinator,
  ) {
    view.onWindowChange = nil
    coordinator.presenter.dismissWithoutNotification()
  }

  @MainActor
  final class Coordinator {
    let presenter = DialogSurfacePresenter()
    var requestedPresentation = false
    var setPresented: (Bool) -> Void = { _ in }
    var dialogContent: () -> AnyView = { AnyView(EmptyView()) }

    func updatePresentation(from view: NSView) {
      guard requestedPresentation else {
        presenter.dismiss()
        return
      }
      guard let parentWindow = view.window else { return }

      if presenter.isPresented {
        presenter.update(content: dialogContent)
      } else {
        let didPresent = presenter.present(
          over: parentWindow,
          onDismiss: { [weak self] in
            guard let self, requestedPresentation else { return }
            requestedPresentation = false
            setPresented(false)
          },
          content: dialogContent,
        )
        if !didPresent {
          requestedPresentation = false
          setPresented(false)
        }
      }
    }
  }
}

@MainActor
private final class DialogSurfaceWindowAnchorView: NSView {
  var onWindowChange: (() -> Void)?

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    onWindowChange?()
  }
}

@MainActor
private final class DialogSurfacePanelPresentation {
  let panel: DialogSurfacePanel

  private weak var parentWindow: NSWindow?
  private let hostingController: NSHostingController<AnyView>
  private let onParentClose: () -> Void
  private var observers: [NSObjectProtocol] = []
  private var onDismiss: (() -> Void)?
  private var parentIsClosing = false

  init(
    panel: DialogSurfacePanel,
    parentWindow: NSWindow?,
    content: AnyView,
    onParentClose: @escaping () -> Void,
    onDismiss: (() -> Void)? = nil,
  ) {
    self.panel = panel
    self.parentWindow = parentWindow
    hostingController = NSHostingController(rootView: Self.rootView(content))
    self.onParentClose = onParentClose
    self.onDismiss = onDismiss
    panel.contentViewController = hostingController
  }

  func show() {
    configurePanel()

    if let parentWindow {
      synchronizeFrame()
      observe(parentWindow: parentWindow)
      parentWindow.addChildWindow(panel, ordered: .above)
    } else {
      panel.center()
    }

    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
  }

  func update(content: AnyView) {
    hostingController.rootView = Self.rootView(content)
  }

  func dismiss(notify: Bool = true) {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers.removeAll()

    if let parentWindow, panel.parent === parentWindow {
      parentWindow.removeChildWindow(panel)
      if parentWindow.isVisible, !parentIsClosing {
        parentWindow.makeKeyAndOrderFront(nil)
      }
    }
    panel.orderOut(nil)
    if notify {
      onDismiss?()
    }
    onDismiss = nil
  }

  private func configurePanel() {
    panel.identifier = NSUserInterfaceItemIdentifier("dialog.surface.panel")
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.isMovable = false
    panel.isOpaque = false
    panel.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace, .ignoresCycle]
    panel.level = .modalPanel
  }

  private func observe(parentWindow: NSWindow) {
    for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
      observers.append(
        NotificationCenter.default.addObserver(
          forName: name,
          object: parentWindow,
          queue: .main,
        ) { [weak self] _ in
          MainActor.assumeIsolated {
            self?.synchronizeFrame()
          }
        }
      )
    }
    observers.append(
      NotificationCenter.default.addObserver(
        forName: NSWindow.willCloseNotification,
        object: parentWindow,
        queue: .main,
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.parentIsClosing = true
          self?.onParentClose()
        }
      }
    )
  }

  private func synchronizeFrame() {
    guard let parentWindow else { return }
    panel.setFrame(parentWindow.frame, display: false)
  }

  private static func rootView(_ content: AnyView) -> AnyView {
    AnyView(
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityAddTraits(.isModal)
    )
  }
}

@MainActor
private final class DialogSurfacePanel: NSPanel {
  var keyDownHandler: ((NSEvent) -> Bool)?

  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }

  override func keyDown(with event: NSEvent) {
    guard keyDownHandler?(event) != true else { return }
    super.keyDown(with: event)
  }
}
