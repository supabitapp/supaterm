import AppKit
import HoloKit
import SwiftUI

struct SettingsAboutIconRecipe {
  enum LayerKind: Equatable {
    case icon
    case prismBase
    case prismAccent
    case lightSweep
    case glint
  }

  let icon: NSImage
  let showsGlintLayer: Bool
  let showsPrismLayer: Bool

  var layerKinds: [LayerKind] {
    var kinds: [LayerKind] = [
      .icon,
      .prismBase,
    ]
    if showsPrismLayer {
      kinds.append(.prismAccent)
    }
    kinds.append(.lightSweep)
    if showsGlintLayer {
      kinds.append(.glint)
    }
    return kinds
  }

  var layers: [HoloLayer] {
    var layers: [HoloLayer] = [
      .content {
        scaledIcon(icon)
      },
      .prism(.spectrum, pattern: .bands)
        .intensity(0.4)
        .scale(1.32)
        .speed(0.42)
        .opacity(0.78)
        .blendMode(.overlay),
    ]

    if showsPrismLayer {
      layers.append(
        .prism(.aurora, pattern: .ripple)
          .intensity(0.22)
          .scale(1.48)
          .speed(0.52)
          .opacity(0.34)
          .blendMode(.screen)
      )
    }

    layers.append(
      .lightSweep(.white)
        .intensity(0.62)
        .size(0.3)
        .falloff(1.6)
        .opacity(0.68)
        .blendMode(.screen)
    )

    if showsGlintLayer {
      layers.append(
        .glintField()
          .density(0.46)
          .size(0.88)
          .speed(2.8)
          .opacity(0.46)
          .blendMode(.plusLighter)
      )
    }

    return layers
  }

  func mask() -> some View {
    scaledIcon(icon)
  }

  private func scaledIcon(_ image: NSImage) -> some View {
    Image(nsImage: image)
      .resizable()
      .interpolation(.high)
      .scaleEffect(1.12)
      .accessibilityHidden(true)
  }
}

struct SettingsHolographicIconView: View {
  let appName: String
  let showsGlintLayer: Bool
  let showsPrismLayer: Bool

  private let size = CGSize(width: 84, height: 84)
  private let cornerRadius: CGFloat = 21

  var body: some View {
    let icon = NSApplication.shared.applicationIconImage ?? NSImage()
    let recipe = SettingsAboutIconRecipe(
      icon: icon,
      showsGlintLayer: showsGlintLayer,
      showsPrismLayer: showsPrismLayer
    )

    HoloCard(layers: recipe.layers) {
      recipe.mask()
    }
    .holoSize(width: size.width, height: size.height)
    .holoCornerRadius(cornerRadius)
    .holoTilt(7)
    .holoParallax(6)
    .accessibilityLabel("\(appName) app icon")
  }
}
