package com.latmpx.player

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.latmpx.player.data.Net
import com.latmpx.player.data.Store

class App : Application(), SingletonImageLoader.Factory {
    override fun onCreate() {
        super.onCreate()
        Store.init(this)
        Store.deviceIdCache = runCatching { Device.id(this) }.getOrDefault("")
        com.latmpx.player.data.ErrorReport.init(this) // cierres inesperados y errores al panel (Errores de las apps)
        com.latmpx.player.data.Tenant.init() // marca del distribuidor guardada: se aplica antes de la primera pantalla
        com.latmpx.player.data.Posters.init(this)
        com.latmpx.player.data.CatalogCache.init(this)
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { Net.imageClient })) } // mismo DNS, cola propia para imágenes
            .crossfade(true)
            .build()
}
