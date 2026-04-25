import AppKit
import SwiftUI

struct AgentInstallFailureAlertPresenter: NSViewRepresentable {
  let failure: SettingsAgentIntegrationInstallFailure?
  let dismiss: () -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator()
  }

  func makeNSView(context: Context) -> NSView {
    NSView(frame: .zero)
  }

  func updateNSView(_ view: NSView, context: Context) {
    context.coordinator.dismiss = dismiss
    context.coordinator.update(failure: failure, in: view)
  }

  final class Coordinator {
    var dismiss: () -> Void = {}
    private var presentedID: String?

    func update(failure: SettingsAgentIntegrationInstallFailure?, in view: NSView) {
      guard let failure else {
        return
      }
      guard presentedID != failure.id else {
        return
      }
      presentedID = failure.id
      DispatchQueue.main.async { [weak self, weak view] in
        self?.present(failure: failure, in: view)
      }
    }

    private func present(failure: SettingsAgentIntegrationInstallFailure, in view: NSView?) {
      guard presentedID == failure.id else {
        return
      }
      guard let window = view?.window ?? NSApp.keyWindow else {
        presentedID = nil
        return
      }

      let alert = NSAlert()
      alert.alertStyle = .warning
      alert.messageText = failure.title
      alert.informativeText = failure.message
      alert.addButton(withTitle: "OK")
      alert.accessoryView = logView(failure.log)
      alert.beginSheetModal(for: window) { [weak self] _ in
        self?.presentedID = nil
        self?.dismiss()
      }
    }

    private func logView(_ log: String) -> NSView {
      let scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: 520, height: 220))
      scrollView.borderType = .bezelBorder
      scrollView.hasVerticalScroller = true
      scrollView.autohidesScrollers = false

      let textView = NSTextView(frame: scrollView.bounds)
      textView.autoresizingMask = [.width]
      textView.backgroundColor = .textBackgroundColor
      textView.drawsBackground = true
      textView.font = .monospacedSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular)
      textView.isEditable = false
      textView.isHorizontallyResizable = false
      textView.isSelectable = true
      textView.isVerticallyResizable = true
      textView.maxSize = NSSize(
        width: CGFloat.greatestFiniteMagnitude,
        height: CGFloat.greatestFiniteMagnitude
      )
      textView.minSize = NSSize(width: 0, height: scrollView.contentSize.height)
      textView.string = log
      textView.textContainer?.containerSize = NSSize(
        width: scrollView.contentSize.width,
        height: CGFloat.greatestFiniteMagnitude
      )
      textView.textContainer?.widthTracksTextView = true
      textView.textContainerInset = NSSize(width: 8, height: 8)

      scrollView.documentView = textView
      return scrollView
    }
  }
}
