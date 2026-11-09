package com.latmpx.player.data
import com.latmpx.player.Lang

import android.util.JsonReader
import android.util.JsonToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object Net {
    const val UA = "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(40, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .retryOnConnectionFailure(true)
        .dns(SecureDns)
        .addInterceptor { chain ->
            val req = chain.request()
            val b = req.newBuilder().header("User-Agent", UA)
            // panel: mensajes en el idioma de la app (progress, epg, sports, tmdb, alerta, media…)
            val panel = PanelUrl.apiBase
            if (panel.isNotEmpty() && req.url.toString().startsWith(panel)) b.header("Accept-Language", Lang.current)
            chain.proceed(b.build())
        }
        .build()

    /**
     * Cliente de imágenes (carátulas y logos): mismo DNS y conexiones, pero con su propia cola.
     * OkHttp deja solo 5 descargas a la vez por servidor; con cientos de logos del mismo servidor IPTV
     * las imágenes se quedaban esperando y además bloqueaban las consultas del catálogo.
     * Se envía Referer del propio servidor, igual que img.php de la web (algunos lo exigen).
     */
    val imageClient: OkHttpClient by lazy {
        client.newBuilder()
            .dispatcher(okhttp3.Dispatcher().apply { maxRequests = 48; maxRequestsPerHost = 12 })
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val req = chain.request()
                val u = req.url
                chain.proceed(req.newBuilder().header("Referer", "${u.scheme}://${u.host}/").build())
            }
            .build()
    }

    suspend fun text(url: String): String? = withContext(Dispatchers.IO) {
        try {
            client.newCall(Request.Builder().url(url).build()).execute().use { r -> if (r.isSuccessful) r.body?.string() else null }
        } catch (e: Exception) {
            null
        }
    }

    /** Respuesta HTTP simple: código (0 si no hubo conexión) y cuerpo. */
    data class Resp(val code: Int, val body: String) {
        val ok: Boolean get() = code in 200..299
        fun json(): JSONObject? = body.trim().let { t -> if (t.startsWith("{")) runCatching { JSONObject(t) }.getOrNull() else null }
    }

    private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()

    private suspend fun exec(req: Request): Resp = withContext(Dispatchers.IO) {
        try {
            client.newCall(req).execute().use { r -> Resp(r.code, r.body?.string().orEmpty()) }
        } catch (e: Exception) {
            Resp(0, "")
        }
    }

    suspend fun postJson(url: String, body: JSONObject): Resp =
        exec(Request.Builder().url(url).post(body.toString().toRequestBody(JSON_TYPE)).build())

    suspend fun postForm(url: String, fields: Map<String, String>): Resp {
        val fb = FormBody.Builder()
        fields.forEach { (k, v) -> fb.add(k, v) }
        return exec(Request.Builder().url(url).post(fb.build()).build())
    }

    suspend fun get(url: String): Resp = exec(Request.Builder().url(url).build())

    suspend fun obj(url: String): JSONObject? = text(url)?.trim()?.let { t -> if (t.startsWith("{")) runCatching { JSONObject(t) }.getOrNull() else null }

    suspend fun arr(url: String): JSONArray? = text(url)?.trim()?.let { t -> if (t.startsWith("[")) runCatching { JSONArray(t) }.getOrNull() else null }

    /**
     * Lista JSON grande (catálogo de películas, series o canales) leída por partes mientras llega: cada objeto queda como
     * un mapa de textos (números y textos tal cual; de una lista interna solo el primer texto, p. ej. backdrop_path) y
     * pasa por [f]. Nunca se tiene el texto completo ni el árbol JSON en memoria: con un proveedor grande eso eran
     * decenas de MB a la vez (el texto, su copia y el árbol) y en equipos con poca memoria (Fire TV Stick con Android 7,
     * donde además las carátulas usan esa misma memoria) la app se cerraba con OutOfMemoryError.
     * null si no contesta, no es una lista o llega cortada (como [arr]).
     */
    suspend fun <T> streamArray(url: String, f: (Map<String, String>) -> T?): List<T>? = withContext(Dispatchers.IO) {
        try {
            client.newCall(Request.Builder().url(url).build()).execute().use { r ->
                val body = r.body
                if (!r.isSuccessful || body == null) return@use null
                JsonReader(body.charStream()).use { jr ->
                    jr.isLenient = true
                    if (jr.peek() != JsonToken.BEGIN_ARRAY) return@use null
                    val out = ArrayList<T>()
                    val m = HashMap<String, String>(32)
                    jr.beginArray()
                    while (jr.hasNext()) {
                        if (jr.peek() != JsonToken.BEGIN_OBJECT) {
                            jr.skipValue()
                            continue
                        }
                        m.clear()
                        jr.beginObject()
                        while (jr.hasNext()) {
                            val k = jr.nextName()
                            when (jr.peek()) {
                                JsonToken.STRING, JsonToken.NUMBER -> m[k] = jr.nextString()
                                JsonToken.BOOLEAN -> m[k] = jr.nextBoolean().toString()
                                JsonToken.NULL -> jr.nextNull()
                                JsonToken.BEGIN_ARRAY -> {
                                    var first: String? = null
                                    jr.beginArray()
                                    while (jr.hasNext()) {
                                        if (first == null && jr.peek() == JsonToken.STRING) first = jr.nextString() else jr.skipValue()
                                    }
                                    jr.endArray()
                                    if (first != null) m[k] = first
                                }
                                else -> jr.skipValue()
                            }
                        }
                        jr.endObject()
                        f(m)?.let(out::add)
                    }
                    jr.endArray()
                    out
                }
            }
        } catch (e: Exception) {
            null
        }
    }
}

/* utilidades JSON tolerantes: los paneles Xtream mezclan números, textos y null */
fun JSONObject.s(k: String): String = if (isNull(k)) "" else optString(k, "").let { if (it == "null") "" else it.trim() }
fun JSONObject.i(k: String): Int = s(k).toDoubleOrNull()?.toInt() ?: 0
fun JSONObject.d(k: String): Double = s(k).replace(',', '.').toDoubleOrNull() ?: 0.0
inline fun <T> JSONArray?.mapObj(f: (JSONObject) -> T?): List<T> {
    if (this == null) return emptyList()
    val out = ArrayList<T>(length())
    for (n in 0 until length()) optJSONObject(n)?.let { o -> f(o)?.let(out::add) }
    return out
}
