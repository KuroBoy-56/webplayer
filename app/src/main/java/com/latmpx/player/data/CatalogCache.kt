package com.latmpx.player.data

import android.content.Context
import android.util.JsonReader
import android.util.JsonWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * Catálogo guardado en el equipo (categorías y películas / series / canales) por servidor + usuario.
 * Al abrir la app se muestra al instante lo guardado y el servidor se consulta en segundo plano.
 * Los pósters que se resolvieron con TMDB (Posters) se guardan ya resueltos para que salgan al instante.
 */
object CatalogCache {
    /** pasado este tiempo el catálogo se vuelve a pedir al servidor (en segundo plano) */
    const val MAX_AGE = 4 * 60 * 60 * 1000L
    private const val VERSION = "v1"
    private var root: File? = null

    fun init(ctx: Context) { root = File(ctx.filesDir, "catalog") }

    private fun folder(s: Session): File? {
        val r = root ?: return null
        val md = MessageDigest.getInstance("MD5").digest((s.base.lowercase() + "|" + s.user).toByteArray(Charsets.UTF_8))
        return File(r, md.joinToString("") { "%02x".format(it) })
    }

    private fun catFile(s: Session, kind: Kind) = folder(s)?.let { File(it, "cat_${kind.name}_$VERSION.json") }
    private fun itemsFile(s: Session, kind: Kind) = folder(s)?.let { File(it, "items_${kind.name}_$VERSION.json") }

    /** true si no hay copia o ya es vieja */
    fun isStale(s: Session, kind: Kind): Boolean {
        val f = itemsFile(s, kind) ?: return true
        if (!f.exists()) return true
        return System.currentTimeMillis() - f.lastModified() > MAX_AGE
    }

    suspend fun categories(s: Session, kind: Kind): List<Category>? = withContext(Dispatchers.IO) {
        val f = catFile(s, kind) ?: return@withContext null
        if (!f.exists()) return@withContext null
        runCatching {
            val out = ArrayList<Category>()
            JsonReader(f.bufferedReader(Charsets.UTF_8)).use { r ->
                r.beginArray()
                while (r.hasNext()) {
                    var id = ""; var name = ""
                    r.beginObject()
                    while (r.hasNext()) {
                        when (r.nextName()) {
                            "i" -> id = r.nextString()
                            "n" -> name = r.nextString()
                            else -> r.skipValue()
                        }
                    }
                    r.endObject()
                    out.add(Category(id, name, kind))
                }
                r.endArray()
            }
            out as List<Category>
        }.getOrNull()?.takeIf { it.isNotEmpty() }
    }

    suspend fun items(s: Session, kind: Kind): List<Item>? = withContext(Dispatchers.IO) {
        val f = itemsFile(s, kind) ?: return@withContext null
        if (!f.exists()) return@withContext null
        runCatching {
            val out = ArrayList<Item>()
            JsonReader(f.bufferedReader(Charsets.UTF_8)).use { r ->
                r.beginArray()
                while (r.hasNext()) {
                    var id = 0; var name = ""; var poster = ""; var cat = ""; var ext = ""; var rating = 0.0
                    var year = ""; var added = 0L; var plot = ""; var epg = ""; var backdrop = ""; var cast = ""
                    r.beginObject()
                    while (r.hasNext()) {
                        when (r.nextName()) {
                            "i" -> id = r.nextInt()
                            "n" -> name = r.nextString()
                            "p" -> poster = r.nextString()
                            "c" -> cat = r.nextString()
                            "x" -> ext = r.nextString()
                            "r" -> rating = r.nextDouble()
                            "y" -> year = r.nextString()
                            "a" -> added = r.nextLong()
                            "d" -> plot = r.nextString()
                            "e" -> epg = r.nextString()
                            "b" -> backdrop = r.nextString()
                            "k" -> cast = r.nextString()
                            else -> r.skipValue()
                        }
                    }
                    r.endObject()
                    if (id > 0) out.add(Item(id, name, poster, kind, cat, ext, rating, year, added, plot, epg, backdrop, cast))
                }
                r.endArray()
            }
            out as List<Item>
        }.getOrNull()?.takeIf { it.isNotEmpty() }
    }

    suspend fun save(s: Session, kind: Kind, cats: List<Category>, items: List<Item>) = withContext(Dispatchers.IO) {
        val dir = folder(s) ?: return@withContext
        runCatching {
            dir.mkdirs()
            if (cats.isNotEmpty()) write(File(dir, "cat_${kind.name}_$VERSION.json")) { w ->
                cats.forEach { c -> w.beginObject(); w.name("i").value(c.id); w.name("n").value(c.name); w.endObject() }
            }
            if (items.isNotEmpty()) write(File(dir, "items_${kind.name}_$VERSION.json")) { w ->
                items.forEach { x ->
                    // póster del servidor o, si no trae, el que ya se encontró en TMDB con la llave del panel
                    val poster = x.poster.ifBlank { Posters.cached(x).orEmpty() }
                    w.beginObject()
                    w.name("i").value(x.id.toLong())
                    w.name("n").value(x.name)
                    if (poster.isNotEmpty()) w.name("p").value(poster)
                    if (x.categoryId.isNotEmpty()) w.name("c").value(x.categoryId)
                    if (x.ext.isNotEmpty()) w.name("x").value(x.ext)
                    if (x.rating != 0.0 && !x.rating.isNaN() && !x.rating.isInfinite()) w.name("r").value(x.rating)
                    if (x.year.isNotEmpty()) w.name("y").value(x.year)
                    if (x.added != 0L) w.name("a").value(x.added)
                    if (x.plot.isNotEmpty()) w.name("d").value(x.plot)
                    if (x.epgId.isNotEmpty()) w.name("e").value(x.epgId)
                    if (x.backdrop.isNotEmpty()) w.name("b").value(x.backdrop)
                    if (x.cast.isNotEmpty()) w.name("k").value(x.cast)
                    w.endObject()
                }
            }
        }
        Unit
    }

    /** se escribe en un archivo temporal y se renombra: nunca queda un archivo a medias */
    private fun write(target: File, body: (JsonWriter) -> Unit) {
        val tmp = File(target.parentFile, target.name + ".tmp")
        JsonWriter(tmp.bufferedWriter(Charsets.UTF_8)).use { w ->
            w.beginArray()
            body(w)
            w.endArray()
        }
        if (!tmp.renameTo(target)) {
            target.delete()
            tmp.renameTo(target)
        }
    }

    /** al cerrar sesión se borra todo lo guardado */
    fun clear() { runCatching { root?.deleteRecursively() } }
}
