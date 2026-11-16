const pad = (n) => String(n).padStart(2, '0');

// Fecha local de operación (YYYY-MM-DD) para un desfase en minutos respecto a UTC.
// Las reglas de Firestore hacen el mismo cálculo con la hora del servidor.
export function todayFor(offsetMinutes, now = Date.now()) {
  return new Date(now + offsetMinutes * 60000).toISOString().slice(0, 10);
}

// 'YYYY-MM-DD' -> texto legible, sin conversiones de zona horaria.
export function formatWorkDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-MX', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function shortDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Timestamp de Firestore (o Date) mostrado en la hora local de operación.
export function formatDateTime(ts, offsetMinutes) {
  if (!ts) return '';
  const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  const t = new Date(date.getTime() + offsetMinutes * 60000);
  return `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function offsetLabel(minutes) {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export const liters = (n) =>
  `${Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 })} L`;

// Mensaje legible a partir de un error de Firebase.
export function errorMessage(err) {
  switch (err?.code) {
    case 'permission-denied': return 'No tienes permiso para esta acción.';
    case 'unavailable': return 'Sin conexión con el servidor.';
    case 'failed-precondition': return 'Falta un índice de Firestore. Ejecuta: npm run deploy:rules';
    default: return err?.message || 'Error inesperado.';
  }
}
