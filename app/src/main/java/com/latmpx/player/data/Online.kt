package com.latmpx.player.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

/** ¿Hay una red con salida a internet? (sin red: se ofrecen las descargas en el inicio de sesión) */
fun isOnline(ctx: Context): Boolean {
    val cm = ctx.getSystemService(ConnectivityManager::class.java) ?: return true
    val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
    return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
}

/** sigue los cambios de red mientras la pantalla está a la vista */
@Composable
fun rememberOnline(): Boolean {
    val ctx = LocalContext.current
    var online by remember { mutableStateOf(isOnline(ctx)) }
    DisposableEffect(Unit) {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        if (cm == null || Build.VERSION.SDK_INT < 24) return@DisposableEffect onDispose { }
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { online = isOnline(ctx) }
            override fun onLost(network: Network) { online = isOnline(ctx) && cm.activeNetwork != network }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) { online = isOnline(ctx) }
        }
        runCatching { cm.registerDefaultNetworkCallback(cb) }
        onDispose { runCatching { cm.unregisterNetworkCallback(cb) } }
    }
    return online
}
