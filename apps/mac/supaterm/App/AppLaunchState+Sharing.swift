import Foundation
import Sharing

extension SharedKey where Self == AppStorageKey<Date?>.Default {
  static var lastAppLaunchedDate: Self {
    Self[.appStorage("lastAppLaunchedDate"), default: nil]
  }
}
