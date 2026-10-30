import ExpoModulesCore
import UIKit

final class SupatermSidebarTabBarView: ExpoView, UITabBarDelegate {
  let onSelectionChange = EventDispatcher()
  private let tabBar = UITabBar()
  var tabs = ["threads", "pullRequests", "usage", "settings"] { didSet { updateItems() } }
  var selectedTab = "threads" { didSet { updateSelection() } }
  var selectedIndex = 0 { didSet { if tabs.indices.contains(selectedIndex) { selectedTab = tabs[selectedIndex] } } }
  var selectedColor: UIColor = .systemBlue { didSet { tabBar.tintColor = selectedColor } }
  var appearance = "light" {
    didSet { overrideUserInterfaceStyle = appearance == "dark" ? .dark : .light }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    updateItems()
    tabBar.itemPositioning = .fill
    tabBar.delegate = self
    addSubview(tabBar)
    updateSelection()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    tabBar.frame = bounds
    updateSelection()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateSelection()
  }

  private func tabIcon(_ image: UIImage?) -> UIImage? {
    guard let image else { return nil }
    let canvas = CGSize(width: 28, height: 28)
    let scale = min(24 / image.size.width, 24 / image.size.height)
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    return UIGraphicsImageRenderer(size: canvas).image { _ in
      image.draw(in: CGRect(x: (canvas.width - size.width) / 2, y: (canvas.height - size.height) / 2, width: size.width, height: size.height))
    }.withRenderingMode(.alwaysTemplate)
  }

  private func updateItems() {
    let iconBundle = Bundle(for: Self.self).url(forResource: "SupatermNativeControlIcons", withExtension: "bundle").flatMap(Bundle.init(url:))
    let pullRequestIcon = UIImage(named: "pull-request", in: iconBundle, compatibleWith: nil)?.withRenderingMode(.alwaysTemplate)
    let titles = ["threads": "Threads", "pullRequests": "Pulls", "usage": "Usage", "settings": "Settings"]
    let symbols = ["threads": "text.bubble", "usage": "chart.bar.xaxis", "settings": "gearshape"]
    tabBar.items = tabs.enumerated().map { index, tab in
      let image = tab == "pullRequests" ? pullRequestIcon : symbols[tab].flatMap(UIImage.init(systemName:))
      let item = UITabBarItem(title: titles[tab] ?? tab, image: tabIcon(image), tag: index)
      item.accessibilityLabel = tab == "pullRequests" ? "Pull requests" : titles[tab]
      if tab == "threads" { item.selectedImage = tabIcon(UIImage(systemName: "text.bubble.fill")) }
      return item
    }
    updateSelection()
  }

  private func updateSelection() {
    guard let items = tabBar.items, let index = tabs.firstIndex(of: selectedTab), items.indices.contains(index) else { return }
    guard tabBar.selectedItem !== items[index] else { return }
    tabBar.selectedItem = items[index]
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    guard tabs.indices.contains(item.tag) else { return }
    onSelectionChange(["index": item.tag, "tab": tabs[item.tag]])
  }
}
