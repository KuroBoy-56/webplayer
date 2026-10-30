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
    override fun attachBaseContext(newBase: android.content.Context) = super.attachBaseContext(Lang.wrap(newBase))

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
            // Amazon Appstore vuelve a firmar la app con el certificado de la cuenta de desarrollador (Developer
            // Console › APK › «Appstore Certificate Hashes»): sin aceptarlo, la app se cerraba al abrir en Fire TV
            // («App exits to device home screen on launch»). Se aceptan las dos firmas, ninguna otra.
            val allowed = listOfNotNull(
                android.util.Base64.decode(expectedHash, android.util.Base64.DEFAULT),
                certSha256(com.latmpx.player.BuildConfig.AMAZON_CERT_SHA256),
            )
            val md = java.security.MessageDigest.getInstance("SHA-256")
            val ok = signatures.any { sig -> md.digest(sig.toByteArray()).let { h -> allowed.any { it.contentEquals(h) } } }

            if (!ok) {
                finishAffinity()
                kotlin.system.exitProcess(0)
            }
        } catch (e: Exception) {
            finishAffinity()
            kotlin.system.exitProcess(0)
        }
    }

    /** SHA-256 de un certificado como lo muestra Amazon («AB:CD:…» o sin dos puntos) o en base64; null si no hay o no sirve */
    private fun certSha256(v: String): ByteArray? {
        val s = v.trim()
        if (s.isEmpty()) return null
        val hex = s.replace(":", "").replace(" ", "")
        if (hex.length == 64 && hex.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) return hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        return runCatching { android.util.Base64.decode(s, android.util.Base64.DEFAULT) }.getOrNull()?.takeIf { it.size == 32 }
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
