<?php
// La página de inicio ahora es homex (más rápida). Se conserva esta URL.
header('Location: homex' . (!empty($_SERVER['QUERY_STRING']) ? '?' . $_SERVER['QUERY_STRING'] : ''));
exit;
