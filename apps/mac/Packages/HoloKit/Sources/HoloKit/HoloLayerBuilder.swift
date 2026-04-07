@resultBuilder
public enum HoloLayerBuilder {
  public static func buildBlock(_ components: [HoloLayer]...) -> [HoloLayer] {
    components.flatMap { $0 }
  }

  public static func buildExpression(_ expression: HoloLayer) -> [HoloLayer] {
    [expression]
  }

  public static func buildOptional(_ component: [HoloLayer]?) -> [HoloLayer] {
    component ?? []
  }

  public static func buildEither(first component: [HoloLayer]) -> [HoloLayer] {
    component
  }

  public static func buildEither(second component: [HoloLayer]) -> [HoloLayer] {
    component
  }

  public static func buildArray(_ components: [[HoloLayer]]) -> [HoloLayer] {
    components.flatMap { $0 }
  }
}
