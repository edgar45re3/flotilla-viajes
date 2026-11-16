#!/usr/bin/env node
// Administración de cuentas y datos. Se ejecuta SOLO en la computadora del administrador.
// Usa una llave de cuenta de servicio (archivo JSON SECRETO, ignorado por git).
//
//   npm run usuarios -- init                       (crea la configuración inicial)
//   npm run usuarios -- bootstrap                  (crea las 6 cuentas de la flotilla)
//   npm run usuarios -- create --employee 104 --name "Nuevo" --role operator
//   npm run usuarios -- reset-password --employee 100
//   npm run usuarios -- deactivate --employee 103
//   npm run usuarios -- activate --employee 103
//   npm run usuarios -- seed-demo      (SOLO proyectos de prueba: cuentas demo 100/1, 101/2, 102/3)
//   npm run usuarios -- reset-demo     (reinicia solo datos de cuentas demo)
//   npm run usuarios -- remove-demo    (borra cuentas demo y sus registros)
//
// Las cuentas reales reciben una contraseña TEMPORAL aleatoria que se muestra una sola vez
// en pantalla. Al primer inicio de sesión, la app obliga a cambiarla.
// Con FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST definidos, trabaja contra los emuladores.

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomInt } from 'node:crypto';

try { process.loadEnvFile('.env.scripts'); } catch { /* opcional */ }

const EMAIL_DOMAIN = process.env.EMPLOYEE_EMAIL_DOMAIN || 'flotilla.example.com';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const USING_EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;

// Cuentas de la flotilla. Edita nombres aquí si hace falta antes de ejecutar "bootstrap".
const FLEET_ACCOUNTS = [
  { employee: '100', name: 'Ángel', role: 'operator' },
  { employee: '101', name: 'Jonah', role: 'operator' },
  { employee: '102', name: 'Johnny', role: 'operator' },
  { employee: '103', name: 'Sergio', role: 'operator' },
  { employee: '900', name: 'Daniel', role: 'admin' },
  { employee: '901', name: 'Édgar', role: 'admin' },
];

const DEMO_USERS = [
  { employee: '100', name: 'Ángel', password: '1' },
  { employee: '101', name: 'Jonah', password: '2' },
  { employee: '102', name: 'Johnny', password: '3' },
];

function fail(msg) {
  console.error(`\nError: ${msg}`);
  process.exit(1);
}

if (!PROJECT_ID) fail('Falta FIREBASE_PROJECT_ID en .env.scripts');
if (!USING_EMULATOR && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  fail('Falta GOOGLE_APPLICATION_CREDENTIALS (ruta a la llave JSON de la cuenta de servicio) en .env.scripts');
}

initializeApp(USING_EMULATOR ? { projectId: PROJECT_ID } : { credential: applicationDefault(), projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

// Deben coincidir con src/firebase.js
const emailFor = (employee) => `empleado${employee}@${EMAIL_DOMAIN}`;
const authPassword = (password) => `flota:${password}`;

// Contraseña temporal legible, sin caracteres confusos (0/O, 1/I/l). Ej.: K7PM-4QXR
function tempPassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = () => alphabet[randomInt(alphabet.length)];
  const block = () => Array.from({ length: 4 }, pick).join('');
  return `${block()}-${block()}`;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(argv[i]);
  }
  return out;
}

function validEmployee(n) {
  if (!/^[0-9]{1,10}$/.test(String(n ?? ''))) fail('--employee debe ser un número de 1 a 10 dígitos');
  return String(n);
}

async function findProfile(employee) {
  const snap = await db.collection('users').where('employeeNumber', '==', employee).limit(1).get();
  return snap.empty ? null : { uid: snap.docs[0].id, ...snap.docs[0].data() };
}

async function getSettings() {
  const [time, fuel] = await Promise.all([db.doc('settings/time').get(), db.doc('settings/fuel').get()]);
  if (!time.exists || !fuel.exists) fail('Falta la configuración inicial. Ejecuta primero: npm run usuarios -- init');
  return { time: time.data(), fuel: fuel.data() };
}

const todayFor = (offsetMinutes) => new Date(Date.now() + offsetMinutes * 60000).toISOString().slice(0, 10);
const addDays = (iso, d) => {
  const [y, m, dd] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + d)).toISOString().slice(0, 10);
};

function printCredentials(rows) {
  console.log('\n================  CONTRASEÑAS TEMPORALES  ================');
  console.log('Cópialas AHORA. No se guardan en ningún lado y no se vuelven a mostrar.');
  console.log('Cada persona debe cambiarla al entrar por primera vez.\n');
  for (const r of rows) {
    console.log(`  ${r.employee.padEnd(6)} ${r.name.padEnd(10)} ${r.role === 'admin' ? 'admin   ' : 'operador'}  ${r.password}`);
  }
  console.log('==========================================================\n');
}

async function init() {
  const batch = db.batch();
  const time = await db.doc('settings/time').get();
  const fuel = await db.doc('settings/fuel').get();
  if (!time.exists) batch.set(db.doc('settings/time'), { utcOffsetMinutes: -360, label: 'America/Mexico_City' });
  if (!fuel.exists) batch.set(db.doc('settings/fuel'), { defaultInitialLiters: 200, defaultLitersPerTrip: 20 });
  await batch.commit();
  console.log('Configuración inicial lista (America/Mexico_City UTC-6, 200 L, 20 L por viaje).');
}

async function createAccount({ employee, name, role, password, isDemo, mustChange }) {
  const { fuel } = await getSettings();
  if (await findProfile(employee)) fail(`El empleado ${employee} ya existe.`);

  const user = await auth.createUser({
    email: emailFor(employee),
    password: authPassword(password),
    emailVerified: true,
    displayName: name,
  }).catch((e) => fail(`No se pudo crear el usuario ${employee}: ${e.message}`));

  try {
    const batch = db.batch();
    batch.set(db.doc(`users/${user.uid}`), {
      employeeNumber: employee, fullName: name, role, active: true, isDemo: !!isDemo,
      mustChangePassword: !!mustChange,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (role === 'operator') {
      batch.set(db.doc(`fuelSettings/${user.uid}`), {
        initialLiters: fuel.defaultInitialLiters,
        litersPerTrip: fuel.defaultLitersPerTrip,
      });
    }
    await batch.commit();
  } catch (e) {
    await auth.deleteUser(user.uid);
    fail(`No se pudo crear el perfil (se revirtió el usuario): ${e.message}`);
  }
}

async function resetPassword(employee) {
  const profile = await findProfile(employee);
  if (!profile) fail(`No existe el empleado ${employee}`);
  if (profile.isDemo) fail('Es una cuenta DEMO. Elimínala con remove-demo.');
  const password = tempPassword();
  await auth.updateUser(profile.uid, { password: authPassword(password) });
  await db.doc(`users/${profile.uid}`).update({ mustChangePassword: true });
  await auth.revokeRefreshTokens(profile.uid);
  printCredentials([{ employee, name: profile.fullName, role: profile.role, password }]);
  console.log('Sus sesiones abiertas se cerrarán en máximo 1 hora.');
}

async function setActive(employee, active) {
  const profile = await findProfile(employee);
  if (!profile) fail(`No existe el empleado ${employee}`);
  await db.doc(`users/${profile.uid}`).update({ active });
  await auth.updateUser(profile.uid, { disabled: !active });
  if (!active) await auth.revokeRefreshTokens(profile.uid);
  console.log(`Empleado ${employee} ${active ? 'activado' : 'desactivado'}.`);
}

async function demoProfiles() {
  const snap = await db.collection('users').where('isDemo', '==', true).get();
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

// Borra SOLO registros de cuentas con isDemo = true. Opcionalmente genera historial.
async function resetDemo(withHistory) {
  const { time, fuel } = await getSettings();
  const today = todayFor(time.utcOffsetMinutes);
  const demos = await demoProfiles();

  for (const p of demos) {
    const trips = await db.collection('dailyTrips').where('userId', '==', p.uid).get();
    const batch = db.batch();
    trips.docs.forEach((d) => batch.delete(d.ref));

    if (withHistory && p.role === 'operator' && p.active) {
      for (let i = 1; i <= 5; i++) {
        const workDate = addDays(today, -i);
        batch.set(db.doc(`dailyTrips/${p.uid}_${workDate}`), {
          userId: p.uid,
          workDate,
          trips: (i + Number(p.employeeNumber)) % 4,
          createdAt: new Date(`${workDate}T18:00:00Z`),
        });
      }
      const logRef = db.collection('auditLog').doc();
      batch.set(db.doc(`fuelSettings/${p.uid}`), {
        initialLiters: fuel.defaultInitialLiters,
        litersPerTrip: fuel.defaultLitersPerTrip,
        updatedBy: null,
        updatedAt: FieldValue.serverTimestamp(),
        auditId: logRef.id,
      });
      batch.set(logRef, {
        collection: 'fuelSettings', docId: p.uid, before: {}, changedBy: null,
        after: { initialLiters: fuel.defaultInitialLiters, litersPerTrip: fuel.defaultLitersPerTrip },
        changedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  return demos;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

if (USING_EMULATOR) console.log('(Usando emuladores locales)');

switch (cmd) {
  case 'init':
    await init();
    break;

  case 'bootstrap': {
    await getSettings();
    if ((await demoProfiles()).length) {
      fail('Hay cuentas DEMO (100, 101, 102 con contraseñas 1, 2, 3). Bórralas primero: npm run usuarios -- remove-demo');
    }
    const created = [];
    for (const a of FLEET_ACCOUNTS) {
      if (await findProfile(a.employee)) { console.log(`Ya existe ${a.employee} (${a.name}), se omite.`); continue; }
      const password = tempPassword();
      await createAccount({ ...a, password, isDemo: false, mustChange: true });
      created.push({ ...a, password });
      console.log(`Creado: ${a.name} (empleado ${a.employee}, ${a.role === 'admin' ? 'administrador' : 'operador'})`);
    }
    if (created.length) printCredentials(created);
    else console.log('No se creó ninguna cuenta nueva.');
    break;
  }

  case 'create': {
    const employee = validEmployee(args.employee);
    const name = String(args.name ?? '').trim();
    const role = args.role;
    if (!name || name.length > 100) fail('Falta --name (máximo 100 caracteres)');
    if (!['operator', 'admin'].includes(role)) fail('--role debe ser operator o admin');
    const password = tempPassword();
    await createAccount({ employee, name, role, password, isDemo: false, mustChange: true });
    console.log(`Creado: ${name} (empleado ${employee}, ${role === 'admin' ? 'administrador' : 'operador'})`);
    printCredentials([{ employee, name, role, password }]);
    break;
  }

  case 'reset-password':
    await resetPassword(validEmployee(args.employee));
    break;

  case 'deactivate':
  case 'activate':
    await setActive(validEmployee(args.employee), cmd === 'activate');
    break;

  case 'seed-demo': {
    console.warn('AVISO: las cuentas demo usan contraseñas triviales (1, 2, 3) y los números 100-102.');
    console.warn('Úsalas SOLO en un proyecto de pruebas o en los emuladores, nunca junto a las cuentas reales.\n');
    for (const u of DEMO_USERS) {
      if (await findProfile(u.employee)) { console.log(`Ya existe ${u.employee}, se omite.`); continue; }
      await createAccount({ employee: u.employee, name: u.name, role: 'operator', password: u.password, isDemo: true, mustChange: false });
      console.log(`Creado DEMO: ${u.name} (empleado ${u.employee})`);
    }
    await resetDemo(true);
    console.log('Historial demo generado (5 días previos; hoy queda libre para registrar).');
    break;
  }

  case 'reset-demo':
    await resetDemo(true);
    console.log('Datos demo reiniciados. Las cuentas reales no se tocaron.');
    break;

  case 'remove-demo': {
    const demos = await resetDemo(false);
    for (const p of demos) {
      const batch = db.batch();
      batch.delete(db.doc(`fuelSettings/${p.uid}`));
      batch.delete(db.doc(`users/${p.uid}`));
      await batch.commit();
      await auth.deleteUser(p.uid).catch(() => {});
      console.log(`Eliminada cuenta demo ${p.employeeNumber}`);
    }
    if (!demos.length) console.log('No hay cuentas demo.');
    break;
  }

  default:
    console.log('Comandos: init | bootstrap | create | reset-password | activate | deactivate | seed-demo | reset-demo | remove-demo');
    console.log('Ejemplo: npm run usuarios -- create --employee 104 --name "Nuevo" --role operator');
    process.exit(cmd ? 1 : 0);
}
process.exit(0);
