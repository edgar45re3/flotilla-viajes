import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Bloquea el build si alguien pone por error una credencial de servidor en una variable VITE_*.
// Todo lo que empieza con VITE_ termina dentro del JavaScript público.
function assertNoSecrets(env) {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_') || !value) continue;
    if (/PRIVATE KEY|private_key|service_account|client_email/i.test(value)) {
      throw new Error(`${name} parece contener una credencial de cuenta de servicio. No la pongas en el frontend.`);
    }
  }
}

export default defineConfig(({ mode }) => {
  assertNoSecrets(loadEnv(mode, process.cwd(), 'VITE_'));
  return { plugins: [react()] };
});
