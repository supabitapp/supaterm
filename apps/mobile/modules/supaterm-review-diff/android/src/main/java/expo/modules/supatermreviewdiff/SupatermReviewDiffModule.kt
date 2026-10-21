package expo.modules.supatermreviewdiff

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SupatermReviewDiffModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SupatermReviewDiffSurface")

    View(SupatermReviewDiffView::class) {
      Prop("tokensResetKey") { view: SupatermReviewDiffView, tokensResetKey: String ->
        view.setTokensResetKey(tokensResetKey)
      }
      Prop("contentResetKey") { view: SupatermReviewDiffView, contentResetKey: String ->
        view.setContentResetKey(contentResetKey)
      }
      Prop("collapsedFileIdsJson") { view: SupatermReviewDiffView, collapsedFileIdsJson: String ->
        view.setCollapsedFileIdsJson(collapsedFileIdsJson)
      }
      Prop("viewedFileIdsJson") { view: SupatermReviewDiffView, viewedFileIdsJson: String ->
        view.setViewedFileIdsJson(viewedFileIdsJson)
      }
      Prop("selectedRowIdsJson") { view: SupatermReviewDiffView, selectedRowIdsJson: String ->
        view.setSelectedRowIdsJson(selectedRowIdsJson)
      }
      Prop("collapsedCommentIdsJson") { view: SupatermReviewDiffView, json: String ->
        view.setCollapsedCommentIdsJson(json)
      }
      Prop("appearanceScheme") { view: SupatermReviewDiffView, appearanceScheme: String ->
        view.setAppearanceScheme(appearanceScheme)
      }
      Prop("themeJson") { view: SupatermReviewDiffView, themeJson: String ->
        view.setThemeJson(themeJson)
      }
      Prop("styleJson") { view: SupatermReviewDiffView, styleJson: String ->
        view.setStyleJson(styleJson)
      }
      Prop("rowHeight") { view: SupatermReviewDiffView, rowHeight: Double ->
        view.setRowHeight(rowHeight.toFloat())
      }
      // Accept the shared prop while deriving Android's scroll range from the drawn text.
      Prop("contentWidth") { _: SupatermReviewDiffView, _: Double -> }
      Prop("contentInsetBottom") { view: SupatermReviewDiffView, value: Double ->
        view.setContentInsetBottom(value.toFloat())
      }
      Prop("scrollEnabled") { view: SupatermReviewDiffView, enabled: Boolean ->
        view.setScrollEnabled(enabled)
      }
      Prop("initialRowIndex") { view: SupatermReviewDiffView, initialRowIndex: Double ->
        view.setInitialRowIndex(initialRowIndex)
      }

      Events(
        "onDebug",
        "onVisibleFileChange",
        "onToggleFile",
        "onToggleViewedFile",
        "onPressLine",
        "onToggleComment",
      )

      AsyncFunction("scrollToFile") { view: SupatermReviewDiffView, id: String, animated: Boolean ->
        view.scrollToFile(id, animated)
      }
      AsyncFunction("scrollToTop") { view: SupatermReviewDiffView, animated: Boolean ->
        view.scrollToTop(animated)
      }
      AsyncFunction("setRowsJson") { view: SupatermReviewDiffView, rowsJson: String ->
        view.setRowsJson(rowsJson)
      }
      AsyncFunction("setTokensJson") { view: SupatermReviewDiffView, tokensJson: String ->
        view.setTokensJson(tokensJson)
      }
      AsyncFunction("setTokensPatchJson") { view: SupatermReviewDiffView, tokensPatchJson: String ->
        view.setTokensPatchJson(tokensPatchJson)
      }

      OnViewDestroys { view: SupatermReviewDiffView ->
        view.cleanup()
      }
    }
  }
}
