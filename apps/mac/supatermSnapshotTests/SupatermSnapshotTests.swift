import AppKit
import SnapshotTesting
import SwiftUI
import Testing

@testable import supatermSnapshotCatalog

@MainActor
@Suite
struct SupatermSnapshotTests {
  @Test func catalogScenarios() {
    for scenario in SnapshotCatalog.scenarios {
      for appearance in scenario.appearances {
        assertSnapshot(
          of: image(scenario: scenario, appearance: appearance),
          as: .image(
            precision: 0.99,
            perceptualPrecision: 0.99
          ),
          named: scenario.snapshotName(appearance: appearance)
        )
      }
    }
  }

  private func image(
    scenario: SnapshotScenario,
    appearance: SnapshotAppearance
  ) -> NSImage {
    let view = NSHostingView(
      rootView: SnapshotCatalogScenarioRender(
        appearance: appearance,
        scenario: scenario
      )
    )
    let frame = CGRect(origin: .zero, size: scenario.size)
    let window = NSWindow(
      contentRect: frame,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentView = view
    view.frame = frame
    window.contentView?.layoutSubtreeIfNeeded()
    view.layoutSubtreeIfNeeded()
    view.displayIfNeeded()

    let scale = 2.0
    let representation = NSBitmapImageRep(
      bitmapDataPlanes: nil,
      pixelsWide: Int(scenario.size.width * scale),
      pixelsHigh: Int(scenario.size.height * scale),
      bitsPerSample: 8,
      samplesPerPixel: 4,
      hasAlpha: true,
      isPlanar: false,
      colorSpaceName: .deviceRGB,
      bytesPerRow: 0,
      bitsPerPixel: 0
    )!
    representation.size = scenario.size
    view.cacheDisplay(in: view.bounds, to: representation)

    let image = NSImage(size: scenario.size)
    image.addRepresentation(representation)
    window.contentView = nil
    return image
  }
}
