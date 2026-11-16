import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, authPassword, db } from '../firebase.js';

export const MIN_PASSWORD = 8;

const MESSAGES = {
  'auth/invalid-credential': 'La contraseña actual no es correcta.',
  'auth/invalid-login-credentials': 'La contraseña actual no es correcta.',
  'auth/wrong-password': 'La contraseña actual no es correcta.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e intenta de nuevo.',
  'auth/weak-password': 'La contraseña nueva es muy débil.',
  'auth/network-request-failed': 'Sin conexión con el servidor.',
};

// forced = primer inicio de sesión con contraseña temporal.
export default function ChangePassword({ forced, onDone, onCancel }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < MIN_PASSWORD) { setError(`La contraseña nueva debe tener al menos ${MIN_PASSWORD} caracteres.`); return; }
    if (next !== repeat) { setError('Las contraseñas nuevas no coinciden.'); return; }
    if (next === current) { setError('La contraseña nueva debe ser distinta a la actual.'); return; }

    setBusy(true);
    try {
      const user = auth.currentUser;
      // Firebase exige confirmar la contraseña actual antes de cambiarla.
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, authPassword(current)));
      await updatePassword(user, authPassword(next));
      if (forced) {
        await updateDoc(doc(db, 'users', user.uid), {
          mustChangePassword: false,
          passwordChangedAt: serverTimestamp(),
        });
      }
      setOk(true);
      setCurrent(''); setNext(''); setRepeat('');
      setTimeout(() => onDone?.(), forced ? 0 : 1500);
    } catch (err) {
      setError(MESSAGES[err.code] ?? 'No se pudo cambiar la contraseña.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>{forced ? 'Crea tu contraseña' : 'Cambiar contraseña'}</h2>
      {forced && (
        <p className="muted">
          Es tu primer inicio de sesión. Cambia la contraseña temporal por una que solo tú conozcas.
        </p>
      )}
      <label htmlFor="pw-current">{forced ? 'Contraseña temporal' : 'Contraseña actual'}</label>
      <input id="pw-current" type="password" autoComplete="current-password"
        value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <label htmlFor="pw-next">Nueva contraseña</label>
      <input id="pw-next" type="password" autoComplete="new-password"
        value={next} onChange={(e) => setNext(e.target.value)} required />
      <p className="muted small">Mínimo {MIN_PASSWORD} caracteres.</p>
      <label htmlFor="pw-repeat">Repite la nueva contraseña</label>
      <input id="pw-repeat" type="password" autoComplete="new-password"
        value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
      {error && <p className="alert error" role="alert">{error}</p>}
      {ok && !forced && <p className="alert ok">Contraseña actualizada.</p>}
      <button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
      {onCancel && <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancelar</button>}
    </form>
  );
}
