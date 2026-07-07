import Foundation
import SupaTheme

enum ScriptError: Error, CustomStringConvertible {
  case invalidArgument(String)
  case missingLogo(URL)
  case missingLogoPath(URL)

  var description: String {
    switch self {
    case .invalidArgument(let message):
      message
    case .missingLogo(let url):
      "missing logo source: \(url.path)"
    case .missingLogoPath(let url):
      "missing logo path in: \(url.path)"
    }
  }
}

struct LogoMark {
  let path: String

  static func load() throws -> LogoMark {
    let sourceURL = try logoURL()
    let document = try XMLDocument(contentsOf: sourceURL, options: [])
    let path = try document.nodes(forXPath: "//*[local-name()='path']").first as? XMLElement

    guard let pathData = path?.attribute(forName: "d")?.stringValue else {
      throw ScriptError.missingLogoPath(sourceURL)
    }

    return LogoMark(path: pathData)
  }

  private static func logoURL() throws -> URL {
    let fileManager = FileManager.default
    let currentDirectory = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
    let sourceDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    let appRoot = sourceDirectory.deletingLastPathComponent()
    let appsRoot = appRoot.deletingLastPathComponent()
    let candidates = [
      currentDirectory.appendingPathComponent("apps/supaterm.com/public/logo-mark.svg"),
      currentDirectory.appendingPathComponent("../supaterm.com/public/logo-mark.svg"),
      appsRoot.appendingPathComponent("supaterm.com/public/logo-mark.svg"),
    ]

    for candidate in candidates where fileManager.fileExists(atPath: candidate.path) {
      return candidate
    }

    throw ScriptError.missingLogo(candidates[0])
  }
}

struct Arguments {
  var output = "/tmp/supaterm-lightning-logo.svg"

  init(_ values: [String]) throws {
    var index = 1
    while index < values.count {
      switch values[index] {
      case "--output":
        guard index + 1 < values.count else { throw ScriptError.invalidArgument("missing value for --output") }
        output = values[index + 1]
        index += 2
      case "--help", "-h":
        throw ScriptError.invalidArgument("usage: SupaThemeLogoGenerator [--output path]")
      default:
        throw ScriptError.invalidArgument("unknown argument: \(values[index])")
      }
    }
  }
}

extension ThemeColor {
  var svg: String {
    "#\(component(red))\(component(green))\(component(blue))"
  }

  private func component(_ value: Double) -> String {
    String(format: "%02X", min(max(Int(round(value * 255)), 0), 255))
  }
}

extension Double {
  var svgOffset: String {
    rounded(.towardZero) == self ? String(Int(self)) : String(self)
  }
}

func logoGradientStops() -> [(offset: Double, color: ThemeColor)] {
  let top = ThemeColor(hex: 0x2F7EC8)
  let sun = ThemeColor(hex: 0xF0C766)
  let spark = ThemeColor(hex: 0xF39A34)
  let tail = ThemeColor(hex: 0xC84F62)
  return [
    (0, top),
    (0.36, ColorMath.perceptualMix(top, sun, by: 0.36 / 0.54)),
    (0.58, ColorMath.perceptualMix(sun, spark, by: (0.58 - 0.54) / (0.78 - 0.54))),
    (0.78, spark),
    (0.92, ColorMath.perceptualMix(spark, tail, by: (0.92 - 0.78) / (1 - 0.78))),
    (1, tail),
  ]
}

func svg(logoMark: LogoMark) -> String {
  let boltPath = logoMark.path
  let stops = logoGradientStops()
    .map { #"      <stop offset="\#($0.offset.svgOffset)" stop-color="\#($0.color.svg)"/>"# }
    .joined(separator: "\n")

  return """
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Supaterm lightning logo">
      <defs>
        <linearGradient id="boltGradient" x1="512" y1="108" x2="512" y2="916" gradientUnits="userSpaceOnUse">
    \(stops)
        </linearGradient>
      </defs>
      <path d="\(boltPath)" fill="url(#boltGradient)"/>
    </svg>
    """
}

do {
  let arguments = try Arguments(CommandLine.arguments)
  let outputURL = URL(fileURLWithPath: arguments.output)
  try FileManager.default.createDirectory(
    at: outputURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try svg(logoMark: try LogoMark.load()).write(
    to: outputURL,
    atomically: true,
    encoding: .utf8
  )
  print(outputURL.path)
} catch let error as ScriptError {
  fputs("error: \(error.description)\n", stderr)
  exit(64)
} catch {
  fputs("error: \(error)\n", stderr)
  exit(1)
}
