package com.latmpx.player

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.allowRgb565
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
        // el Top 10 de la semana nunca puede cerrar la app al abrir
        runCatching { com.latmpx.player.data.WeekTop.init(this) }
        com.latmpx.player.data.SportsPanel.init(this)
        com.latmpx.player.data.CatalogCache.init(this)
        com.latmpx.player.data.CacheClear.init(this) // orden de borrado de caché del panel (check_mac)
        com.latmpx.player.data.Downloads.init(this) // descargas para ver sin internet (sigue lo pendiente)
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader {
        // Android 7 o menos (Fire TV Stick 4K / 2.ª gen., TV Box viejos): las imágenes decodificadas viven en la misma
        // memoria que la app (desde Android 8 van aparte). Con la caché de Coil al 25 % y en ARGB_8888 esa memoria se
        // llenaba y la app se cerraba con OutOfMemoryError al dibujar. Ahí: caché al 12 % y las imágenes sin
        // transparencia (carátulas, fondos) en RGB_565, la mitad de memoria y casi sin diferencia en la TV.
        val old = android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O
        val b = ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { Net.imageClient })) } // mismo DNS, cola propia para imágenes
            .crossfade(true)
        if (old) {
            b.memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.12).build() }
            b.allowRgb565(true)
        }
        return b.build()
    }

    // el sistema pide memoria (otras apps, video): se suelta la caché de imágenes en vez de cerrar la app
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
            runCatching { SingletonImageLoader.get(this).memoryCache?.trimToSize(0) }
        }
    }

    override fun onLowMemory() {
        super.onLowMemory()
        runCatching { SingletonImageLoader.get(this).memoryCache?.clear() }
    }
}
