// Pruebas de seguridad de firestore.rules con el emulador de Firestore.
// Ejecuta: npm run test:rules   (requiere Java 21+ instalado)
import { after, before, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, doc, getAggregateFromServer, getDoc, getDocs, query, serverTimestamp,
  setDoc, deleteDoc, sum, updateDoc, where, writeBatch, Timestamp,
} from 'firebase/firestore';

const OFFSET = -360;
const today = () => new Date(Date.now() + OFFSET * 60000).toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() + OFFSET * 60000 - 86400000).toISOString().slice(0, 10);

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-flotilla',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'settings/time'), { utcOffsetMinutes: OFFSET, label: 'America/Mexico_City' });
    await setDoc(doc(db, 'settings/fuel'), { defaultInitialLiters: 200, defaultLitersPerTrip: 20 });
    await setDoc(doc(db, 'users/admin'), { employeeNumber: '900', fullName: 'Daniel', role: 'admin', active: true, isDemo: false });
    await setDoc(doc(db, 'users/op1'), { employeeNumber: '100', fullName: 'Ángel', role: 'operator', active: true, isDemo: true });
    await setDoc(doc(db, 'users/op2'), { employeeNumber: '101', fullName: 'Jonah', role: 'operator', active: true, isDemo: true });
    await setDoc(doc(db, 'users/off'), { employeeNumber: '103', fullName: 'Inactivo', role: 'operator', active: false, isDemo: false });
    await setDoc(doc(db, 'users/nuevo'), { employeeNumber: '104', fullName: 'Nuevo', role: 'operator', active: true, isDemo: false, mustChangePassword: true });
    await setDoc(doc(db, 'users/admin2'), { employeeNumber: '901', fullName: 'Édgar', role: 'admin', active: true, isDemo: false, mustChangePassword: true });
    await setDoc(doc(db, 'fuelSettings/op1'), { initialLiters: 200, litersPerTrip: 20 });
    await setDoc(doc(db, 'dailyTrips/op2_2026-01-01'), { userId: 'op2', workDate: '2026-01-01', trips: 4, createdAt: Timestamp.now() });
  });
});

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const trip = (uid, workDate, trips = 3) => ({ userId: uid, workDate, trips, createdAt: serverTimestamp() });

// ---------- Registro diario ----------

test('operador registra hoy', async () => {
  await assertSucceeds(setDoc(doc(as('op1'), `dailyTrips/op1_${today()}`), trip('op1', today())));
});

test('cero viajes es válido', async () => {
  await assertSucceeds(setDoc(doc(as('op1'), `dailyTrips/op1_${today()}`), trip('op1', today(), 0)));
});

test('no puede registrar dos veces el mismo día', async () => {
  const db = as('op1');
  await assertSucceeds(setDoc(doc(db, `dailyTrips/op1_${today()}`), trip('op1', today())));
  await assertFails(setDoc(doc(db, `dailyTrips/op1_${today()}`), trip('op1', today(), 5)));
  await assertFails(updateDoc(doc(db, `dailyTrips/op1_${today()}`), { trips: 5 }));
  await assertFails(deleteDoc(doc(db, `dailyTrips/op1_${today()}`)));
});

test('no puede registrar una fecha pasada', async () => {
  await assertFails(setDoc(doc(as('op1'), `dailyTrips/op1_${yesterday()}`), trip('op1', yesterday())));
});

test('no puede mezclar ID de hoy con otra fecha en el cuerpo', async () => {
  await assertFails(setDoc(doc(as('op1'), `dailyTrips/op1_${today()}`), trip('op1', yesterday())));
});

test('no puede falsificar createdAt', async () => {
  await assertFails(setDoc(doc(as('op1'), `dailyTrips/op1_${today()}`), {
    userId: 'op1', workDate: today(), trips: 1, createdAt: Timestamp.fromDate(new Date('2020-01-01')),
  }));
});

test('no puede registrar por otro operador', async () => {
  await assertFails(setDoc(doc(as('op1'), `dailyTrips/op2_${today()}`), trip('op2', today())));
  await assertFails(setDoc(doc(as('op1'), `dailyTrips/op2_${today()}`), trip('op1', today())));
});

test('viajes inválidos rechazados', async () => {
  const db = as('op1');
  const ref = doc(db, `dailyTrips/op1_${today()}`);
  await assertFails(setDoc(ref, trip('op1', today(), -1)));
  await assertFails(setDoc(ref, trip('op1', today(), 2.5)));
  await assertFails(setDoc(ref, trip('op1', today(), 101)));
  await assertFails(setDoc(ref, { ...trip('op1', today()), liters: 0 }));
});

test('admin e inactivos no registran viajes', async () => {
  await assertFails(setDoc(doc(as('admin'), `dailyTrips/admin_${today()}`), trip('admin', today())));
  await assertFails(setDoc(doc(as('off'), `dailyTrips/off_${today()}`), trip('off', today())));
});

test('usuario sin perfil y anónimo no hacen nada', async () => {
  await assertFails(setDoc(doc(as('nadie'), `dailyTrips/nadie_${today()}`), trip('nadie', today())));
  await assertFails(getDoc(doc(anon(), 'settings/time')));
  await assertFails(getDocs(collection(anon(), 'dailyTrips')));
});

// ---------- Lecturas del operador ----------

test('operador lee su registro (aunque no exista) pero no el de otros', async () => {
  const db = as('op1');
  await assertSucceeds(getDoc(doc(db, `dailyTrips/op1_${today()}`)));
  await assertFails(getDoc(doc(db, 'dailyTrips/op2_2026-01-01')));
  await assertFails(getDocs(collection(db, 'dailyTrips')));
  await assertSucceeds(getDocs(query(collection(db, 'dailyTrips'), where('userId', '==', 'op1'))));
});

test('operador no ve combustible, configuración de litros ni bitácora', async () => {
  const db = as('op1');
  await assertFails(getDoc(doc(db, 'fuelSettings/op1')));
  await assertFails(getDoc(doc(db, 'settings/fuel')));
  await assertFails(getDocs(collection(db, 'auditLog')));
  await assertSucceeds(getDoc(doc(db, 'settings/time')));
});

test('operador ve solo su perfil y no puede cambiar su rol', async () => {
  const db = as('op1');
  await assertSucceeds(getDoc(doc(db, 'users/op1')));
  await assertFails(getDoc(doc(db, 'users/op2')));
  await assertFails(getDocs(collection(db, 'users')));
  await assertFails(updateDoc(doc(db, 'users/op1'), { role: 'admin' }));
  await assertFails(setDoc(doc(db, 'users/op1'), { employeeNumber: '100', fullName: 'x', role: 'admin', active: true }));
});

test('operador no puede escribir combustible ni bitácora', async () => {
  const db = as('op1');
  const log = doc(collection(db, 'auditLog'));
  const batch = writeBatch(db);
  batch.update(doc(db, 'fuelSettings/op1'), { initialLiters: 9999, updatedBy: 'op1', updatedAt: serverTimestamp(), auditId: log.id });
  batch.set(log, { collection: 'fuelSettings', docId: 'op1', before: { initialLiters: 200, litersPerTrip: 20 },
    after: { initialLiters: 9999, litersPerTrip: 20 }, changedBy: 'op1', changedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

// ---------- Administrador ----------

test('admin lee todo y agrega totales', async () => {
  const db = as('admin');
  await assertSucceeds(getDocs(collection(db, 'users')));
  await assertSucceeds(getDocs(collection(db, 'dailyTrips')));
  await assertSucceeds(getDocs(collection(db, 'fuelSettings')));
  await assertSucceeds(getDoc(doc(db, 'settings/fuel')));
  const agg = await assertSucceeds(getAggregateFromServer(collection(db, 'dailyTrips'), { t: sum('trips') }));
  if (agg.data().t !== 4) throw new Error(`total esperado 4, recibido ${agg.data().t}`);
});

test('admin no puede editar ni borrar registros diarios', async () => {
  const db = as('admin');
  await assertFails(updateDoc(doc(db, 'dailyTrips/op2_2026-01-01'), { trips: 9 }));
  await assertFails(deleteDoc(doc(db, 'dailyTrips/op2_2026-01-01')));
  await assertFails(setDoc(doc(db, `dailyTrips/op2_${yesterday()}`), trip('op2', yesterday())));
});

function auditedBatch(db, uid, path, before, changes) {
  const [col, id] = path.split('/');
  const log = doc(collection(db, 'auditLog'));
  const batch = writeBatch(db);
  batch.update(doc(db, path), { ...changes, updatedBy: uid, updatedAt: serverTimestamp(), auditId: log.id });
  batch.set(log, { collection: col, docId: id, before, after: { ...before, ...changes }, changedBy: uid, changedAt: serverTimestamp() });
  return batch;
}

test('admin cambia combustible con bitácora', async () => {
  const db = as('admin');
  await assertSucceeds(auditedBatch(db, 'admin', 'fuelSettings/op1',
    { initialLiters: 200, litersPerTrip: 20 }, { initialLiters: 250 }).commit());
  await assertSucceeds(auditedBatch(db, 'admin', 'settings/time',
    { utcOffsetMinutes: OFFSET, label: 'America/Mexico_City' }, { utcOffsetMinutes: -300, label: 'America/Cancun' }).commit());
});

test('admin no puede cambiar configuración sin bitácora', async () => {
  const db = as('admin');
  await assertFails(updateDoc(doc(db, 'fuelSettings/op1'), {
    initialLiters: 250, updatedBy: 'admin', updatedAt: serverTimestamp(), auditId: 'x',
  }));
});

test('la bitácora debe coincidir con el cambio real', async () => {
  const db = as('admin');
  const log = doc(collection(db, 'auditLog'));
  const batch = writeBatch(db);
  batch.update(doc(db, 'fuelSettings/op1'), { initialLiters: 250, updatedBy: 'admin', updatedAt: serverTimestamp(), auditId: log.id });
  batch.set(log, { collection: 'fuelSettings', docId: 'op1', before: { initialLiters: 200, litersPerTrip: 20 },
    after: { initialLiters: 999, litersPerTrip: 20 }, changedBy: 'admin', changedAt: serverTimestamp() });
  await assertFails(batch.commit());
});

test('admin no puede firmar como otro ni poner valores inválidos', async () => {
  const db = as('admin');
  const log = doc(collection(db, 'auditLog'));
  const b1 = writeBatch(db);
  b1.update(doc(db, 'fuelSettings/op1'), { initialLiters: 250, updatedBy: 'op1', updatedAt: serverTimestamp(), auditId: log.id });
  b1.set(log, { collection: 'fuelSettings', docId: 'op1', before: { initialLiters: 200, litersPerTrip: 20 },
    after: { initialLiters: 250, litersPerTrip: 20 }, changedBy: 'admin', changedAt: serverTimestamp() });
  await assertFails(b1.commit());
  await assertFails(auditedBatch(db, 'admin', 'fuelSettings/op1',
    { initialLiters: 200, litersPerTrip: 20 }, { litersPerTrip: -5 }).commit());
  await assertFails(auditedBatch(db, 'admin', 'settings/time',
    { utcOffsetMinutes: OFFSET, label: 'America/Mexico_City' }, { utcOffsetMinutes: 5000 }).commit());
});

test('bitácora inmutable', async () => {
  const db = as('admin');
  await auditedBatch(db, 'admin', 'fuelSettings/op1', { initialLiters: 200, litersPerTrip: 20 }, { initialLiters: 250 }).commit();
  const logs = await getDocs(collection(db, 'auditLog'));
  await assertFails(updateDoc(logs.docs[0].ref, { changedBy: 'otro' }));
  await assertFails(deleteDoc(logs.docs[0].ref));
});

test('admin desactivado pierde acceso', async () => {
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'users/admin'), { active: false }));
  await assertFails(getDocs(collection(as('admin'), 'dailyTrips')));
  await assertFails(getDoc(doc(as('admin'), 'fuelSettings/op1')));
});

// ---------- Contraseña temporal (primer inicio) ----------

test('con contraseña temporal no puede registrar ni leer configuración', async () => {
  const db = as('nuevo');
  await assertSucceeds(getDoc(doc(db, 'users/nuevo')));
  await assertFails(setDoc(doc(db, `dailyTrips/nuevo_${today()}`), trip('nuevo', today())));
  await assertFails(getDoc(doc(db, 'settings/time')));
});

test('admin con contraseña temporal no tiene acceso administrativo', async () => {
  const db = as('admin2');
  await assertFails(getDocs(collection(db, 'dailyTrips')));
  await assertFails(getDoc(doc(db, 'fuelSettings/op1')));
});

test('usuario quita su marca tras cambiar contraseña y luego puede registrar', async () => {
  const db = as('nuevo');
  await assertSucceeds(updateDoc(doc(db, 'users/nuevo'), { mustChangePassword: false, passwordChangedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(db, `dailyTrips/nuevo_${today()}`), trip('nuevo', today())));
});

test('al quitar la marca no puede tocar otros campos ni a otros usuarios', async () => {
  const db = as('nuevo');
  await assertFails(updateDoc(doc(db, 'users/nuevo'), { mustChangePassword: false, passwordChangedAt: serverTimestamp(), role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'users/nuevo'), { mustChangePassword: false, passwordChangedAt: Timestamp.fromDate(new Date('2020-01-01')) }));
  await assertFails(updateDoc(doc(as('op1'), 'users/nuevo'), { mustChangePassword: false, passwordChangedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('op1'), 'users/op1'), { mustChangePassword: false, passwordChangedAt: serverTimestamp() }));
});
