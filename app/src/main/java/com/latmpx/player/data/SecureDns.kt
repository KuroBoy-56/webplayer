package com.latmpx.player.data

import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps
import java.net.InetAddress
import java.util.concurrent.TimeUnit

/**
 * DNS elegido por el usuario (botón "DNS"). Se aplica a todo el tráfico de la app porque el cliente
 * OkHttp único (Net.client) resuelve nombres con SecureDns: panel, Xtream, imágenes y ExoPlayer.
 */
object SecureDns : Dns {
    data class Option(val key: String, val label: String, val note: String, val url: String, val bootstrap: List<String>)

    val options = listOf(
        Option("auto", "Automático", "El DNS de tu red (recomendado)", "", emptyList()),
        Option("cloudflare", "Cloudflare", "Rápido y privado", "https://cloudflare-dns.com/dns-query", listOf("1.1.1.1", "1.0.0.1")),
        Option("google", "Google", "Estable en todo el mundo", "https://dns.google/dns-query", listOf("8.8.8.8", "8.8.4.4")),
        Option("quad9", "Quad9", "Bloquea sitios peligrosos", "https://dns.quad9.net/dns-query", listOf("9.9.9.9", "149.112.112.112")),
        Option("adguard", "AdGuard", "Sin rastreo ni anuncios", "https://dns.adguard-dns.com/dns-query", listOf("94.140.14.14", "94.140.15.15")),
        Option("nextdns", "NextDNS", "Anti-bloqueo geográfico", "https://dns.nextdns.io/dns-query", listOf("45.90.28.0", "45.90.30.0")),
        Option("opendns", "OpenDNS", "Filtro de Cisco", "https://doh.opendns.com/dns-query", listOf("146.112.41.2", "146.112.41.3")),
    )

    // cliente aparte para las consultas DoH (sin SecureDns, para no entrar en bucle)
    private val bootstrapClient: OkHttpClient by lazy {
        OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).build()
    }

    @Volatile private var resolver: Dns = Dns.SYSTEM
    @Volatile var current: Option = options.first()
        private set

    /** Cambia el DNS; las conexiones abiertas se cierran para que lo siguiente use el nuevo. */
    fun select(key: String) {
        val opt = options.firstOrNull { it.key == key } ?: options.first()
        resolver = if (opt.url.isEmpty()) Dns.SYSTEM else try {
            DnsOverHttps.Builder()
                .client(bootstrapClient)
                .url(opt.url.toHttpUrl())
                .bootstrapDnsHosts(opt.bootstrap.map { InetAddress.getByName(it) })
                .includeIPv6(false)
                .build()
        } catch (e: Exception) {
            Dns.SYSTEM
        }
        current = opt
        runCatching { Net.client.connectionPool.evictAll() }
    }

    override fun lookup(hostname: String): List<InetAddress> {
        val r = resolver
        if (r === Dns.SYSTEM) return Dns.SYSTEM.lookup(hostname)
        return try {
            r.lookup(hostname)
        } catch (e: Exception) {
            // si el DNS seguro no responde, se usa el de la red para no dejar la app sin conexión
            Dns.SYSTEM.lookup(hostname)
        }
    }
}
