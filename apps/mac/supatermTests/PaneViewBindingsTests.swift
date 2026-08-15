import Foundation
import SupatermTerminalCore
import Testing

@testable import supaterm

struct PaneViewBindingsTests {
  @Test
  func viewsExposeEveryBoundView() {
    let firstView = BoundView()
    let secondView = BoundView()
    var bindings = PaneViewBindings<BoundView>()

    bindings.bind(firstView, to: PaneID())
    bindings.bind(secondView, to: PaneID())

    #expect(
      Set(bindings.views.map(ObjectIdentifier.init)) == [
        ObjectIdentifier(firstView),
        ObjectIdentifier(secondView),
      ])
  }

  @Test
  func removeAllClearsPaneAndViewLookups() {
    let paneID = PaneID()
    let view = BoundView()
    var bindings = PaneViewBindings<BoundView>()
    bindings.bind(view, to: paneID)

    bindings.removeAll()

    #expect(bindings[paneID] == nil)
    #expect(bindings.paneID(for: view) == nil)
    #expect(bindings.paneIDs.isEmpty)
    #expect(bindings.views.isEmpty)
  }

  @Test
  func uuidLookupFindsIdentifiableView() {
    let boundView = BoundView()
    let unboundView = BoundView()
    var bindings = PaneViewBindings<BoundView>()
    bindings.bind(boundView, to: PaneID())

    #expect(bindings[boundView.id] === boundView)
    #expect(bindings[unboundView.id] == nil)
  }

  @Test
  func bindingsMaintainOnePanePerView() {
    let firstPaneID = PaneID()
    let secondPaneID = PaneID()
    let firstView = BoundView()
    let secondView = BoundView()
    var bindings = PaneViewBindings<BoundView>()

    bindings.bind(firstView, to: firstPaneID)
    bindings.bind(secondView, to: secondPaneID)

    #expect(bindings[firstPaneID] === firstView)
    #expect(bindings[secondPaneID] === secondView)
    #expect(bindings.paneID(for: firstView) == firstPaneID)

    bindings.bind(firstView, to: secondPaneID)

    #expect(bindings[firstPaneID] == nil)
    #expect(bindings[secondPaneID] === firstView)
    #expect(bindings.paneID(for: secondView) == nil)
    #expect(bindings.paneIDs == [secondPaneID])
    let unboundView = bindings.unbind(secondPaneID)
    #expect(unboundView === firstView)
    #expect(bindings.paneIDs.isEmpty)
  }
}

private final class BoundView: Identifiable {
  let id = UUID()
}
