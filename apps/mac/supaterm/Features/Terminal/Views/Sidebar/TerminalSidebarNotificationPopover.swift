import AppKit
import SwiftUI
import Textual

struct SidebarPopoverPresenter: NSViewRepresentable {
  let isPresented: Bool
  let palette: TerminalPalette
  let markdown: String?

  func makeNSView(context: Context) -> SidebarPopoverAnchorView {
    let view = SidebarPopoverAnchorView()
    update(view)
    return view
  }

  func updateNSView(_ nsView: SidebarPopoverAnchorView, context: Context) {
    update(nsView)
  }

  static func dismantleNSView(
    _ nsView: SidebarPopoverAnchorView,
    coordinator: ()
  ) {
    nsView.closePopover()
  }

  private func update(_ view: SidebarPopoverAnchorView) {
    view.render(
      isPresented: isPresented,
      palette: palette,
      markdown: markdown
    )
  }
}

private struct TerminalSidebarNotificationPopover: View {
  let palette: TerminalPalette
  let markdown: String

  private let cornerRadius: CGFloat = 14
  private let popoverWidth: CGFloat = 320
  private let popoverPadding: CGFloat = 12

  private var contentWidth: CGFloat {
    popoverWidth - (popoverPadding * 2)
  }

  var body: some View {
    StructuredText(
      markdown,
      parser: SidebarNotificationMarkdown.popoverParser
    )
    .font(.system(size: 12))
    .foregroundStyle(palette.primaryText)
    .textual.structuredTextStyle(.gitHub)
    .textual.overflowMode(.wrap)
    .frame(width: contentWidth, alignment: .leading)
    .fixedSize(horizontal: false, vertical: true)
    .multilineTextAlignment(.leading)
    .padding(popoverPadding)
    .frame(width: popoverWidth, alignment: .topLeading)
    .allowsHitTesting(false)
    .background(palette.windowBackgroundTint, in: .rect(cornerRadius: cornerRadius))
    .background {
      BlurEffectView(material: .popover, blendingMode: .withinWindow)
        .clipShape(.rect(cornerRadius: cornerRadius))
    }
    .compositingGroup()
    .clipShape(.rect(cornerRadius: cornerRadius))
    .overlay {
      RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        .stroke(palette.detailStroke, lineWidth: 0.5)
    }
    .shadow(color: palette.shadow, radius: 18, y: 10)
  }
}

enum SidebarNotificationMarkdown {
  static let popoverParser = AttributedStringMarkdownParser(
    baseURL: nil,
    options: .init(failurePolicy: .returnPartiallyParsedIfPossible)
  )
}

final class SidebarPopoverAnchorView: NSView {
  private var hostingController: NSHostingController<TerminalSidebarNotificationPopover>?
  private var popover: NSPopover?

  override func hitTest(_ point: NSPoint) -> NSView? {
    nil
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil {
      closePopover()
    }
  }

  func render(
    isPresented: Bool,
    palette: TerminalPalette,
    markdown: String?
  ) {
    guard isPresented, let markdown, window != nil else {
      closePopover()
      return
    }

    let content = TerminalSidebarNotificationPopover(
      palette: palette,
      markdown: markdown
    )

    if let hostingController {
      hostingController.rootView = content
    } else {
      hostingController = NSHostingController(rootView: content)
    }

    guard let hostingController else { return }
    hostingController.view.layoutSubtreeIfNeeded()

    let popover = self.popover ?? NSPopover()
    popover.behavior = .applicationDefined
    popover.contentViewController = hostingController
    popover.contentSize = hostingController.view.fittingSize
    self.popover = popover

    if !popover.isShown {
      popover.show(relativeTo: bounds, of: self, preferredEdge: .maxX)
    }
  }

  func closePopover() {
    guard let popover, popover.isShown else { return }
    popover.close()
  }
}
