package com.latmpx.player.data

import org.json.JSONObject
import java.net.URLEncoder

object Tmdb {
    private var cached: List<String>? = null
    private const val FALLBACK_KEY = "0c23c3f0458f0f9e4d0a35048d3a199a"

    private fun key() = Store.tmdbKey.ifEmpty { FALLBACK_KEY }

    suspend fun nowPlaying(key: String, pages: Int = 3): List<String> {
        cached?.let { return it }
        val k = key.ifEmpty { key() }
        if (k.isBlank()) return emptyList()
        val out = ArrayList<String>()
        for (p in 1..pages) {
            val j = Net.obj("https://api.themoviedb.org/3/movie/now_playing?api_key=${URLEncoder.encode(k, "UTF-8")}&language=es-MX&page=$p") ?: break
            j.optJSONArray("results")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i)
                    val pp = o?.optString("poster_path") ?: ""
                    if (pp.isNotEmpty()) out += "https://image.tmdb.org/t/p/w342$pp"
                }
            }
        }
        val list = out.distinct().take(48)
        if (list.isNotEmpty()) cached = list
        return list
    }

    data class Details(
        val id: Int,
        val poster: String,
        val backdrop: String,
        val overview: String,
        val cast: List<CastMember>,
        val trailer: String
    )

    data class CastMember(val name: String, val character: String, val profile: String)

    private val cache = mutableMapOf<String, Details>()

    suspend fun getDetails(type: String, title: String, year: String, tmdbId: String = ""): Details? {
        val k = key()
        if (k.isBlank()) return null
        
        val cleanTitle = title.substringBefore(":").substringBefore(" - ").trim()
        val cacheKey = "$type|$cleanTitle|$year|$tmdbId"
        cache[cacheKey]?.let { return it }

        var idToFetch = tmdbId.filter { it.isDigit() }
        var fetchedType = type

        if (idToFetch.isEmpty()) {
            val q = URLEncoder.encode(cleanTitle, "UTF-8")
            val yParam = if (year.isNotEmpty()) {
                val y = year.filter { it.isDigit() }.take(4)
                if (type == "tv") "&first_air_date_year=$y" else "&primary_release_year=$y"
            } else ""
            
            val searchUrl = "https://api.themoviedb.org/3/search/$type?api_key=$k&language=es-MX&query=$q$yParam"
            var res = Net.obj(searchUrl)
            
            if (res == null || res.optJSONArray("results")?.length() == 0) {
                val searchUrl2 = "https://api.themoviedb.org/3/search/$type?api_key=$k&language=es-MX&query=$q"
                res = Net.obj(searchUrl2)
            }

            val results = res?.optJSONArray("results")
            if (results != null && results.length() > 0) {
                idToFetch = results.optJSONObject(0)?.optInt("id").toString()
            }
        }

        if (idToFetch.isEmpty() || idToFetch == "null") return null

        val detailsUrl = "https://api.themoviedb.org/3/$fetchedType/$idToFetch?api_key=$k&language=es-MX&append_to_response=credits,aggregate_credits,videos"
        val d = Net.obj(detailsUrl) ?: return null

        val poster = d.optString("poster_path").let { if (it.isNotEmpty() && it != "null") "https://image.tmdb.org/t/p/w500$it" else "" }
        val backdrop = d.optString("backdrop_path").let { if (it.isNotEmpty() && it != "null") "https://image.tmdb.org/t/p/w1280$it" else "" }
        val overview = d.optString("overview")

        val cast = mutableListOf<CastMember>()
        val credits = d.optJSONObject("credits") ?: d.optJSONObject("aggregate_credits")
        credits?.optJSONArray("cast")?.let { arr ->
            for (i in 0 until Math.min(arr.length(), 15)) {
                val c = arr.optJSONObject(i)
                val profile = c?.optString("profile_path")?.let { if (it.isNotEmpty() && it != "null") "https://image.tmdb.org/t/p/w185$it" else "" } ?: ""
                cast.add(CastMember(c?.optString("name") ?: "", c?.optString("character") ?: "", profile))
            }
        }

        var trailer = ""
        d.optJSONObject("videos")?.optJSONArray("results")?.let { arr ->
            for (i in 0 until arr.length()) {
                val v = arr.optJSONObject(i)
                if (v?.optString("site") == "YouTube" && v?.optString("type") == "Trailer") {
                    trailer = v.optString("key")
                    break
                }
            }
        }

        val details = Details(idToFetch.toInt(), poster, backdrop, overview, cast, trailer)
        cache[cacheKey] = details
        return details
    }
}
