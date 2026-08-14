import SupaTheme
import SwiftUI

extension SnapshotCatalog {
  static let hoverLinkScenarios: [SnapshotScenario] = [
    scenario(
      "hovered-link-corners",
      group: "Terminal Pane",
      title: "Hovered link corners",
      size: CGSize(width: 420, height: 400)
    ) { appearance in
      AnyView(HoverLinkSnapshotFixture(appearance: appearance))
    }
  ]
}

private struct HoverLinkSnapshotFixture: View {
  let appearance: SnapshotAppearance

  private let link = "https://supaterm.com/docs/links"
  private let longLink =
    "https://supaterm.com/docs/terminal/hovered-link-feedback?window=alpha&pane=right"

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme, backgroundSeed: appearance.terminalBackground)
  }

  private var terminalBackground: Color {
    appearance == .dark ? Color(red: 0.05, green: 0.06, blue: 0.07) : Color(white: 0.96)
  }

  var body: some View {
    VStack(spacing: 16) {
      presentation(link: link, pointerIsNearLeadingBanner: false)
      presentation(link: link, pointerIsNearLeadingBanner: true)
      presentation(link: longLink, pointerIsNearLeadingBanner: false)
        .frame(width: 240)
        .frame(maxWidth: .infinity, alignment: .leading)
      presentation(link: longLink, pointerIsNearLeadingBanner: true)
        .frame(width: 240)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
    .padding(16)
    .background(palette.detailBackground)
  }

  private func presentation(
    link: String,
    pointerIsNearLeadingBanner: Bool
  ) -> some View {
    GhosttySurfaceHoverLinkPresentation(
      link: link,
      palette: palette,
      pointerIsNearLeadingBanner: pointerIsNearLeadingBanner,
      onLeadingBannerHoverChange: { _ in }
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(terminalBackground)
    .clipShape(.rect(cornerRadius: 6))
  }
}
