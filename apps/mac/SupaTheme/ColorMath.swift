import Foundation

public enum ColorMath {
  public struct OKLab: Equatable {
    public let lightness: Double
    public let a: Double
    public let b: Double

    public init(lightness: Double, a: Double, b: Double) {
      self.lightness = lightness
      self.a = a
      self.b = b
    }
  }

  public struct OKLCH: Equatable {
    public let lightness: Double
    public let chroma: Double
    public let hue: Double

    public init(lightness: Double, chroma: Double, hue: Double) {
      self.lightness = lightness
      self.chroma = chroma
      self.hue = hue
    }
  }

  public static func clamped(_ value: Double) -> Double {
    min(max(value, 0), 1)
  }

  public static func relativeLuminance(_ color: ThemeColor) -> Double {
    let red = linearComponent(color.red)
    let green = linearComponent(color.green)
    let blue = linearComponent(color.blue)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }

  public static func contrastRatio(_ first: ThemeColor, _ second: ThemeColor) -> Double {
    let firstLuminance = relativeLuminance(first)
    let secondLuminance = relativeLuminance(second)
    let lighter = max(firstLuminance, secondLuminance)
    let darker = min(firstLuminance, secondLuminance)
    return (lighter + 0.05) / (darker + 0.05)
  }

  public static func readableForeground(on background: ThemeColor) -> ThemeColor {
    contrastRatio(.white, background) >= contrastRatio(.black, background) ? .white : .black
  }

  public static func oklch(from color: ThemeColor) -> OKLCH {
    let lab = oklab(from: color)
    let chroma = sqrt(lab.a * lab.a + lab.b * lab.b)
    let hue = atan2(lab.b, lab.a)
    return OKLCH(lightness: lab.lightness, chroma: chroma, hue: hue)
  }

  public static func color(from oklch: OKLCH) -> ThemeColor {
    let a = cos(oklch.hue) * oklch.chroma
    let b = sin(oklch.hue) * oklch.chroma
    return color(from: OKLab(lightness: oklch.lightness, a: a, b: b))
  }

  public static func clampedColor(from oklch: OKLCH) -> ThemeColor {
    var chroma = max(oklch.chroma, 0)
    for _ in 0..<64 {
      let color = color(
        from: OKLCH(
          lightness: clamped(oklch.lightness),
          chroma: chroma,
          hue: oklch.hue
        )
      )
      if isInSRGB(color) {
        return color
      }
      chroma *= 0.94
    }
    let gray = color(
      from: OKLCH(
        lightness: clamped(oklch.lightness),
        chroma: 0,
        hue: 0
      )
    )
    return ThemeColor(
      red: clamped(gray.red),
      green: clamped(gray.green),
      blue: clamped(gray.blue)
    )
  }

  public static func adjustedForContrast(
    anchor: ThemeColor,
    against background: ThemeColor,
    minimumContrast: Double
  ) -> ThemeColor {
    if contrastRatio(anchor, background) >= minimumContrast {
      return anchor
    }

    let source = oklch(from: anchor)
    let targetLightness = relativeLuminance(background) < 0.35 ? 1.0 : 0.0
    let stepCount = 160

    for index in 1...stepCount {
      let progress = Double(index) / Double(stepCount)
      let lightness = source.lightness + (targetLightness - source.lightness) * progress
      let color = clampedColor(
        from: OKLCH(
          lightness: lightness,
          chroma: source.chroma,
          hue: source.hue
        )
      )
      if contrastRatio(color, background) >= minimumContrast {
        return color
      }
    }

    let foreground = readableForeground(on: background)
    return contrastRatio(foreground, background) >= minimumContrast ? foreground : anchor
  }

  private static func linearComponent(_ component: Double) -> Double {
    let value = clamped(component)
    if value <= 0.04045 {
      return value / 12.92
    }
    return pow((value + 0.055) / 1.055, 2.4)
  }

  private static func encodedComponent(_ component: Double) -> Double {
    if component <= 0.0031308 {
      return 12.92 * component
    }
    return 1.055 * pow(component, 1 / 2.4) - 0.055
  }

  private static func oklab(from color: ThemeColor) -> OKLab {
    let red = linearComponent(color.red)
    let green = linearComponent(color.green)
    let blue = linearComponent(color.blue)

    let l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue
    let m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue
    let s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue

    let lRoot = cbrt(l)
    let mRoot = cbrt(m)
    let sRoot = cbrt(s)

    return OKLab(
      lightness: 0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot,
      a: 1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot,
      b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot
    )
  }

  private static func color(from lab: OKLab) -> ThemeColor {
    let lRoot = lab.lightness + 0.3963377774 * lab.a + 0.2158037573 * lab.b
    let mRoot = lab.lightness - 0.1055613458 * lab.a - 0.0638541728 * lab.b
    let sRoot = lab.lightness - 0.0894841775 * lab.a - 1.2914855480 * lab.b

    let l = lRoot * lRoot * lRoot
    let m = mRoot * mRoot * mRoot
    let s = sRoot * sRoot * sRoot

    let red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    let green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    let blue = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

    return ThemeColor(
      red: encodedComponent(red),
      green: encodedComponent(green),
      blue: encodedComponent(blue)
    )
  }

  private static func isInSRGB(_ color: ThemeColor) -> Bool {
    color.red >= 0 && color.red <= 1
      && color.green >= 0 && color.green <= 1
      && color.blue >= 0 && color.blue <= 1
  }
}
