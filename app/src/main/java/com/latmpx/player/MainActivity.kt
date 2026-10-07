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
    private fun checkSignature() {
        if (com.latmpx.player.BuildConfig.DEBUG) return
        try {
            // GET_SIGNING_CERTIFICATES solo existe desde Android 9; los TV Box y celulares más viejos usan GET_SIGNATURES
            val signatures = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                packageManager.getPackageInfo(packageName, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES).signingInfo?.apkContentsSigners
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(packageName, android.content.pm.PackageManager.GET_SIGNATURES).signatures
            }
            if (signatures == null || signatures.isEmpty()) { finishAffinity(); kotlin.system.exitProcess(0) }
            val md = java.security.MessageDigest.getInstance("SHA-256")
            val hashBytes = md.digest(signatures[0].toByteArray())
            val hashBase64 = android.util.Base64.encodeToString(hashBytes, android.util.Base64.NO_WRAP)
            
            val hexStr = "425463424B6A30644A53306D467A67626543776A4C42455A6551492F426941596657774550794D764B41554A5A7A3859447841384A77346C4958493D"
            val bytes = hexStr.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            val b64Str = String(bytes, Charsets.UTF_8)
            val xorBytes = android.util.Base64.decode(b64Str, android.util.Base64.DEFAULT)
            val key = "KURO".toByteArray(Charsets.UTF_8)
            val decrypted = ByteArray(xorBytes.size)
            for (i in xorBytes.indices) {
                decrypted[i] = (xorBytes[i].toInt() xor key[i % key.size].toInt()).toByte()
            }
            val expectedHash = String(decrypted, Charsets.UTF_8)
            
            if (hashBase64 != expectedHash) {
                finishAffinity()
                kotlin.system.exitProcess(0)
            }
        } catch (e: Exception) {
            finishAffinity()
            kotlin.system.exitProcess(0)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        checkSignature()
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
