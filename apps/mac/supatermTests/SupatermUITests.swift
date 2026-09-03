import AppKit
import SwiftUI
import Testing

@testable import SupatermUI

@MainActor
struct SupatermUITests {
  @Test
  func dialogPresenterAttachesToParentAndRemovesItselfOnDismissal() throws {
    let parent = NSWindow(
      contentRect: NSRect(x: 20, y: 20, width: 600, height: 400),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    parent.makeKeyAndOrderFront(nil)
    defer { parent.orderOut(nil) }

    let presenter = DialogSurfacePresenter()
    #expect(
      presenter.present(over: parent) {
        DialogSurface(title: "Test dialog")
      }
    )

    let panel = try #require(
      parent.childWindows?.first {
        $0.identifier?.rawValue == "dialog.surface.panel"
      }
    )
    #expect(panel.frame == parent.frame)

    presenter.dismiss()

    #expect(parent.childWindows?.contains(panel) == false)
  }

  @Test
  func oneTimeCodeKeepsDigitsAndLimitsLength() {
    #expect(DialogOneTimeCodeValue.normalized(" 12a-345 67", length: 6) == "123456")
    #expect(DialogOneTimeCodeValue.normalized("abc", length: 6).isEmpty)
    #expect(DialogOneTimeCodeValue.normalized("123", length: 0).isEmpty)
  }

  @Test
  func searchSelectionWrapsAndSkipsDisabledItems() {
    let items = [
      SearchPanelItem(id: "first", title: "First"),
      SearchPanelItem(id: "disabled", title: "Disabled", isEnabled: false),
      SearchPanelItem(id: "last", title: "Last"),
    ]

    #expect(SearchPanelSelection.moved(nil, in: items, by: 1) == "first")
    #expect(SearchPanelSelection.moved("first", in: items, by: 1) == "last")
    #expect(SearchPanelSelection.moved("last", in: items, by: 1) == "first")
    #expect(SearchPanelSelection.moved("first", in: items, by: -1) == "last")
  }

  @Test
  func searchSelectionMovesWhenSelectedItemBecomesDisabled() {
    let items = [
      SearchPanelItem(id: "first", title: "First"),
      SearchPanelItem(id: "selected", title: "Selected", isEnabled: false),
    ]

    #expect(SearchPanelSelection.normalized("selected", in: items) == "first")
    #expect(SearchPanelSelection.normalized("first", in: items) == "first")
  }

  @Test
  func trailingResizeMovesTrailingEdge() {
    let geometry = PopoverSurfaceGeometry(
      size: CGSize(width: 300, height: 200),
      offset: CGSize(width: 20, height: 10)
    )

    let resized = PopoverSurfaceResizeHandle.trailing.resized(
      geometry: geometry,
      translation: CGSize(width: 80, height: 40),
      limits: PopoverSurfaceLimits()
    )

    #expect(resized.size == CGSize(width: 380, height: 200))
    #expect(resized.offset == CGSize(width: 60, height: 10))
  }

  @Test
  func topLeadingResizeKeepsOppositeCornerFixed() {
    let geometry = PopoverSurfaceGeometry(
      size: CGSize(width: 300, height: 200),
      offset: .zero
    )

    let resized = PopoverSurfaceResizeHandle.topLeading.resized(
      geometry: geometry,
      translation: CGSize(width: -40, height: -20),
      limits: PopoverSurfaceLimits()
    )

    #expect(resized.size == CGSize(width: 340, height: 220))
    #expect(resized.offset == CGSize(width: -20, height: -10))
  }

  @Test
  func resizeHonorsMinimumAndMaximumSize() {
    let limits = PopoverSurfaceLimits(
      minimumSize: CGSize(width: 200, height: 100),
      maximumSize: CGSize(width: 400, height: 300)
    )
    let geometry = PopoverSurfaceGeometry(size: CGSize(width: 300, height: 200))

    let minimum = PopoverSurfaceResizeHandle.bottomLeading.resized(
      geometry: geometry,
      translation: CGSize(width: 500, height: -500),
      limits: limits
    )
    let maximum = PopoverSurfaceResizeHandle.bottomTrailing.resized(
      geometry: geometry,
      translation: CGSize(width: 500, height: 500),
      limits: limits
    )

    #expect(minimum.size == limits.minimumSize)
    #expect(minimum.offset == CGSize(width: 50, height: -50))
    #expect(maximum.size == limits.maximumSize)
    #expect(maximum.offset == CGSize(width: 50, height: 50))
  }
}
