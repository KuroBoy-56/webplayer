package com.latmpx.player.data

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import coil3.SingletonImageLoader
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Borrado de caché remoto (página «Borrar caché» del panel). check_mac manda "cc" = la última orden
 * aplicada y responde "cache_clear" = la orden más nueva para esta app. El número visto se guarda en
 * su propio archivo de ajustes, que el borrado nunca toca (si no, la orden se repetiría en bucle).
 */
object CacheClear {
    private const val KEY = "cache_clear_seen"
    private var prefs: SharedPreferences? = null

    /** la app debe avisar, borrar la caché y reiniciarse (lo muestra AppRoot) */
    var pending by mutableStateOf(false)
        private set

    fun init(ctx: Context) { prefs = ctx.getSharedPreferences("cache_clear", Context.MODE_PRIVATE) }

    /** última orden vista (0 = ninguna) */
    val seen: Long get() = prefs?.getLong(KEY, 0L) ?: 0L

    /** nada guardado (primera vez o app recién actualizada) → solo se guarda; mayor → borrar; igual o menor → nada */
    fun shouldClear(saved: Long?, received: Long): Boolean = saved != null && received > saved

    /** ya hubo una respuesta de check_mac en este arranque */
    @Volatile var asked = false

    /**
     * at = cuándo se envió la orden (cache_clear_at), now = hora corregida con el panel. Sin nada guardado (instalada de
     * nuevo, datos borrados): una orden de los últimos 3 días se aplica igual (antes se guardaba en silencio y la orden
     * recién enviada no hacía nada); una más vieja solo se guarda.
     */
    fun onReply(received: Long, at: Long = 0L, now: Long = 0L) {
        val p = prefs ?: return
        val saved = if (p.contains(KEY)) p.getLong(KEY, 0L) else null
        // se guarda antes de borrar: tras el reinicio la misma orden ya no se vuelve a aplicar
        if (saved == null || received > saved) p.edit().putLong(KEY, received).commit()
        if (shouldClear(saved, received) || (saved == null && received > 0 && at > 0 && now - at < 3 * 86400L)) pending = true
    }

    /**
     * Borra lo que se vuelve a descargar (catálogo guardado, pósters de TMDB, imágenes, caché del sistema) y
     * reinicia la app en una tarea nueva. No toca la sesión, el distribuidor, los ajustes ni las descargas.
     */
    suspend fun wipeAndRestart(ctx: Context) {
        val app = ctx.applicationContext
        withContext(Dispatchers.IO) {
            runCatching { SingletonImageLoader.get(app).let { it.memoryCache?.clear(); it.diskCache?.clear() } }
            CatalogCache.clear()
            app.getSharedPreferences("posters", Context.MODE_PRIVATE).edit().clear().commit()
            app.cacheDir.listFiles()?.forEach { runCatching { it.deleteRecursively() } }
            app.externalCacheDir?.listFiles()?.forEach { runCatching { it.deleteRecursively() } }
        }
        // arranque en frío: la actividad de inicio en una tarea nueva y este proceso termina
        app.startActivity(
            Intent(app, com.latmpx.player.MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
        )
        Runtime.getRuntime().exit(0)
    }
}
