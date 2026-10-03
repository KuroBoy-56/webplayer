package com.latmpx.player.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
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
        .addInterceptor { chain -> chain.proceed(chain.request().newBuilder().header("User-Agent", UA).build()) }
        .build()

    suspend fun text(url: String): String? = withContext(Dispatchers.IO) {
        try {
            client.newCall(Request.Builder().url(url).build()).execute().use { r -> if (r.isSuccessful) r.body?.string() else null }
        } catch (e: Exception) {
            null
        }
    }

    suspend fun obj(url: String): JSONObject? = text(url)?.trim()?.let { t -> if (t.startsWith("{")) runCatching { JSONObject(t) }.getOrNull() else null }

    suspend fun arr(url: String): JSONArray? = text(url)?.trim()?.let { t -> if (t.startsWith("[")) runCatching { JSONArray(t) }.getOrNull() else null }
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
