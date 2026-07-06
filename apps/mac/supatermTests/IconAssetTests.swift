import Foundation
import Testing

struct IconAssetTests {
  @Test
  func lucideIconsUseTemplateVectorImagesets() throws {
    for iconName in ["git-branch", "git-pull-request-arrow", "goal"] {
      let svg = try templateVectorImagesetSVG(iconName)

      #expect(svg.contains("lucide-\(iconName)"))
      #expect(svg.contains(#"stroke="currentColor""#))
    }
  }

  @Test
  func githubUsesPaddedTemplateVectorImageset() throws {
    let svg = try templateVectorImagesetSVG("github")

    #expect(svg.contains(#"viewBox="-1 -1 26 26""#))
    #expect(svg.contains(#"fill="currentColor""#))
  }

  private func templateVectorImagesetSVG(_ iconName: String) throws -> String {
    let imagesetURL = assetsURL().appendingPathComponent("\(iconName).imageset")
    let contentsURL = imagesetURL.appendingPathComponent("Contents.json")
    let svgURL = imagesetURL.appendingPathComponent("\(iconName).svg")
    let contents = try Data(contentsOf: contentsURL)
    let object = try #require(
      JSONSerialization.jsonObject(with: contents) as? [String: Any]
    )
    let images = try #require(object["images"] as? [[String: Any]])
    let properties = try #require(object["properties"] as? [String: Any])

    #expect(
      images.contains {
        $0["filename"] as? String == "\(iconName).svg"
          && $0["idiom"] as? String == "universal"
      }
    )
    #expect(properties["preserves-vector-representation"] as? Bool == true)
    #expect(properties["template-rendering-intent"] as? String == "template")

    return try String(contentsOf: svgURL, encoding: .utf8)
  }

  private func assetsURL(filePath: StaticString = #filePath) -> URL {
    URL(fileURLWithPath: "\(filePath)")
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("supaterm/Assets.xcassets", isDirectory: true)
  }
}
