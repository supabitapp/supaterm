import AppKit
import SwiftUI

enum GhosttyEffectiveAppearance {
  typealias Observer = (
    _ handler: @escaping @MainActor (NSAppearance) -> Void
  ) -> () -> Void

  static func observe(_ handler: @escaping @MainActor (NSAppearance) -> Void) -> () -> Void {
    let observation = NSApp.observe(\.effectiveAppearance, options: [.initial, .new]) {
      application, _ in
      MainActor.assumeIsolated {
        handler(application.effectiveAppearance)
      }
    }
    return {
      observation.invalidate()
    }
  }

  static func colorScheme(for appearance: NSAppearance) -> ColorScheme {
    appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .dark : .light
  }
}
