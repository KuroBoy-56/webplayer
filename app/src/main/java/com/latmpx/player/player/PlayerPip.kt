package com.latmpx.player.player

import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.media3.exoplayer.ExoPlayer

/**
 * Imagen en imagen en el celular (no en TV): con el botón del reproductor, al salir con Inicio
 * (en Android 12 o más entra solo, sin saltos) y con pausa / reproducir dentro de la ventanita.
 * La ventanita toma la forma del video (dentro de lo que Android permite: entre 1:2,39 y 2,39:1).
 */
class PlayerPip(private val activity: ComponentActivity, private val player: ExoPlayer, tv: Boolean) {
    companion object { private const val ACTION = "com.latmpx.player.PIP_TOGGLE" }

    val supported: Boolean = !tv && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private var registered = false
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) {
            if (i?.action != ACTION) return
            if (player.isPlaying) player.pause() else player.play()
        }
    }

    fun register() {
        if (!supported || registered) return
        ContextCompat.registerReceiver(activity, receiver, IntentFilter(ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)
        registered = true
    }

    fun unregister() {
        if (!registered) return
        runCatching { activity.unregisterReceiver(receiver) }
        registered = false
    }

    private fun params(): PictureInPictureParams? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
        val vs = player.videoSize
        val w = (vs.width * vs.pixelWidthHeightRatio).toInt()
        var r = if (w > 0 && vs.height > 0) Rational(w, vs.height) else Rational(16, 9)
        if (r.toFloat() > 2.39f) r = Rational(239, 100) else if (r.toFloat() < 1 / 2.39f) r = Rational(100, 239)
        val playing = player.isPlaying
        val label = if (playing) "Pausa" else "Reproducir"
        val icon = Icon.createWithResource(activity, if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
        val pi = PendingIntent.getBroadcast(activity, 1, Intent(ACTION).setPackage(activity.packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val b = PictureInPictureParams.Builder().setAspectRatio(r).setActions(listOf(RemoteAction(icon, label, label, pi)))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) b.setAutoEnterEnabled(playing).setSeamlessResizeEnabled(true)
        return b.build()
    }

    /** avisa al sistema cuando cambia la pausa o el tamaño del video (botón de la ventanita y entrada automática) */
    fun update() {
        if (!supported || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val p = params() ?: return
        runCatching { activity.setPictureInPictureParams(p) }
    }

    /** botón del reproductor */
    fun enter(): Boolean {
        if (!supported || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        val p = params() ?: return false
        return runCatching { activity.enterPictureInPictureMode(p) }.getOrDefault(false)
    }

    /** Inicio o apps recientes en Android 8 a 11 (desde la 12 entra solo con setAutoEnterEnabled) */
    fun onUserLeaveHint() {
        if (supported && Build.VERSION.SDK_INT < Build.VERSION_CODES.S && player.isPlaying) enter()
    }
}
