package com.latmpx.player.player

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.latmpx.player.data.Item
import com.latmpx.player.data.Net
import com.latmpx.player.data.Session
import com.latmpx.player.data.Xtream

/**
 * Reproductor de canal en vivo dentro de la pantalla (miniatura del celular y vista previa de la TV):
 * ExoPlayer propio, independiente del reproductor a pantalla completa. Prueba los mismos formatos que
 * el reproductor (m3u8 / ts) y se libera al salir de TV en vivo o al pasar la app a segundo plano.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class LivePreview(private val ctx: Context) {
    var player by mutableStateOf<ExoPlayer?>(null)
        private set
    /** canal cuya imagen ya se está viendo */
    var showingId by mutableIntStateOf(-1)
        private set
    /** el canal no se pudo reproducir con ningún formato */
    var failedId by mutableIntStateOf(-1)
        private set
    /** canal cargado (aunque todavía no se vea imagen) */
    var channelId = -1
        private set
    private var urls: List<String> = emptyList()
    private var alt = 0

    fun play(s: Session, ch: Item) {
        if (channelId == ch.id && player != null) return
        channelId = ch.id
        showingId = -1
        failedId = -1
        urls = Xtream.liveUrls(s, ch.id)
        alt = 0
        val p = player ?: build().also { player = it }
        load(p)
    }

    private fun load(p: ExoPlayer) {
        val u = urls.getOrNull(alt) ?: return
        val mime = when {
            u.endsWith(".m3u8", true) -> MimeTypes.APPLICATION_M3U8
            u.endsWith(".ts", true) -> MimeTypes.VIDEO_MP2T
            else -> null
        }
        p.setMediaItem(MediaItem.Builder().setUri(u).setMimeType(mime).build())
        p.prepare()
        p.playWhenReady = true
    }

    private fun build(): ExoPlayer {
        val http = OkHttpDataSource.Factory(Net.client).setUserAgent(Net.UA)
        val p = ExoPlayer.Builder(ctx).setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(ctx, http))).build()
        p.addListener(object : Player.Listener {
            override fun onRenderedFirstFrame() { showingId = channelId }
            override fun onPlayerError(error: PlaybackException) {
                showingId = -1
                if (alt + 1 < urls.size) { alt++; load(p) } else failedId = channelId
            }
        })
        return p
    }

    fun release() {
        player?.release()
        player = null
        channelId = -1
        showingId = -1
        failedId = -1
    }
}
