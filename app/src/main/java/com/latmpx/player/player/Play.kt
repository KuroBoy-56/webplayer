package com.latmpx.player.player

import android.content.Context
import android.content.Intent
import com.latmpx.player.data.Episode
import com.latmpx.player.data.Item
import com.latmpx.player.data.Kind

/** Entrada de la lista de reproducción (siguiente episodio o canal anterior/siguiente). */
data class QueueEntry(val id: Int, val title: String, val key: String, val poster: String, val ext: String)

object Play {
    const val X_KIND = "kind"
    const val X_INDEX = "index"
    const val X_IDS = "ids"
    const val X_TITLES = "titles"
    const val X_KEYS = "keys"
    const val X_POSTERS = "posters"
    const val X_EXTS = "exts"
    const val X_EXTRA = "extra"
    /** título con el que se guarda el progreso en el panel (nombre de la película o de la serie) */
    const val X_SAVE_TITLE = "save_title"
    const val X_SAVE_POSTER = "save_poster"
    const val X_CATEGORY = "category"

    fun movie(ctx: Context, item: Item, ext: String) =
        start(ctx, Kind.MOVIE, listOf(QueueEntry(item.id, item.name, item.key, item.poster, ext.ifEmpty { item.ext })), 0, "", item.name, item.poster, item.categoryId)

    /** episodio: la lista incluye los siguientes de la temporada para pasar al siguiente automáticamente */
    fun episode(ctx: Context, series: Item, eps: List<Episode>, index: Int) =
        start(ctx, Kind.SERIES, eps.map { e ->
            QueueEntry(e.id, "${series.name} · T${e.season} E${e.num}" + (if (e.title.isNotBlank() && !e.title.contains(series.name)) " · ${e.title}" else ""),
                "series:${series.id}:${e.id}", e.image.ifEmpty { series.poster }, e.ext)
        }, index, series.key, series.name, series.poster, series.categoryId)

    /** canal: la lista completa de la categoría permite cambiar de canal con arriba/abajo o CH+/CH- */
    fun live(ctx: Context, channels: List<Item>, index: Int) =
        start(ctx, Kind.LIVE, channels.map { QueueEntry(it.id, it.name, it.key, it.poster, "") }, index, "", "", "", "")

    private fun start(ctx: Context, kind: Kind, q: List<QueueEntry>, index: Int, extra: String, saveTitle: String, savePoster: String, category: String) {
        // un intent no aguanta listas enormes: se envía una ventana alrededor del elegido
        val from = (index - 300).coerceAtLeast(0)
        val win = q.subList(from, (index + 300).coerceAtMost(q.size))
        ctx.startActivity(Intent(ctx, PlayerActivity::class.java).apply {
            putExtra(X_KIND, kind.name)
            putExtra(X_INDEX, index - from)
            putExtra(X_IDS, win.map { it.id }.toIntArray())
            putExtra(X_TITLES, win.map { it.title }.toTypedArray())
            putExtra(X_KEYS, win.map { it.key }.toTypedArray())
            putExtra(X_POSTERS, win.map { it.poster }.toTypedArray())
            putExtra(X_EXTS, win.map { it.ext }.toTypedArray())
            putExtra(X_EXTRA, extra)
            putExtra(X_SAVE_TITLE, saveTitle)
            putExtra(X_SAVE_POSTER, savePoster)
            putExtra(X_CATEGORY, category)
        })
    }
}
