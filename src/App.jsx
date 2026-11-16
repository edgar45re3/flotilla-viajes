import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, configError } from './firebase.js';
import Login from './components/Login.jsx';
import OperatorView from './components/OperatorView.jsx';
import AdminView from './components/AdminView.jsx';
import ChangePassword from './components/ChangePassword.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = aún no se sabe
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [error, setError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (!auth) return undefined;
    return onAuthStateChanged(auth, setUser);
  }, []);

  // El rol se lee de Firestore (reglas: solo tu propio perfil). Mostrar una
  // vista u otra es solo comodidad; los permisos los aplican las reglas.
  const loadProfile = useCallback(async (uid) => {
    setLoadingProfile(true);
    setError('');
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      const data = snap.exists() ? { uid, ...snap.data() } : null;
      if (!data) setError('Tu cuenta no tiene perfil asignado. Contacta al administrador.');
      else if (!data.active) setError('Tu cuenta está desactivada.');
      setProfile(data?.active ? data : null);
    } catch {
      setError('No se pudo cargar tu perfil.');
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    if (user) loadProfile(user.uid);
    else { setProfile(null); setChangingPassword(false); }
  }, [user, loadProfile]);

  if (configError) return <main className="shell"><p className="alert error">{configError}</p></main>;
  if (user === undefined || loadingProfile) return <main className="shell"><p className="muted">Cargando…</p></main>;
  if (!user) return <Login />;

  const mustChange = profile?.mustChangePassword === true;

  return (
    <main className={profile?.role === 'admin' && !mustChange && !changingPassword ? 'shell wide' : 'shell'}>
      <header className="topbar">
        <div>
          <strong>{profile?.fullName ?? 'Sesión'}</strong>
          {profile && <span className="muted"> · Empleado {profile.employeeNumber}</span>}
        </div>
        <div className="row">
          {profile && !mustChange && !changingPassword && (
            <button className="secondary" onClick={() => setChangingPassword(true)}>Cambiar contraseña</button>
          )}
          <button className="secondary" onClick={() => signOut(auth)}>Cerrar sesión</button>
        </div>
      </header>
      {error && <p className="alert error">{error}</p>}

      {profile && mustChange && (
        <ChangePassword forced onDone={() => loadProfile(profile.uid)} />
      )}
      {profile && !mustChange && changingPassword && (
        <ChangePassword onDone={() => setChangingPassword(false)} onCancel={() => setChangingPassword(false)} />
      )}
      {profile && !mustChange && !changingPassword && profile.role === 'operator' && <OperatorView uid={profile.uid} />}
      {profile && !mustChange && !changingPassword && profile.role === 'admin' && <AdminView uid={profile.uid} />}
    </main>
  );
}
