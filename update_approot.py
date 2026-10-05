import os

approot_path = r"C:\Users\Yjamp\.gemini\antigravity\scratch\webplayer-android\app\src\main\java\com\latmpx\player\ui\AppRoot.kt"

with open(approot_path, "r", encoding="utf-8") as f:
    content = f.read()

import re

# Find the LaunchedEffect(state.session) block
pattern = re.compile(r"LaunchedEffect\(state\.session\)\s*\{(.*?state\.loading = false\s*)\}", re.DOTALL)

replacement = r'''LaunchedEffect(state.session) {
        val s = state.session ?: return@LaunchedEffect
        state.loading = true
        launch { Cloud.load() } // continuar viendo y favoritos desde el panel
        Xtream.warmUp(s)
        
        launch(kotlinx.coroutines.Dispatchers.IO) {
            val ctx = com.latmpx.player.App.ctx
            val cacheFile = java.io.File(ctx.cacheDir, "catalog_cache_" + s.user + ".json")
            
            // Try to load from cache first for instant UI
            if (cacheFile.exists()) {
                try {
                    val jsonStr = cacheFile.readText()
                    val jsonObj = org.json.JSONObject(jsonStr)
                    
                    val parseItem = { o: org.json.JSONObject, k: Kind ->
                        com.latmpx.player.data.Item(
                            id = o.optInt("id"), name = o.optString("name"), poster = o.optString("poster"),
                            kind = k, categoryId = o.optString("categoryId"), ext = o.optString("ext"),
                            rating = o.optDouble("rating"), year = o.optString("year"), added = o.optLong("added"),
                            plot = o.optString("plot"), epgId = o.optString("epgId"), backdrop = o.optString("backdrop")
                        )
                    }
                    val parseCategory = { o: org.json.JSONObject, k: Kind ->
                        com.latmpx.player.data.Category(id = o.optString("id"), name = o.optString("name"), kind = k)
                    }
                    
                    val mc = mutableListOf<com.latmpx.player.data.Category>()
                    val mca = jsonObj.optJSONArray("movieCats")
                    if (mca != null) for (i in 0 until mca.length()) mc.add(parseCategory(mca.getJSONObject(i), Kind.MOVIE))
                    
                    val sc = mutableListOf<com.latmpx.player.data.Category>()
                    val sca = jsonObj.optJSONArray("seriesCats")
                    if (sca != null) for (i in 0 until sca.length()) sc.add(parseCategory(sca.getJSONObject(i), Kind.SERIES))
                    
                    val lc = mutableListOf<com.latmpx.player.data.Category>()
                    val lca = jsonObj.optJSONArray("liveCats")
                    if (lca != null) for (i in 0 until lca.length()) lc.add(parseCategory(lca.getJSONObject(i), Kind.LIVE))
                    
                    val m = mutableListOf<com.latmpx.player.data.Item>()
                    val ma = jsonObj.optJSONArray("movies")
                    if (ma != null) for (i in 0 until ma.length()) m.add(parseItem(ma.getJSONObject(i), Kind.MOVIE))
                    
                    val ser = mutableListOf<com.latmpx.player.data.Item>()
                    val sera = jsonObj.optJSONArray("series")
                    if (sera != null) for (i in 0 until sera.length()) ser.add(parseItem(sera.getJSONObject(i), Kind.SERIES))
                    
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        state.movieCats = mc; state.seriesCats = sc; state.liveCats = lc
                        state.movies = m; state.series = ser
                        state.loading = false
                    }
                } catch (e: Exception) { e.printStackTrace() }
            }
            
            // Fetch updates in background
            val newMc = Xtream.categories(s, Kind.MOVIE)
            val newSc = Xtream.categories(s, Kind.SERIES)
            val newLc = Xtream.categories(s, Kind.LIVE)
            val newM = Xtream.items(s, Kind.MOVIE)
            val newSer = Xtream.items(s, Kind.SERIES)
            
            // Save to cache
            try {
                val out = org.json.JSONObject()
                val toJsonCat = { c: com.latmpx.player.data.Category -> org.json.JSONObject().put("id", c.id).put("name", c.name) }
                val toJsonItem = { i: com.latmpx.player.data.Item -> 
                    org.json.JSONObject().put("id", i.id).put("name", i.name).put("poster", i.poster).put("categoryId", i.categoryId)
                    .put("ext", i.ext).put("rating", i.rating).put("year", i.year).put("added", i.added).put("plot", i.plot)
                    .put("epgId", i.epgId).put("backdrop", i.backdrop)
                }
                out.put("movieCats", org.json.JSONArray(newMc.map { toJsonCat(it) }))
                out.put("seriesCats", org.json.JSONArray(newSc.map { toJsonCat(it) }))
                out.put("liveCats", org.json.JSONArray(newLc.map { toJsonCat(it) }))
                out.put("movies", org.json.JSONArray(newM.map { toJsonItem(it) }))
                out.put("series", org.json.JSONArray(newSer.map { toJsonItem(it) }))
                cacheFile.writeText(out.toString())
            } catch (e: Exception) { e.printStackTrace() }
            
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                state.movieCats = newMc; state.seriesCats = newSc; state.liveCats = newLc
                state.movies = newM; state.series = newSer
                state.loading = false
            }
        }
    }'''

new_content = pattern.sub(replacement, content)
with open(approot_path, "w", encoding="utf-8") as f:
    f.write(new_content)

print("AppRoot updated.")
