import Foundation

enum ScriptError: Error, CustomStringConvertible {
  case invalidArgument(String)
  case missingLogo(URL)
  case missingLogoPath(URL)
  case missingPalette(URL)
  case missingTone(String)

  var description: String {
    switch self {
    case let .invalidArgument(message):
      message
    case let .missingLogo(url):
      "missing logo source: \(url.path)"
    case let .missingLogoPath(url):
      "missing logo path in: \(url.path)"
    case let .missingPalette(url):
      "missing palette source: \(url.path)"
    case let .missingTone(name):
      "missing reference tone: \(name)"
    }
  }
}

enum Scheme: String {
  case light
  case dark
}

struct RGB {
  let red: Double
  let green: Double
  let blue: Double

  init(hex: UInt32) {
    self.red = Double((hex >> 16) & 0xFF) / 255
    self.green = Double((hex >> 8) & 0xFF) / 255
    self.blue = Double(hex & 0xFF) / 255
  }

  init(red: Double, green: Double, blue: Double) {
    self.red = red
    self.green = green
    self.blue = blue
  }

  var svg: String {
    "#\(component(red))\(component(green))\(component(blue))"
  }

  func mixed(with other: RGB, by amount: Double) -> RGB {
    let t = min(max(amount, 0), 1)
    return RGB(
      red: red + (other.red - red) * t,
      green: green + (other.green - green) * t,
      blue: blue + (other.blue - blue) * t
    )
  }

  private func component(_ value: Double) -> String {
    String(format: "%02X", min(max(Int(round(value * 255)), 0), 255))
  }

  static let black = RGB(red: 0, green: 0, blue: 0)
  static let white = RGB(red: 1, green: 1, blue: 1)
}

struct Tone {
  let light: RGB
  let dark: RGB

  func color(for scheme: Scheme) -> RGB {
    scheme == .dark ? dark : light
  }
}

struct ReferencePalette {
  let neutral: Tone
  let rose: Tone
  let clay: Tone
  let gold: Tone
  let blue: Tone

  static func load() throws -> ReferencePalette {
    let sourceURL = try referencePaletteURL()
    let source = try String(contentsOf: sourceURL, encoding: .utf8)
    let pattern = #"(\w+):\s*ReferenceTone\(light:\s*ThemeColor\(hex:\s*0x([0-9A-Fa-f]{6})\),\s*dark:\s*ThemeColor\(hex:\s*0x([0-9A-Fa-f]{6})\)\)"#
    let regex = try NSRegularExpression(pattern: pattern)
    let range = NSRange(source.startIndex..<source.endIndex, in: source)
    var tones: [String: Tone] = [:]

    for match in regex.matches(in: source, range: range) {
      let name = source[Range(match.range(at: 1), in: source)!]
      let light = source[Range(match.range(at: 2), in: source)!]
      let dark = source[Range(match.range(at: 3), in: source)!]
      tones[String(name)] = Tone(
        light: RGB(hex: UInt32(light, radix: 16)!),
        dark: RGB(hex: UInt32(dark, radix: 16)!)
      )
    }

    return ReferencePalette(
      neutral: try tone("neutral", in: tones),
      rose: try tone("rose", in: tones),
      clay: try tone("clay", in: tones),
      gold: try tone("gold", in: tones),
      blue: try tone("blue", in: tones)
    )
  }

  private static func tone(_ name: String, in tones: [String: Tone]) throws -> Tone {
    guard let tone = tones[name] else { throw ScriptError.missingTone(name) }
    return tone
  }

  private static func referencePaletteURL() throws -> URL {
    let fileManager = FileManager.default
    let currentDirectory = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
    let scriptDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    let candidates = [
      currentDirectory.appendingPathComponent("apps/mac/SupaTheme/ReferencePalette.swift"),
      currentDirectory.appendingPathComponent("SupaTheme/ReferencePalette.swift"),
      scriptDirectory.deletingLastPathComponent().appendingPathComponent("SupaTheme/ReferencePalette.swift"),
    ]

    for candidate in candidates where fileManager.fileExists(atPath: candidate.path) {
      return candidate
    }

    throw ScriptError.missingPalette(candidates[0])
  }
}

struct LogoMark {
  let path: String

  static func load() throws -> LogoMark {
    let sourceURL = try logoURL()
    let source = try String(contentsOf: sourceURL, encoding: .utf8)
    let pattern = #"<path\s+d="([^"]+)""#
    let regex = try NSRegularExpression(pattern: pattern)
    let range = NSRange(source.startIndex..<source.endIndex, in: source)

    guard
      let match = regex.firstMatch(in: source, range: range),
      let pathRange = Range(match.range(at: 1), in: source)
    else {
      throw ScriptError.missingLogoPath(sourceURL)
    }

    return LogoMark(path: String(source[pathRange]))
  }

  private static func logoURL() throws -> URL {
    let fileManager = FileManager.default
    let currentDirectory = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
    let scriptDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    let candidates = [
      currentDirectory.appendingPathComponent("apps/supaterm.com/public/logo-mark.svg"),
      currentDirectory.appendingPathComponent("supaterm.com/public/logo-mark.svg"),
      scriptDirectory
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("supaterm.com/public/logo-mark.svg"),
    ]

    for candidate in candidates where fileManager.fileExists(atPath: candidate.path) {
      return candidate
    }

    throw ScriptError.missingLogo(candidates[0])
  }
}

struct Arguments {
  var output = "/tmp/supaterm-lightning-logo.svg"
  var scheme = Scheme.light

  init(_ values: [String]) throws {
    var index = 1
    while index < values.count {
      switch values[index] {
      case "--output":
        guard index + 1 < values.count else { throw ScriptError.invalidArgument("missing value for --output") }
        output = values[index + 1]
        index += 2
      case "--scheme":
        guard index + 1 < values.count else { throw ScriptError.invalidArgument("missing value for --scheme") }
        guard let parsedScheme = Scheme(rawValue: values[index + 1]) else {
          throw ScriptError.invalidArgument("--scheme must be light or dark")
        }
        scheme = parsedScheme
        index += 2
      case "--help", "-h":
        throw ScriptError.invalidArgument("usage: swift apps/mac/scripts/generate-lightning-logo-svg.swift [--scheme light|dark] [--output path]")
      default:
        throw ScriptError.invalidArgument("unknown argument: \(values[index])")
      }
    }
  }
}

func svg(palette: ReferencePalette, logoMark: LogoMark, scheme: Scheme) -> String {
  let neutral = palette.neutral.color(for: scheme)
  let rose = palette.rose.color(for: scheme)
  let clay = palette.clay.color(for: scheme)
  let gold = palette.gold.color(for: scheme)
  let blue = palette.blue.color(for: scheme)
  let tileTop = scheme == .dark ? neutral.mixed(with: .black, by: 0.82) : neutral.mixed(with: .white, by: 0.84)
  let tileBottom = scheme == .dark ? RGB.black.mixed(with: neutral, by: 0.16) : neutral.mixed(with: .white, by: 0.94)
  let warmMiddle = neutral.mixed(with: gold, by: scheme == .dark ? 0.68 : 0.58)
  let boltPath = logoMark.path

  return """
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Supaterm lightning logo">
    <defs>
      <linearGradient id="tileGradient" x1="512" y1="48" x2="512" y2="976" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="\(tileTop.svg)"/>
        <stop offset="1" stop-color="\(tileBottom.svg)"/>
      </linearGradient>
      <linearGradient id="boltGradient" x1="512" y1="108" x2="512" y2="916" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="\(blue.svg)"/>
        <stop offset="0.36" stop-color="\(blue.mixed(with: warmMiddle, by: 0.46).svg)"/>
        <stop offset="0.58" stop-color="\(warmMiddle.svg)"/>
        <stop offset="0.78" stop-color="\(gold.svg)"/>
        <stop offset="0.92" stop-color="\(clay.svg)"/>
        <stop offset="1" stop-color="\(rose.svg)"/>
      </linearGradient>
      <radialGradient id="boltHighlight" cx="42%" cy="18%" r="68%">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.62"/>
        <stop offset="0.42" stop-color="#FFFFFF" stop-opacity="0.28"/>
        <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
      </radialGradient>
      <filter id="tileShadow" x="-12%" y="-10%" width="124%" height="128%">
        <feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#000000" flood-opacity="0.18"/>
      </filter>
      <filter id="boltShadow" x="-22%" y="-16%" width="144%" height="150%">
        <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#1B2130" flood-opacity="0.24"/>
      </filter>
    </defs>
    <rect x="76" y="76" width="872" height="872" rx="176" fill="url(#tileGradient)" filter="url(#tileShadow)"/>
    <path d="\(boltPath)" fill="url(#boltGradient)" filter="url(#boltShadow)"/>
    <path d="\(boltPath)" fill="url(#boltHighlight)" opacity="0.82"/>
    <path d="\(boltPath)" fill="none" stroke="#FFFFFF" stroke-opacity="0.46" stroke-width="18" stroke-linejoin="round"/>
    <path d="\(boltPath)" fill="none" stroke="#000000" stroke-opacity="0.08" stroke-width="3" stroke-linejoin="round"/>
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
  try svg(palette: try ReferencePalette.load(), logoMark: try LogoMark.load(), scheme: arguments.scheme).write(
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
