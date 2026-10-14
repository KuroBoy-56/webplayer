<?php
include "session.php";
$pagename = t('Mi cuenta');
include "config.php";

$data = xt_get('', [], 300, 10); // player_api.php sin acción = datos de la cuenta
$ui = is_array($data["user_info"] ?? null) ? $data["user_info"] : [];
$exp = $ui["exp_date"] ?? null;
$acc_active = $ui["status"] ?? t('Desconocido');
// DEMO: nunca se muestra el usuario de la línea
$acc_demo = wp_is_demo();
$acc_user = $acc_demo ? 'DEMO' : ($ui["username"] ?? $username);
$max_conn = $ui['max_connections'] ?? '';
$active_conn = $ui['active_cons'] ?? '';
$created = !empty($ui['created_at']) ? wp_date((int)$ui['created_at']) : '';
$expire = ($exp == NULL) ? t('ILIMITADO') : wp_date((int)$exp);
$days_left = ($exp && is_numeric($exp)) ? (int)floor(((int)$exp - time()) / 86400) : null;

// Lo que el usuario está viendo (guardado en el panel, igual que en las apps)
$history_items = array_values(wp_user_progress($username));
usort($history_items, function ($a, $b) { return ($b['_when'] ?? 0) <=> ($a['_when'] ?? 0); });
// Distribuidor (número guardado en este navegador)
$dist_cfg = wp_tenant_cfg();
$dist_code = wp_panel_tenant();
$dist_exp = $dist_cfg ? wp_tenant_expiry_text($dist_cfg) : '';
$body_class = 'nf-solid';
include "header.php";
?>
<style>
    .ac-wrap { max-width: 980px; margin: 0 auto; }
    .ac-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 26px; }
    .ac-item { background: #1a1a1a; border-radius: 8px; padding: 18px; }
    .ac-item small { display: block; color: #8c8c8c; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    .ac-item b { font-size: 20px; color: #fff; word-break: break-all; }
    .ac-item .ok { color: #46d369; }
    .ac-item .bad { color: #e87c03; }
    .ac-hist { background: #1a1a1a; border-radius: 8px; overflow: hidden; }
    .ac-hist h3 { margin: 0; padding: 16px 18px; font-size: 18px; border-bottom: 1px solid #2a2a2a; color: #fff; }
    .ac-row { display: flex; align-items: center; gap: 12px; padding: 12px 18px; border-bottom: 1px solid #242424; }
    .ac-row .n { flex: 1; color: #eee; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ac-row .t { font-size: 11px; padding: 3px 8px; border-radius: 3px; font-weight: 700; text-transform: uppercase; }
    .ac-row .t.movie { background: rgba(229,9,20,.18); color: #ff5a63; }
    .ac-row .t.series { background: rgba(0,168,225,.15); color: #4fc3f7; }
    .ac-row .d { color: #8c8c8c; font-size: 13px; white-space: nowrap; }
    .ac-acts { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 26px; }
    .ac-lang { background: #1a1a1a; border-radius: 8px; padding: 16px 18px; margin-bottom: 26px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .ac-lang label { color: #fff; font-weight: 700; display: flex; align-items: center; gap: 10px; }
    .ac-lang label i { color: var(--nf-red); }
    @media (max-width: 600px) { .ac-row { flex-wrap: wrap; } .ac-row .d { width: 100%; } }
</style>
<div class="nf-page account-wrapper">
    <div class="ac-wrap">
        <h1 class="nf-page-title"><?php echo t('Mi cuenta'); ?></h1>
        <p class="nf-page-sub"><?php echo t('Detalles de tu suscripción y lo que estás viendo.'); ?></p>
        <?php if ($acc_demo): ?><p class="nf-page-sub"><b style="background:var(--nf-red);color:#fff;padding:3px 8px;border-radius:3px;font-size:12px;letter-spacing:1px"><?php echo t('Cuenta DEMO'); ?></b> <?php echo e(t('En la DEMO no se guardan "Continuar viendo" ni "Mi lista".')); ?></p><?php endif; ?>
        <div class="ac-grid">
            <div class="ac-item"><small><?php echo t('Usuario'); ?></small><b><?php echo e($acc_user); ?></b></div>
            <div class="ac-item"><small><?php echo t('Estado'); ?></small><b class="<?php echo strcasecmp($acc_active, 'Active') === 0 ? 'ok' : 'bad'; ?>"><?php echo strcasecmp($acc_active, 'Active') === 0 ? t('Activa') : e($acc_active); ?></b></div>
            <div class="ac-item"><small><?php echo t('Vence'); ?></small><b><?php echo e($expire); ?></b><?php if ($days_left !== null): ?><div style="color:#999;font-size:13px;margin-top:4px"><?php echo $days_left >= 0 ? t('Quedan {n} días', ['n' => $days_left]) : t('Vencida'); ?></div><?php endif; ?></div>
            <?php if ($max_conn !== ''): ?><div class="ac-item"><small><?php echo t('Conexiones'); ?></small><b><?php echo e($active_conn); ?> / <?php echo e($max_conn); ?></b></div><?php endif; ?>
            <?php if (!empty($_SESSION['server_name'])): ?><div class="ac-item"><small><?php echo t('Servidor'); ?></small><b><?php echo e(!empty($_SESSION['server_id']) ? t('Servidor {n}', ['n' => $_SESSION['server_id']]) : $_SESSION['server_name']); ?></b></div><?php endif; ?>
            <?php if ($created): ?><div class="ac-item"><small><?php echo t('Cliente desde'); ?></small><b><?php echo e($created); ?></b></div><?php endif; ?>
            <?php if ($dist_code !== ''): ?>
            <div class="ac-item"><small><?php echo t('Distribuidor'); ?></small><b><?php echo e(($dist_cfg && $dist_cfg['name'] ? $dist_cfg['name'] . ' ' : '') . '(' . $dist_code . ')'); ?></b></div>
            <div class="ac-item"><small><?php echo t('Vence'); ?></small><b><?php echo $dist_exp !== '' ? e($dist_exp) : t('Sin vencimiento'); ?></b><?php if ($dist_exp !== ''): ?><div style="color:#999;font-size:13px;margin-top:4px"><?php echo t('Hora de Panamá'); ?></div><?php endif; ?></div>
            <?php endif; ?>
        </div>
        <div class="ac-acts">
            <a class="nf-btn nf-btn-dark" href="settings.php"><i class="fas fa-cog"></i> <?php echo t('Ajustes'); ?></a>
            <a class="nf-btn nf-btn-dark" href="logout.php?dist=1" data-noprefetch onclick="try{localStorage.removeItem('wp_dist_brand')}catch(e){}"><i class="fas fa-exchange-alt"></i> <?php echo t('Cambiar distribuidor'); ?></a>
            <a class="nf-btn nf-btn-dark" href="logout.php" data-noprefetch><i class="fas fa-sign-out-alt"></i> <?php echo t('Cerrar sesión'); ?></a>
        </div>
        <div class="ac-lang"><label for="acLang"><i class="fas fa-globe"></i> <?php echo t('Idioma de la app'); ?></label><?php echo str_replace('<select ', '<select id="acLang" ', wp_lang_select()); ?></div>
        <div class="ac-hist history-section">
            <h3><?php echo t('Continuar viendo'); ?></h3>
            <?php if ($acc_demo): ?>
                <div class="nf-empty" style="padding:30px"><?php echo t('No disponible en la DEMO.'); ?></div>
            <?php elseif ($history_items): ?>
                <?php foreach (array_slice($history_items, 0, 200) as $item): ?>
                    <div class="ac-row">
                        <span class="n"><?php echo e($item['title'] ?? ''); ?></span>
                        <span class="t <?php echo ($item['type'] ?? '') === 'movie' ? 'movie' : 'series'; ?>"><?php echo ($item['type'] ?? '') === 'movie' ? t('Película') : t('Serie'); ?></span>
                        <span class="d"><?php echo !empty($item['last_watched']) ? e(wp_date((int)$item['last_watched'], true)) : ''; ?></span>
                    </div>
                <?php endforeach; ?>
            <?php else: ?>
                <div class="nf-empty" style="padding:30px"><?php echo t('Aún no tienes contenido en progreso.'); ?></div>
            <?php endif; ?>
        </div>
    </div>
</div>
<?php include "footer.php"; ?>
