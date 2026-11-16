import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, initializeAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

// Valores PÚBLICOS de la app web. La seguridad real está en firestore.rules.
const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const EMAIL_DOMAIN = env.VITE_EMPLOYEE_EMAIL_DOMAIN || 'flotilla.example.com';

export const configError = Object.values(config).some((v) => !v)
  ? 'Falta configurar las variables VITE_FIREBASE_* (revisa .env.example).'
  : null;

export let auth = null;
export let db = null;

if (!configError) {
  const app = initializeApp(config);
  // Sin popup/redirect: no se carga ningún iframe externo.
  auth = initializeAuth(app, { persistence: browserLocalPersistence });
  db = getFirestore(app);
  if (env.VITE_USE_EMULATORS === 'true') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

// Correo interno de Firebase Auth para un número de empleado. El usuario nunca lo ve.
export const emailFor = (employee) => `empleado${employee}@${EMAIL_DOMAIN}`;

// Firebase Auth exige mínimo 6 caracteres. El prefijo permite contraseñas demo
// de 1 carácter. NO es una medida de seguridad: en producción se exigen
// contraseñas largas (lo valida el script de alta). Debe coincidir con el script.
export const authPassword = (password) => `flota:${password}`;
