package com.latmpx.player

import android.content.pm.ActivityInfo
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import com.latmpx.player.ui.AppRoot
import com.latmpx.player.ui.components.LocalIsTv
import com.latmpx.player.ui.theme.LatMpxTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val tv = Device.isTv(this)
        // teléfono: siempre vertical; tablet: libre; TV: horizontal
        requestedOrientation = when {
            tv -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            Device.isTablet(this) -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            else -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
        setContent {
            LatMpxTheme {
                CompositionLocalProvider(LocalIsTv provides tv) { AppRoot() }
            }
        }
    }
}
