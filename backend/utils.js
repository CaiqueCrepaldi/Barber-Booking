export function sanitizeText(str) {
  if (!str) return '';
  return String(str).replace(/[<>&"'`\\]/g, '');
}
