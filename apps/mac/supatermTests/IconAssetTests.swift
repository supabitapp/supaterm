import Foundation
import Testing

@testable import SupatermSupport

struct IconAssetTests {
  @Test
  func lucideIconsUseTemplateVectorImagesets() throws {
    for iconName in [
      "git-branch",
      "git-merge",
      "git-pull-request",
      "git-pull-request-closed",
      "git-pull-request-draft",
    ] {
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

  @Test
  func commonCodingAgentMarksUseLobeTemplateVectorImagesets() throws {
    for (iconName, title) in [
      ("amp-mark", "Amp"),
      ("antigravity-mark", "Antigravity"),
      ("cline-mark", "Cline"),
      ("copilot-mark", "Copilot"),
      ("cursor-mark", "Cursor"),
      ("geminicli-mark", "Gemini CLI"),
      ("goose-mark", "Goose"),
      ("grok-mark", "Grok"),
      ("hermesagent-mark", "Hermes Agent"),
      ("kimi-mark", "Kimi"),
      ("opencode-mark", "opencode"),
      ("qwen-mark", "Qwen"),
    ] {
      let svg = try templateVectorImagesetSVG(iconName)

      #expect(svg.contains("<title>\(title)</title>"))
      #expect(svg.contains(#"fill="currentColor""#))
    }
  }

  @Test
  func everyDetectedCodingAgentHasAMark() throws {
    for agent in TerminalCodingAgentCatalog.all {
      _ = try vectorImagesetSVG(agent.markImageName, expectsTemplate: false)
    }
  }

  private func templateVectorImagesetSVG(_ iconName: String) throws -> String {
    try vectorImagesetSVG(iconName, expectsTemplate: true)
  }

  private func vectorImagesetSVG(
    _ iconName: String,
    expectsTemplate: Bool
  ) throws -> String {
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
    if expectsTemplate {
      #expect(properties["template-rendering-intent"] as? String == "template")
    }

    return try String(contentsOf: svgURL, encoding: .utf8)
  }

  private func assetsURL(filePath: StaticString = #filePath) -> URL {
    URL(fileURLWithPath: "\(filePath)")
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("supaterm/Assets.xcassets", isDirectory: true)
  }
}
