<?php
/*
 * Relay HTTPS (opcional). Copia este archivo como includes/https_relay.php y pon la dirección
 * de tu Cloudflare Worker (ver cloudflare/relay-worker.js y GUIA.md, sección "Video por HTTPS").
 * Con esto la web puede estar en https y el video http del servidor IPTV llega por https,
 * pasando por Cloudflare y nunca por tu hosting. Déjalo sin crear si tu web funciona en http.
 */
return 'https://mi-relay.mi-cuenta.workers.dev';
