<?php
// Vista de la pantalla falsa (la incluye wp_fake_screen_render; sola no hace nada).
if (!defined('WP_FAKE_COOKIE') || !isset($fake, $type, $nonce)) exit;
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <meta name="robots" content="noindex">
    <title><?php echo $type === 'calculator' ? 'Calculadora' : '&#8203;'; ?></title>
    <style>
        html, body { margin: 0; height: 100%; background: #111827; overflow: hidden; font-family: system-ui, sans-serif; }
        body { display: flex; align-items: center; justify-content: center; }
        .media { width: 100%; height: 100%; object-fit: contain; border: 0; display: block; }
        .web { background: #fff; }
        #slide { transition: opacity .5s ease-in-out; }
        .calc { background: #1f2937; padding: 24px; border-radius: 20px; width: min(92vw, 360px); box-shadow: 0 10px 30px rgba(0,0,0,.8); box-sizing: border-box; }
        .display { height: 76px; background: #374151; color: #fff; font-size: 2.6rem; text-align: right; border-radius: 10px; padding: 0 14px; line-height: 76px; margin-bottom: 18px; overflow: hidden; white-space: nowrap; }
        .keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .key { padding: 18px 0; font-size: 1.4rem; font-weight: 700; border: 0; border-radius: 10px; background: #4b5563; color: #fff; cursor: pointer; }
        .key:active { transform: scale(.95); }
        .key:focus-visible { outline: 3px solid #fff; }
        .key.op { background: #f59e0b; }
        .key.clear { background: #ef4444; }
        .key.wide { grid-column: span 2; }
    </style>
</head>
<body>
<?php if ($type === 'carrusel'): ?>
    <img id="slide" class="media" src="<?php echo e($fake['images'][0]); ?>" alt="">
<?php elseif ($type === 'image'): ?>
    <img class="media" src="<?php echo e($fake['url']); ?>" alt="">
<?php elseif ($type === 'video'): ?>
    <video class="media" src="<?php echo e($fake['url']); ?>" autoplay loop muted playsinline></video>
<?php elseif ($type === 'web'): ?>
    <iframe class="media web" src="<?php echo e($fake['url']); ?>" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" title="web"></iframe>
<?php else: ?>
    <div class="calc">
        <div class="display" id="display">0</div>
        <div class="keys">
            <?php foreach (['C', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '='] as $k):
                $cls = $k === 'C' ? ' clear' : (in_array($k, ['÷', '×', '-', '+', '=', '(', ')'], true) ? ' op' : '');
                if ($k === '0') $cls .= ' wide'; ?>
                <button type="button" class="key<?php echo $cls; ?>" data-k="<?php echo e($k); ?>"><?php echo e($k); ?></button>
            <?php endforeach; ?>
        </div>
    </div>
<?php endif; ?>
<script nonce="<?php echo e($nonce); ?>">
(function () {
    // código del panel + "=" (o Enter) abre el inicio de sesión; se comprueba en el servidor
    function unlock(code, done) {
        if (!/^\d{3,12}$/.test(code)) return done(false);
        var x = new XMLHttpRequest();
        x.open('POST', location.pathname, true);
        x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        x.onload = function () {
            var ok = false;
            try { ok = JSON.parse(x.responseText).ok === true; } catch (e) {}
            if (ok) location.reload(); else done(false);
        };
        x.onerror = function () { done(false); };
        x.send('fake_unlock=' + encodeURIComponent(code));
    }

    // + - × ÷ y paréntesis sin eval
    function calc(src) {
        var t = src.match(/\d+(\.\d+)?|[()+\-×÷]/g) || [], p = 0;
        if (/[^\d.()+\-×÷]/.test(src)) return 'Error';
        if (!t.length) return '';
        function num() {
            var x = t[p++];
            if (x === '(') { var v = add(); p++; return v; }
            if (x === '-') return -num();
            if (x === undefined || isNaN(Number(x))) throw 0;
            return Number(x);
        }
        function mul() {
            var v = num();
            while (t[p] === '×' || t[p] === '÷') { var o = t[p++], r = num(); v = o === '×' ? v * r : v / r; }
            return v;
        }
        function add() {
            var v = mul();
            while (t[p] === '+' || t[p] === '-') { var o = t[p++], r = mul(); v = o === '+' ? v + r : v - r; }
            return v;
        }
        try {
            var v = add();
            return p === t.length && isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : 'Error';
        } catch (e) { return 'Error'; }
    }

    var display = document.getElementById('display');
    if (display) {
        var cur = '';
        var show = function () { display.textContent = cur || '0'; };
        var press = function (k) {
            if (k === 'C') { cur = ''; return show(); }
            if (k === '=') {
                var typed = cur;
                return unlock(typed, function () { cur = calc(typed); show(); });
            }
            if (cur === 'Error') cur = '';
            if (cur.length < 32) cur += k;
            show();
        };
        document.querySelectorAll('.key').forEach(function (b) {
            b.addEventListener('click', function () { press(b.getAttribute('data-k')); });
        });
        document.addEventListener('keydown', function (ev) {
            var map = { '*': '×', '/': '÷', 'Enter': '=', '=': '=', 'Escape': 'C', 'Backspace': null };
            var k = ev.key in map ? map[ev.key] : ev.key;
            if (ev.key === 'Backspace') { cur = cur.slice(0, -1); return show(); }
            if (k && /^[\d.()+\-×÷=C]$/.test(k)) { ev.preventDefault(); press(k); }
        });
        return;
    }

    // imagen, carrusel, video o web: el código con el teclado + Enter, o 3 s pulsado para escribirlo
    var buf = '';
    document.addEventListener('keydown', function (ev) {
        if (/^\d$/.test(ev.key)) { buf = (buf + ev.key).slice(-12); return; }
        if (ev.key === 'Enter') { var c = buf; buf = ''; unlock(c, function () {}); }
    });
    var hold = null;
    document.addEventListener('pointerdown', function () {
        hold = setTimeout(function () {
            var c = window.prompt('') || '';
            unlock(c.replace(/\D/g, ''), function () {});
        }, 3000);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) {
        document.addEventListener(n, function () { clearTimeout(hold); });
    });

    var slide = document.getElementById('slide');
    var images = <?php echo json_encode($type === 'carrusel' ? $fake['images'] : [], JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT); ?>;
    if (slide && images.length > 1) {
        var i = 0;
        setInterval(function () {
            slide.style.opacity = 0;
            setTimeout(function () { i = (i + 1) % images.length; slide.src = images[i]; slide.style.opacity = 1; }, 500);
        }, <?php echo (int)$fake['interval'] * 1000; ?>);
    }
})();
</script>
</body>
</html>
