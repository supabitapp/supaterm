import AppKit
import CoreGraphics
import Testing

@testable import supaterm

@MainActor
struct TerminalHorizontalTabInteractionTests {
  @Test
  func controlClickOpensContextMenuWithoutSelecting() throws {
    let interaction = TerminalHorizontalTabInteraction()
    var contextEvents: [NSEvent] = []
    var pressCount = 0
    interaction.onContextMenu = { contextEvents.append($0) }
    interaction.onPress = { _ in pressCount += 1 }
    let event = try #require(mouseEvent(.leftMouseDown, modifiers: .control))

    interaction.mouseDown(with: event)

    #expect(contextEvents == [event])
    #expect(pressCount == 0)
    #expect(interaction.phase == .idle)
  }

  @Test
  func rightClickOpensContextMenuWithoutSelecting() throws {
    let interaction = TerminalHorizontalTabInteraction()
    var contextEvents: [NSEvent] = []
    var pressCount = 0
    interaction.onContextMenu = { contextEvents.append($0) }
    interaction.onPress = { _ in pressCount += 1 }
    let event = try #require(mouseEvent(.rightMouseDown))

    interaction.rightMouseDown(with: event)

    #expect(contextEvents == [event])
    #expect(pressCount == 0)
    #expect(interaction.phase == .idle)
  }

  @Test
  func middleClickClosesTabsAndActivatesGroups() throws {
    let interaction = TerminalHorizontalTabInteraction()
    var activationCount = 0
    var closeCount = 0
    interaction.onMiddleActivate = { activationCount += 1 }
    interaction.onMiddleClose = { closeCount += 1 }
    let event = try #require(mouseEvent(.otherMouseUp))

    interaction.middleClickAction = .close
    #expect(interaction.otherMouseUp(with: event))
    interaction.middleClickAction = .activate
    #expect(interaction.otherMouseUp(with: event))

    #expect(closeCount == 1)
    #expect(activationCount == 1)
  }

  @Test
  func startingADragCancelsClickAndLongPress() throws {
    let interaction = TerminalHorizontalTabInteraction()
    var releaseCount = 0
    var dragCount = 0
    interaction.onDrag = { _ in
      dragCount += 1
      return true
    }
    interaction.onRelease = { _ in releaseCount += 1 }
    let down = try #require(mouseEvent(.leftMouseDown))
    let dragged = try #require(mouseEvent(.leftMouseDragged))
    let up = try #require(mouseEvent(.leftMouseUp))

    interaction.mouseDown(with: down)
    interaction.mouseDragged(with: dragged)
    interaction.mouseUp(with: up)

    #expect(dragCount == 1)
    #expect(releaseCount == 0)
    #expect(interaction.phase == .idle)
  }

  @Test
  func longPressOpensContextMenuAndConsumesRelease() async throws {
    let interaction = TerminalHorizontalTabInteraction()
    var contextCount = 0
    var releaseCount = 0
    interaction.onContextMenu = { _ in contextCount += 1 }
    interaction.onRelease = { _ in releaseCount += 1 }
    let down = try #require(mouseEvent(.leftMouseDown))
    let up = try #require(mouseEvent(.leftMouseUp))

    interaction.mouseDown(with: down)
    try await Task.sleep(for: .milliseconds(350))
    interaction.mouseUp(with: up)

    #expect(contextCount == 1)
    #expect(releaseCount == 0)
    #expect(interaction.phase == .idle)
  }

  private func mouseEvent(
    _ type: NSEvent.EventType,
    modifiers: NSEvent.ModifierFlags = []
  ) -> NSEvent? {
    if type == .otherMouseUp {
      guard
        let event = CGEvent(
          mouseEventSource: CGEventSource(stateID: .hidSystemState),
          mouseType: .otherMouseUp,
          mouseCursorPosition: .zero,
          mouseButton: .center
        )
      else { return nil }
      return NSEvent(cgEvent: event)
    }
    return NSEvent.mouseEvent(
      with: type,
      location: .zero,
      modifierFlags: modifiers,
      timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: 0,
      context: nil,
      eventNumber: 1,
      clickCount: 1,
      pressure: type == .leftMouseDown ? 1 : 0
    )
  }
}
