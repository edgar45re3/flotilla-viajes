import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, authPassword, emailFor } from '../firebase.js';

const MESSAGES = {
  'auth/invalid-credential': 'Número de empleado o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Número de empleado o contraseña incorrectos.',
  'auth/wrong-password': 'Número de empleado o contraseña incorrectos.',
  'auth/user-not-found': 'Número de empleado o contraseña incorrectos.',
  'auth/user-disabled': 'Tu cuenta está desactivada. Contacta al administrador.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e intenta de nuevo.',
  'auth/network-request-failed': 'Sin conexión con el servidor.',
};

export default function Login() {
  const [employee, setEmployee] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const emp = employee.trim();
    if (!/^\d{1,10}$/.test(emp)) {
      setError('El número de empleado solo lleva dígitos.');
      return;
    }
    setBusy(true);
    try {
      // Firebase Auth valida la contraseña en sus servidores y limita intentos.
      await signInWithEmailAndPassword(auth, emailFor(emp), authPassword(password));
    } catch (err) {
      setError(MESSAGES[err.code] ?? 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
      setPassword('');
    }
  };

  return (
    <main className="shell">
      <form className="card" onSubmit={submit}>
        <h1>Registro de viajes</h1>
        <label htmlFor="employee">Inserta tu número de empleado</label>
        <input
          id="employee"
          inputMode="numeric"
          autoComplete="username"
          value={employee}
          onChange={(e) => setEmployee(e.target.value)}
          required
        />
        <label htmlFor="password">Inserta tu contraseña</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="alert error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  );
}
