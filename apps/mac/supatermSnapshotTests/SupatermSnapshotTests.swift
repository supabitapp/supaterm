import AppKit
import SnapshotTesting
import SwiftUI
import Testing

@testable import supatermSnapshotCatalog

@MainActor
@Suite
struct SupatermSnapshotTests {
  @Test func catalogScenarios() {
    assertCatalogSnapshots(
      SnapshotCatalog.scenarios.filter { $0.group != SnapshotCatalog.keyboardShortcutPillGroup },
      testName: #function
    )
  }

  @Test func keyboardShortcutPills() {
    assertCatalogSnapshots(
      SnapshotCatalog.keyboardShortcutPillScenarios,
      testName: #function
    )
  }

  private func assertCatalogSnapshots(
    _ scenarios: [SnapshotScenario],
    testName: String
  ) {
    for scenario in scenarios {
      for appearance in scenario.appearances {
        assertSnapshot(
          of: image(scenario: scenario, appearance: appearance),
          as: .image(
            precision: 0.99,
            perceptualPrecision: 0.99
          ),
          named: scenario.snapshotName(appearance: appearance),
          testName: testName
        )
      }
    }
  }

  @Test func catalogGroups() {
    let groups = SnapshotCatalog.groupedScenarios(SnapshotCatalog.scenarios)

    #expect(groups.count < SnapshotCatalog.scenarios.count)
    #expect(Set(groups.map(\.id)).count == groups.count)
    #expect(
      groups.allSatisfy { group in
        group.scenarios.allSatisfy { scenario in
          scenario.group == group.title
        }
      }
    )
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
    let context = CGContext(
      data: nil,
      width: Int(scenario.size.width * scale),
      height: Int(scenario.size.height * scale),
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!
    context.setAllowsFontSmoothing(false)
    context.setShouldSmoothFonts(false)
    context.scaleBy(x: scale, y: scale)
    if view.isFlipped {
      context.translateBy(x: 0, y: scenario.size.height)
      context.scaleBy(x: 1, y: -1)
    }
    view.displayIgnoringOpacity(
      view.bounds,
      in: NSGraphicsContext(cgContext: context, flipped: view.isFlipped)
    )

    let image = NSImage(cgImage: context.makeImage()!, size: scenario.size)
    window.contentView = nil
    return image
  }
}

extension SnapshotScenario {
  fileprivate func snapshotName(appearance: SnapshotAppearance) -> String {
    "\(slug(group))-\(slug(id))-\(appearance.rawValue)"
  }

  private func slug(_ value: String) -> String {
    var result = ""
    var previousDash = false

    for scalar in value.lowercased().unicodeScalars {
      if CharacterSet.alphanumerics.contains(scalar) {
        result.unicodeScalars.append(scalar)
        previousDash = false
      } else if !previousDash {
        result.append("-")
        previousDash = true
      }
    }

    return result.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  }
}
