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
        Lang.init(this) // idioma de la app (automático o el elegido en Cuenta)
        Store.init(this)
        Store.deviceIdCache = runCatching { Device.id(this) }.getOrDefault("")
        com.latmpx.player.data.ErrorReport.init(this) // cierres inesperados y errores al panel (Errores de las apps)
        com.latmpx.player.data.Tenant.init() // marca del distribuidor guardada: se aplica antes de la primera pantalla
        com.latmpx.player.data.Posters.init(this)
        com.latmpx.player.data.PanelImg.init(this)
        com.latmpx.player.data.SportsPanel.init(this)
        com.latmpx.player.data.CatalogCache.init(this)
        com.latmpx.player.data.CacheClear.init(this) // orden de borrado de caché del panel (check_mac)
        com.latmpx.player.data.Downloads.init(this) // descargas para ver sin internet (sigue lo pendiente)
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { Net.imageClient })) } // mismo DNS, cola propia para imágenes
            .crossfade(true)
            .build()
}
