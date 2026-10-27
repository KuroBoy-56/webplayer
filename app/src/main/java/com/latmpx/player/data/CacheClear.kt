package com.latmpx.player.data

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Borrado de caché remoto (página cache_clear.php del panel). check_mac manda "cc" = última orden aplicada
 * y responde "cache_clear" = la orden más nueva para esta app. Una orden nueva: aviso, se borra lo que se
 * vuelve a descargar (catálogo, carátulas, imágenes, caché HTTP) y la app se reinicia. Nunca se tocan la
 * sesión, el distribuidor, los ajustes ni las descargas.
 */
object CacheClear {
    /** hay que mostrar el aviso, borrar y reiniciar (lo atiende AppRoot) */
    var pending by mutableStateOf(false)

    /**
     * Número recibido en check_mac (at = cuándo se envió, cache_clear_at; now = hora corregida con el panel). Sin nada
     * guardado (instalada de nuevo, datos borrados): una orden de los últimos 3 días se aplica igual (antes se guardaba
     * en silencio y la orden recién enviada no hacía nada); una más vieja solo se guarda. Mayor que la guardada: se
     * guarda primero (para no repetir en bucle) y se borra. Igual o menor: nada.
     */
    fun received(got: Long, at: Long = 0L, now: Long = 0L) {
        val seen = Store.cacheClearSeen
        if (seen != null && got <= seen) return
        Store.cacheClearSeen = got
        if (seen != null || (got > 0 && at > 0 && now - at < 3 * 86400L)) pending = true
    }

    /** borra la caché interna y abre la app desde cero en una tarea nueva */
    suspend fun wipeAndRestart(ctx: Context) {
        val app = ctx.applicationContext
        withContext(Dispatchers.IO) {
            CatalogCache.clear()
            Posters.clear()
            SportsPanel.clear()
            runCatching { app.cacheDir.deleteRecursively() } // imágenes de Coil (image_cache) y demás caché
        }
        app.startActivity(Intent(app, com.latmpx.player.MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        Runtime.getRuntime().exit(0)
    }
}
