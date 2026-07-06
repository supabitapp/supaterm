import CoreGraphics
import SwiftUI

enum GrainTexture {
  static let opacity = 0.03
  static let tile = makeTile()

  static func makeTile() -> CGImage {
    let size = 128
    var state: UInt64 = 0x9E37_79B9_7F4A_7C15
    var pixels = [UInt8](repeating: 0, count: size * size * 4)
    for index in 0..<(size * size) {
      state &+= 0x9E37_79B9_7F4A_7C15
      var mixed = state
      mixed = (mixed ^ (mixed >> 30)) &* 0xBF58_476D_1CE4_E5B9
      mixed = (mixed ^ (mixed >> 27)) &* 0x94D0_49BB_1331_11EB
      mixed ^= mixed >> 31
      let noise = Double(UInt8(truncatingIfNeeded: mixed)) / 255
      pixels[(index * 4) + 3] = UInt8((255 * opacity * (1 - noise)).rounded())
    }
    guard
      let provider = CGDataProvider(data: Data(pixels) as CFData),
      let image = CGImage(
        width: size,
        height: size,
        bitsPerComponent: 8,
        bitsPerPixel: 32,
        bytesPerRow: size * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
        provider: provider,
        decode: nil,
        shouldInterpolate: false,
        intent: .defaultIntent
      )
    else {
      preconditionFailure("grain tile construction is infallible for these parameters")
    }
    return image
  }
}

struct GrainOverlay: View {
  var body: some View {
    Image(decorative: GrainTexture.tile, scale: 1)
      .resizable(resizingMode: .tile)
      .allowsHitTesting(false)
  }
}
