package expo.modules.supatermnativecontrols

import android.content.Context
import android.view.ViewGroup
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
      Prop("floating") { view: SupatermWorkspaceNavigationView, value: Boolean ->
        view.floating = value
        view.clipToPadding = !value
        view.clipChildren = !value
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
      Events("onTabSelected")
    }
  }
}

/** Material3 navigation bar for the workspace tabs, or One UI's floating pill. */
class SupatermWorkspaceNavigationView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  // Compose must remeasure native children when Yoga resizes the folded window.
  override val shouldUseAndroidLayout = true

  private val onTabSelected by EventDispatcher()
  var selectedTab by mutableStateOf("threads")
  var floating by mutableStateOf(false)
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
        clipChildren = false
        setViewCompositionStrategy(
          ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool
        )
        setContent {
          MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
            if (floating) floatingTabs() else tabBar()
          }
        }
      },
      LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    )
  }

  @Composable
  private fun tabBar() {
    NavigationBar(
      modifier = Modifier.fillMaxSize(),
      containerColor = Color(containerColor),
      tonalElevation = androidx.compose.ui.unit.Dp(0f),
      windowInsets = WindowInsets(0),
    ) {
      TABS.forEach { tab ->
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
  private fun floatingTabs() {
    Surface(
      modifier = Modifier.fillMaxSize().padding(8.dp),
      shape = CircleShape,
      color = Color(containerColor),
      shadowElevation = 6.dp,
    ) {
      Row(
        modifier = Modifier.fillMaxSize().selectableGroup(),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        TABS.forEach { tab ->
          val selected = selectedTab == tab
          Box(
            modifier = Modifier
              .weight(1f)
              .fillMaxHeight()
              .clip(CircleShape)
              .selectable(
                selected = selected,
                role = Role.Tab,
                onClick = { onTabSelected(mapOf("tab" to tab)) },
              )
              .semantics { contentDescription = tabDescription(tab) }
              .padding(4.dp)
              .background(if (selected) Color(indicatorColor) else Color.Transparent, CircleShape),
            contentAlignment = Alignment.Center,
          ) {
            Icon(
              painter = painterResource(tabDrawable(tab)),
              contentDescription = null,
              modifier = Modifier.size((24 * textScale).dp),
              tint = Color(if (selected) selectedColor else unselectedColor),
            )
          }
        }
      }
    }
  }

  @Composable
  private fun tabIcon(tab: String) {
    Icon(
      painter = painterResource(tabDrawable(tab)),
      contentDescription = tabDescription(tab),
    )
  }

  private fun tabDrawable(tab: String) =
    if (tab == "threads") R.drawable.supaterm_chats else R.drawable.supaterm_pull_requests

  private fun tabDescription(tab: String) = if (tab == "threads") "Threads" else "Pull requests"

  private companion object {
    val TABS = listOf("threads", "pullRequests")
  }
}
