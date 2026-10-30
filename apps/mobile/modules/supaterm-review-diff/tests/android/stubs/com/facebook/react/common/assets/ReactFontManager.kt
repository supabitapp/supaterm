package com.facebook.react.common.assets

import android.content.res.AssetManager
import android.graphics.Typeface

@Suppress("UNUSED_PARAMETER")
class ReactFontManager {
  fun getTypeface(family: String, style: Int, assets: AssetManager): Typeface =
    Typeface.create(Typeface.MONOSPACE, style)

  fun getTypeface(family: String, style: Int, weight: Int, assets: AssetManager): Typeface =
    Typeface.create(Typeface.MONOSPACE, weight, style == Typeface.ITALIC)

  companion object {
    private val instance = ReactFontManager()
    fun getInstance(): ReactFontManager = instance
  }
}
