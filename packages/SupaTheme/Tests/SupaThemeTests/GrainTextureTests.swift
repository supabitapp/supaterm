import CoreGraphics
import Foundation
import Testing

@testable import SupaTheme

struct GrainTextureTests {
  @Test func tileIsDeterministic() {
    let first = GrainTexture.makeTile()
    let second = GrainTexture.makeTile()
    #expect(pixelBytes(of: first) == pixelBytes(of: second))
    #expect(pixelBytes(of: first) == pixelBytes(of: GrainTexture.tile))
  }

  @Test func tileDimensions() {
    #expect(GrainTexture.tile.width == 128)
    #expect(GrainTexture.tile.height == 128)
    #expect(GrainTexture.tile.bitsPerPixel == 32)
  }

  private func pixelBytes(of image: CGImage) -> Data {
    guard let data = image.dataProvider?.data else { return Data() }
    return data as Data
  }
}
