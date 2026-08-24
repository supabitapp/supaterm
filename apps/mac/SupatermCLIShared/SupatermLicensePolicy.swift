public enum SupatermLicensePolicy {
  public static let freeTabLimit = 5

  public static let salesEnabled: Bool = {
    #if SUPATERM_LICENSE_SALES_YES
      true
    #else
      false
    #endif
  }()
}
