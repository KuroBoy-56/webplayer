<?php
include "session.php";
include "config.php";
$pagename = "Deportes";
function fetchAndProcessContent($target_url) {
    $content = wp_http_get($target_url, 12);
    if (!$content) return null;
    
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    @$dom->loadHTML('<?xml encoding="UTF-8">' . $content);
    libxml_use_internal_errors(false);
    
    $xpath = new DOMXPath($dom);
    
    // 1. LIMPIEZA NUCLEAR: Quitamos atributos que rompen el móvil desde el origen
    $allElements = $xpath->query('//table|//tr|//td|//th|//span|//div');
    foreach ($allElements as $el) {
        $el->removeAttribute('style'); // Borra estilos en línea de la página original
        $el->removeAttribute('width'); // Borra anchos fijos
        $el->removeAttribute('height'); // Borra altos fijos
        $el->removeAttribute('nowrap'); // Borra el bloqueo de salto de línea
    }

    // 2. Procesar imágenes
    $images = $xpath->query('//img');
    foreach ($images as $img) {
        $src = $img->getAttribute('src');
        if (!empty($src) && !preg_match('/^https?:\/\//i', $src)) {
            $src = 'https://www.thesportsdb.com/' . ltrim($src, './');
            $img->setAttribute('src', $src);
        }
        
        $w = $img->getAttribute('width');
        // Mantener iconos y logos pequeños
        if (($w && $w <= 30) || preg_match('/(icon|flag|time|calendar|\.ico)/i', $src)) {
            $img->setAttribute('class', 'img-icon');
        } else {
            $img->setAttribute('class', 'img-banner');
        }
        $img->removeAttribute('width');
        $img->removeAttribute('height');
        $img->removeAttribute('style');
    }
    
    // Seguridad: sin scripts ni eventos
    foreach ($xpath->query('//script|//iframe|//style') as $bad) {
        $bad->parentNode->removeChild($bad);
    }
    foreach ($xpath->query('//@*[starts-with(name(), "on")]') as $attr) {
        $attr->ownerElement->removeAttribute($attr->nodeName);
    }
    // 3. Quitar enlaces
    $links = $xpath->query('//a');
    foreach ($links as $link) {
        $link->removeAttribute('href');
        $link->setAttribute('style', 'color: inherit; text-decoration: none; cursor: default;');
    }
    
    return $dom;
}

$sports = wp_cache_get('sports|tables', 1800, $sports_stale);
if (!is_array($sports)) {
    $dom1 = fetchAndProcessContent("https://www.thesportsdb.com/browse_tv");
    $table1 = $dom1 ? (new DOMXPath($dom1))->query('//table')->item(0) : null;
    $dom2 = fetchAndProcessContent("https://www.thesportsdb.com/");
    $table2 = $dom2 ? (new DOMXPath($dom2))->query('//table')->item(4) : null;
    $sports = ['t1' => $table1 ? $dom1->saveXML($table1) : '', 't2' => $table2 ? $dom2->saveXML($table2) : ''];
    if ($sports['t1'] || $sports['t2']) wp_cache_set('sports|tables', $sports);
    elseif (is_array($sports_stale)) $sports = $sports_stale;
}
$body_class = 'nf-solid';
include "header.php";
?>
<style>
        .sp-wrap * { max-width: 100% !important; }
        .sp-wrap { color: #b3b3b3; padding-top: calc(var(--nf-header) + 16px); }
        
        .sp-wrap .content-container {
            max-width: 1200px;
            margin: 30px auto;
            padding: 0 15px;
            width: 100%;
            overflow-x: hidden;
        }

        .sp-wrap .search-container {
            margin-bottom: 25px;
            text-align: center;
        }

        .sp-wrap #searchInput {
            width: 100%;
            max-width: 500px !important;
            padding: 15px 25px;
            border-radius: 50px;
            border: 1px solid #2a2a2a;
            background-color: #1a1a1a;
            color: #ffffff;
            font-size: 16px;
            outline: none;
        }

        /* --- ESTILOS DE ESCRITORIO --- */
        .sp-wrap .table-responsive {
            width: 100%;
            overflow-x: auto;
            background-color: #1a1a1a;
            border-radius: 12px;
            padding: 20px;
        }
        
        .sp-wrap table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .sp-wrap th {
            background-color: #101010;
            color: #b3b3b3;
            font-size: 13px;
            padding: 15px;
            text-align: left;
            border-bottom: 2px solid #2a2a2a;
        }
        
        .sp-wrap td {
            padding: 15px;
            vertical-align: middle;
            border-bottom: 1px solid #2a2a2a;
            color: #ffffff;
            font-size: 15px;
        }
        
        .sp-wrap .img-banner {
            border-radius: 6px;
            max-width: 90px !important;
            height: auto !important;
        }

        .sp-wrap .img-icon {
            max-width: 25px !important;
            height: auto !important;
            display: inline-block;
            margin: 0 4px;
        }

        .sp-wrap .section-divider {
            border: 0;
            height: 2px;
            background: #e50914;
            margin: 40px 0;
        }

        /* =========================================
           DISEÑO MÓVIL (VERTICAL EXTREMO Y SIN FUGAS)
           ========================================= */
        @media (max-width: 768px) {
            .sp-wrap .content-container { margin: 15px auto; padding: 0 10px; }
            
            .sp-wrap .table-responsive {
                padding: 0;
                background-color: transparent;
                overflow-x: hidden !important; 
            }

            /* REGLA MAESTRA PARA MÓVILES: Romper cualquier texto que intente desbordar */
            .sp-wrap .table-responsive * {
                white-space: normal !important; 
                word-wrap: break-word !important; 
                overflow-wrap: break-word !important;
            }
            
            .sp-wrap table { 
                min-width: 0 !important; 
                width: 100% !important; 
                table-layout: fixed !important;
            }

            .sp-wrap table, .sp-wrap thead, .sp-wrap tbody, .sp-wrap th, .sp-wrap td, .sp-wrap tr {
                display: block !important;
                width: 100% !important;
            }

            .sp-wrap thead { display: none !important; }

            .sp-wrap tr {
                background-color: #1a1a1a;
                margin-bottom: 20px;
                border-radius: 12px;
                padding: 15px 10px;
                border: 1px solid #2a2a2a;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                min-width: 0 !important; /* Vital para que flex no desborde */
            }

            .sp-wrap td {
                padding: 6px 0 !important;
                border: none !important;
                text-align: center !important;
                min-width: 0 !important;
                width: 100% !important;
            }

            /* Identifica si hay una fila de título/fecha (ej. td colspan="5") */
            .sp-wrap td[colspan] {
                background: rgba(229, 9, 20, 0.1);
                color: #e50914 !important;
                font-weight: bold;
                border-radius: 6px;
                padding: 10px !important;
                margin-bottom: 10px !important;
            }

            /* 1. Logos de eventos */
            .sp-wrap td:nth-child(1) { margin-bottom: 10px; }

            /* 2 y 3. Fechas y Horas */
            .sp-wrap td:nth-child(2), .sp-wrap td:nth-child(3) {
                background: rgba(255, 255, 255, 0.05);
                color: #b3b3b3;
                font-size: 13px;
                padding: 5px 15px !important;
                border-radius: 20px;
                margin: 3px auto !important;
                display: inline-block !important; /* Para que queden como pastillas */
                width: fit-content !important;
            }

            /* 4. Título / Nombre del Partido */
            .sp-wrap td:nth-child(4) {
                font-size: 17px;
                font-weight: bold;
                color: #ffffff;
                margin: 10px 0 !important;
                line-height: 1.3;
            }

            /* 5. Canales / Logos inferiores */
            .sp-wrap td:nth-child(5) {
                margin-top: 10px !important;
                padding: 10px !important;
                background: #101010;
                border-radius: 8px;
                display: flex !important;
                flex-direction: row !important;
                flex-wrap: wrap !important; /* Obliga a los logos a saltar a otra línea si no caben */
                justify-content: center !important;
                align-items: center !important;
                gap: 8px;
            }
        }
    </style>

    <div class="sp-wrap"><div class="content-container"><h1 class="nf-page-title" style="text-align:left">Deportes en TV</h1>
        <div class="search-container">
            <input type="text" id="searchInput" onkeyup="filterTables()" placeholder="Buscar equipos, ligas o canales...">
        </div>

        <?php if (!empty($sports['t1'])): ?>
            <div class="table-responsive"><?php echo $sports['t1']; ?></div>
        <?php endif; ?>

        <hr class="section-divider">

        <?php if (!empty($sports['t2'])): ?>
            <div class="table-responsive"><?php echo $sports['t2']; ?></div>
        <?php endif; ?>
        <?php if (empty($sports['t1']) && empty($sports['t2'])): ?><div class="nf-empty">La agenda deportiva no está disponible en este momento.</div><?php endif; ?>
    </div>

    </div>
    <script>
        function filterTables() {
            let input = document.getElementById("searchInput");
            let filter = input.value.toLowerCase();
            let tables = document.querySelectorAll("table");

            tables.forEach(table => {
                let trs = table.getElementsByTagName("tr");
                for (let i = 0; i < trs.length; i++) {
                    let tr = trs[i];
                    if (tr.getElementsByTagName("th").length > 0 || tr.parentNode.tagName.toLowerCase() === 'thead') {
                        continue;
                    }
                    let textContent = tr.textContent || tr.innerText;
                    if (textContent.toLowerCase().indexOf(filter) > -1) {
                        tr.style.display = ""; 
                    } else {
                        tr.style.display = "none";
                    }
                }
            });
        }
    </script>
<?php include "footer.php"; ?>
