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
    companion object {
        private var started = 0
        /** alguna pantalla de la app a la vista: los avisos de partidos no salen en la barra de notificaciones */
        val foreground get() = started > 0
    }

    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityStarted(a: android.app.Activity) { started++ }
            override fun onActivityStopped(a: android.app.Activity) { started = (started - 1).coerceAtLeast(0) }
            override fun onActivityCreated(a: android.app.Activity, b: android.os.Bundle?) {}
            override fun onActivityResumed(a: android.app.Activity) {}
            override fun onActivityPaused(a: android.app.Activity) {}
            override fun onActivitySaveInstanceState(a: android.app.Activity, b: android.os.Bundle) {}
            override fun onActivityDestroyed(a: android.app.Activity) {}
        })
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
        com.latmpx.player.data.MatchAlerts.init(this) // avisos de partidos (equipos favoritos y partidos marcados)
        com.latmpx.player.data.CatalogCache.init(this)
        com.latmpx.player.data.Downloads.init(this) // descargas para ver sin internet (sigue lo pendiente)
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { Net.imageClient })) } // mismo DNS, cola propia para imágenes
            .crossfade(true)
            .build()
}
