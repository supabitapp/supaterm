import ComposableArchitecture
import SupaTheme
import SwiftUI

struct AppView: View {
  @Environment(\.colorScheme) private var colorScheme

  let store: StoreOf<AppFeature>

  var body: some View {
    let palette = Palette(colorScheme: colorScheme, tint: .orange)

    VStack(spacing: 12) {
      Image(systemName: "bolt.fill")
        .font(.largeTitle)
        .foregroundStyle(palette.accent)
        .accessibilityHidden(true)
      Text(store.title)
        .font(.largeTitle.bold())
      Text(store.subtitle)
        .font(.body)
        .foregroundStyle(palette.secondaryText)
    }
    .multilineTextAlignment(.center)
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background {
      LinearGradient(
        colors: [palette.backgroundTopValue.color, palette.backgroundBottomValue.color],
        startPoint: .top,
        endPoint: .bottom
      )
      .ignoresSafeArea()
    }
    .foregroundStyle(palette.primaryText)
    .accessibilityElement(children: .combine)
  }
}

#Preview {
  AppView(
    store: Store(initialState: AppFeature.State()) {
      AppFeature()
    }
  )
}
