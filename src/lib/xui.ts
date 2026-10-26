// Servidores XUI.one en «Debug Mode»: cuando algo falla contestan 200 con una página HTML en lugar del video. De
// esa página sale el código del motivo (INVALID_STREAM_ID, STREAM_OFFLINE, BLOCKED_USER_AGENT, EXPIRED…).
// código y texto de la página de error de XUI.one («XUI.ONE INVALID_STREAM_ID Stream ID doesn't exist.»)
export function xuiError(html: string): { code: string; text: string } | null {
  const text = html
    .replace(/<(style|script|title)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const at = text.toUpperCase().lastIndexOf('XUI.ONE');
  const m = (at >= 0 ? text.slice(at + 7) : text).trim().match(/^([A-Z][A-Z0-9_]{2,})\b\s*(.{0,160})/);
  return m ? { code: m[1], text: m[2].trim() } : null;
}
