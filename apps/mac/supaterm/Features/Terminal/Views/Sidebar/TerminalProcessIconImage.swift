import AppKit
import SupatermSupport
import SwiftUI

struct TerminalProcessIconImage: View {
  let icon: TerminalProcessIcon

  var body: some View {
    Group {
      if let image = TerminalProcessIconImageLoader.image(for: icon) {
        Image(nsImage: image)
          .renderingMode(.original)
          .resizable()
          .accessibilityHidden(true)
      } else {
        Image(systemName: "terminal.fill")
          .renderingMode(.template)
          .resizable()
          .accessibilityHidden(true)
      }
    }
  }
}

@MainActor
enum TerminalProcessIconImageLoader {
  private static let images = Dictionary(
    uniqueKeysWithValues: TerminalProcessIcon.allCases.compactMap { icon in
      let image = Bundle(for: TerminalProcessIconBundleToken.self)
        .url(
          forResource: icon.resourceName,
          withExtension: "svg",
          subdirectory: "PapirusIcons"
        )
        .flatMap(NSImage.init(contentsOf:))
      return image.map { (icon, $0) }
    }
  )

  static func image(for icon: TerminalProcessIcon) -> NSImage? {
    images[icon]
  }
}

private final class TerminalProcessIconBundleToken: NSObject {}
