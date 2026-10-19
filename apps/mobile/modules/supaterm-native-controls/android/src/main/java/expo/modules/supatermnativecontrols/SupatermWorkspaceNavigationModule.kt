package expo.modules.supatermnativecontrols

import android.content.Context
import android.view.ViewGroup
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class SupatermWorkspaceNavigationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SupatermWorkspaceNavigation")
    View(SupatermWorkspaceNavigationView::class) {
      Prop("selectedTab") { view: SupatermWorkspaceNavigationView, value: String ->
        view.selectedTab = value
      }
      Prop("showTabs") { view: SupatermWorkspaceNavigationView, value: Boolean ->
        view.showTabs = value
      }
      Prop("filterCustomized") { view: SupatermWorkspaceNavigationView, value: Boolean ->
        view.filterCustomized = value
      }
      Prop("dark") { view: SupatermWorkspaceNavigationView, value: Boolean -> view.dark = value }
      Prop("textScale") { view: SupatermWorkspaceNavigationView, value: Float ->
        view.textScale = value
      }
      Prop("containerColor") { view: SupatermWorkspaceNavigationView, value: Int ->
        view.containerColor = value
      }
      Prop("selectedColor") { view: SupatermWorkspaceNavigationView, value: Int ->
        view.selectedColor = value
      }
      Prop("indicatorColor") { view: SupatermWorkspaceNavigationView, value: Int ->
        view.indicatorColor = value
      }
      Prop("unselectedColor") { view: SupatermWorkspaceNavigationView, value: Int ->
        view.unselectedColor = value
      }
      Events("onTabSelected", "onFilterPressed", "onCompose")
    }
  }
}

/** Material3 workspace dock: filter, the workspace tabs, and compose. */
class SupatermWorkspaceNavigationView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  // Compose must remeasure native children when Yoga resizes the folded window.
  override val shouldUseAndroidLayout = true

  private val onTabSelected by EventDispatcher()
  private val onFilterPressed by EventDispatcher()
  private val onCompose by EventDispatcher()
  var showTabs by mutableStateOf(true)
  var filterCustomized by mutableStateOf(false)
  var selectedTab by mutableStateOf("threads")
  var dark by mutableStateOf(false)
  var textScale by mutableStateOf(1f)
  var containerColor by mutableStateOf(0)
  var selectedColor by mutableStateOf(0)
  var indicatorColor by mutableStateOf(0)
  var unselectedColor by mutableStateOf(0)

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // Fabric measures the replacement bar before attaching it on a fold.
    // Compose needs an attached window to obtain its lifecycle recomposer.
    if (!isAttachedToWindow) {
      setMeasuredDimension(
        MeasureSpec.getSize(widthMeasureSpec),
        MeasureSpec.getSize(heightMeasureSpec)
      )
      return
    }
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    if (isAttachedToWindow) super.onLayout(changed, left, top, right, bottom)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    requestLayout()
  }

  init {
    addView(
      ComposeView(context).apply {
        setViewCompositionStrategy(
          ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool
        )
        setContent {
          MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
            Row(
              modifier = Modifier.fillMaxSize(),
              verticalAlignment = Alignment.CenterVertically
            ) {
              dockButton(
                drawable = R.drawable.supaterm_filter,
                label = if (selectedTab ==
                  "threads"
                ) {
                  "Filter threads"
                } else {
                  "Filter pull requests"
                },
                customized = filterCustomized
              ) {
                onFilterPressed(emptyMap<String, String>())
              }
              if (showTabs) {
                tabBar(Modifier.weight(1f))
              } else {
                Spacer(Modifier.weight(1f))
              }
              dockButton(R.drawable.supaterm_compose, "New chat") {
                onCompose(emptyMap<String, String>())
              }
            }
          }
        }
      },
      LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    )
  }

  @Composable
  private fun dockButton(
    drawable: Int,
    label: String,
    customized: Boolean = false,
    onClick: () -> Unit
  ) {
    FilledTonalIconButton(
      onClick = onClick,
      modifier = Modifier.size(56.dp),
      colors = IconButtonDefaults.filledTonalIconButtonColors(
        containerColor = Color(if (customized) selectedColor else indicatorColor),
        contentColor = Color(if (customized) indicatorColor else selectedColor)
      )
    ) {
      Icon(painter = painterResource(drawable), contentDescription = label)
    }
  }

  @Composable
  private fun tabBar(modifier: Modifier) {
    NavigationBar(
      modifier = modifier,
      containerColor = Color(containerColor),
      tonalElevation = androidx.compose.ui.unit.Dp(0f),
      windowInsets = WindowInsets(0),
    ) {
      listOf("threads", "pullRequests").forEach { tab ->
        NavigationBarItem(
          selected = selectedTab == tab,
          onClick = { onTabSelected(mapOf("tab" to tab)) },
          icon = { tabIcon(tab) },
          label = {
            val title = if (tab == "threads") "Threads" else "Pulls"
            Text(title, fontSize = (12 * textScale).sp)
          },
          colors = NavigationBarItemDefaults.colors(
            selectedIconColor = Color(selectedColor),
            selectedTextColor = Color(selectedColor),
            indicatorColor = Color(indicatorColor),
            unselectedIconColor = Color(unselectedColor),
            unselectedTextColor = Color(unselectedColor),
          ),
        )
      }
    }
  }

  @Composable
  private fun tabIcon(tab: String) {
    val drawable = if (tab == "threads") {
      R.drawable.supaterm_chats
    } else {
      R.drawable.supaterm_pull_requests
    }
    Icon(
      painter = painterResource(drawable),
      contentDescription = if (tab == "threads") "Threads" else "Pull requests",
    )
  }
}
