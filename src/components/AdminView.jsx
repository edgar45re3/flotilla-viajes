import { useCallback, useEffect, useState } from 'react';
import {
  collection, count, doc, getAggregateFromServer, getDoc, getDocs, limit, orderBy, query,
  serverTimestamp, sum, where, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { addDays, errorMessage, formatDateTime, liters, offsetLabel, shortDate, todayFor } from '../format.js';

const PAGE_LIMIT = 1000;
const META = ['updatedBy', 'updatedAt', 'auditId'];

const stripMeta = (data) => Object.fromEntries(Object.entries(data).filter(([k]) => !META.includes(k)));

// Todas las lecturas de esta vista las autorizan las reglas con isAdmin(),
// que consulta /users/{uid} en cada petición. Un operador recibe "permission-denied".
export default function AdminView({ uid }) {
  const [tab, setTab] = useState('summary');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [timeSnap, fuelDefSnap, usersSnap, fuelSnap] = await Promise.all([
        getDoc(doc(db, 'settings', 'time')),
        getDoc(doc(db, 'settings', 'fuel')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'fuelSettings')),
      ]);
      const time = timeSnap.data() ?? { utcOffsetMinutes: -360, label: 'America/Mexico_City' };
      const today = todayFor(time.utcOffsetMinutes);
      const users = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      const fuel = Object.fromEntries(fuelSnap.docs.map((d) => [d.id, d.data()]));
      const operators = users
        .filter((u) => u.role === 'operator')
        .sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber, 'es', { numeric: true }));

      const summary = await Promise.all(operators.map(async (op) => {
        const [agg, todaySnap] = await Promise.all([
          getAggregateFromServer(
            query(collection(db, 'dailyTrips'), where('userId', '==', op.uid)),
            { total: sum('trips') },
          ),
          getDoc(doc(db, 'dailyTrips', `${op.uid}_${today}`)),
        ]);
        const f = fuel[op.uid] ?? { initialLiters: 0, litersPerTrip: 0 };
        const total = agg.data().total ?? 0;
        return {
          ...op,
          total,
          todayTrips: todaySnap.exists() ? todaySnap.data().trips : null,
          initialLiters: f.initialLiters,
          litersPerTrip: f.litersPerTrip,
          estimated: f.initialLiters - total * f.litersPerTrip,
        };
      }));

      setData({
        time, today, users, operators, summary,
        fuel, fuelDefaults: fuelDefSnap.data(),
        names: Object.fromEntries(users.map((u) => [u.uid, `${u.fullName} (${u.employeeNumber})`])),
      });
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error && !data) return <p className="alert error">{error}</p>;
  if (!data) return <p className="muted">Cargando…</p>;

  return (
    <>
      <nav className="tabs">
        {[['summary', 'Resumen'], ['records', 'Registros'], ['config', 'Configuración']].map(([k, label]) => (
          <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>{label}</button>
        ))}
      </nav>
      <p className="alert info">
        El diésel mostrado es una <strong>estimación</strong>: asignación inicial − (viajes acumulados ×
        litros por viaje). No refleja cargas ni consumo real medido.
      </p>
      {error && <p className="alert error">{error}</p>}
      {tab === 'summary' && <Summary data={data} reload={load} />}
      {tab === 'records' && <Records data={data} />}
      {tab === 'config' && <Config data={data} uid={uid} reload={load} />}
    </>
  );
}

function Summary({ data, reload }) {
  const { summary, today, time } = data;
  return (
    <section className="card">
      <div className="row between">
        <h2>Resumen por operador</h2>
        <button className="secondary" onClick={reload}>Actualizar</button>
      </div>
      <p className="muted small">Hoy: {shortDate(today)} ({time.label}, {offsetLabel(time.utcOffsetMinutes)})</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Operador</th><th>Empleado</th><th className="num">Viajes totales</th>
              <th className="num">Viajes hoy</th><th className="num">Diésel estimado restante</th>
              <th>Cálculo</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((r) => (
              <tr key={r.uid} className={r.active ? '' : 'inactive'}>
                <td>{r.fullName}{!r.active && ' (inactivo)'}</td>
                <td>{r.employeeNumber}</td>
                <td className="num">{r.total}</td>
                <td className="num">{r.todayTrips ?? <span className="muted">sin registro</span>}</td>
                <td className="num">
                  {liters(r.estimated)}
                  {r.estimated < 0 && <span className="badge warn">Estimación por revisar</span>}
                </td>
                <td className="small muted">
                  {liters(r.initialLiters)} − {r.total} × {liters(r.litersPerTrip)}
                </td>
              </tr>
            ))}
            {!summary.length && <tr><td colSpan="6" className="muted">No hay operadores.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Records({ data }) {
  const { operators, today, time, names } = data;
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [n, setN] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!from || !to || from > to) { setError('Revisa el periodo: la fecha inicial debe ser anterior a la final.'); return; }
    setBusy(true);
    setError('');
    try {
      const filters = [where('workDate', '>=', from), where('workDate', '<=', to)];
      if (userId) filters.unshift(where('userId', '==', userId));
      const base = query(collection(db, 'dailyTrips'), ...filters);
      const [snap, agg] = await Promise.all([
        getDocs(query(base, orderBy('workDate', 'desc'), limit(PAGE_LIMIT))),
        getAggregateFromServer(base, { total: sum('trips'), n: count() }),
      ]);
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setTotal(agg.data().total ?? 0);
      setN(agg.data().n);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [from, to, userId]);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="card">
      <h2>Registros diarios</h2>
      <div className="filters">
        <label>Operador
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Todos</option>
            {operators.map((o) => <option key={o.uid} value={o.uid}>{o.fullName} ({o.employeeNumber})</option>)}
          </select>
        </label>
        <label>Desde <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Hasta <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {error && <p className="alert error">{error}</p>}
      <p className="total">Total de viajes del periodo: <strong>{total}</strong> <span className="muted small">({n} registros)</span></p>
      {n > rows.length && (
        <p className="alert info small">Se muestran los {rows.length} registros más recientes; el total sí incluye todo el periodo.</p>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Operador</th><th className="num">Viajes</th><th>Capturado</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{shortDate(r.workDate)}</td>
                <td>{names[r.userId] ?? r.userId}</td>
                <td className="num">{r.trips}</td>
                <td className="small muted">{formatDateTime(r.createdAt, time.utcOffsetMinutes)}</td>
              </tr>
            ))}
            {!rows.length && !busy && <tr><td colSpan="4" className="muted">Sin registros en el periodo.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Guarda un cambio de configuración y su entrada de bitácora en el mismo batch.
// Las reglas rechazan el cambio si falta la bitácora o si no coincide con lo guardado.
async function saveAudited(uid, collectionName, docId, current, changes) {
  const before = stripMeta(current);
  const after = { ...before, ...changes };
  const target = doc(db, collectionName, docId);
  const logRef = doc(collection(db, 'auditLog'));
  const batch = writeBatch(db);
  batch.update(target, { ...changes, updatedBy: uid, updatedAt: serverTimestamp(), auditId: logRef.id });
  batch.set(logRef, {
    collection: collectionName, docId, before, after, changedBy: uid, changedAt: serverTimestamp(),
  });
  await batch.commit();
}

function Config({ data, uid, reload }) {
  const { time, fuelDefaults, fuel, operators, names } = data;
  const [log, setLog] = useState([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const loadLog = useCallback(async () => {
    try {
      const snap = await getDocs(query(collection(db, 'auditLog'), orderBy('changedAt', 'desc'), limit(50)));
      setLog(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => { loadLog(); }, [loadLog]);

  const run = async (fn, okText) => {
    setMsg('');
    setError('');
    try {
      await fn();
      setMsg(okText);
      await Promise.all([reload(), loadLog()]);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const num = (fd, key) => {
    const v = Number(fd.get(key));
    if (!Number.isFinite(v) || v < 0) throw new Error('Los litros deben ser números mayores o iguales a 0.');
    return v;
  };

  const saveTime = (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveAudited(uid, 'settings', 'time', time, {
      utcOffsetMinutes: Math.round(Number(fd.get('offsetHours')) * 60),
      label: String(fd.get('label')).trim().slice(0, 60),
    }), 'Zona horaria guardada.');
  };

  const saveDefaults = (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveAudited(uid, 'settings', 'fuel', fuelDefaults, {
      defaultInitialLiters: num(fd, 'initial'),
      defaultLitersPerTrip: num(fd, 'perTrip'),
    }), 'Valores por defecto guardados.');
  };

  const saveFuel = (e, opUid) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() => saveAudited(uid, 'fuelSettings', opUid, fuel[opUid], {
      initialLiters: num(fd, 'initial'),
      litersPerTrip: num(fd, 'perTrip'),
    }), 'Parámetros de combustible guardados.');
  };

  const offsets = [];
  for (let h = -12; h <= 14; h += 0.5) offsets.push(h);

  return (
    <>
      {msg && <p className="alert ok">{msg}</p>}
      {error && <p className="alert error">{error}</p>}

      <section className="card">
        <h2>Zona horaria de operación</h2>
        <form className="filters" onSubmit={saveTime} key={`t-${time.auditId}`}>
          <label>Nombre de la zona
            <input name="label" defaultValue={time.label} maxLength="60" required />
          </label>
          <label>Desfase respecto a UTC
            <select name="offsetHours" defaultValue={time.utcOffsetMinutes / 60}>
              {offsets.map((h) => <option key={h} value={h}>{offsetLabel(h * 60)}</option>)}
            </select>
          </label>
          <button type="submit">Guardar</button>
        </form>
        <p className="muted small">
          Define qué fecha es “hoy” para todos. America/Mexico_City es UTC−06:00 todo el año.
          Si la flotilla opera en una zona con horario de verano, cambia el desfase en cada cambio de horario.
        </p>
      </section>

      <section className="card">
        <h2>Combustible por defecto (operadores nuevos)</h2>
        <form className="filters" onSubmit={saveDefaults} key={`f-${fuelDefaults?.auditId}`}>
          <label>Asignación inicial (L)
            <input name="initial" type="number" min="0" step="0.01" defaultValue={fuelDefaults?.defaultInitialLiters} required />
          </label>
          <label>Litros por viaje
            <input name="perTrip" type="number" min="0" step="0.01" defaultValue={fuelDefaults?.defaultLitersPerTrip} required />
          </label>
          <button type="submit">Guardar</button>
        </form>
      </section>

      <section className="card">
        <h2>Combustible por operador</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Operador</th><th>Asignación inicial (L)</th><th>Litros por viaje</th><th></th></tr></thead>
            <tbody>
              {operators.map((o) => {
                const f = fuel[o.uid];
                if (!f) return null;
                const formId = `fuel-${o.uid}`;
                return (
                  <tr key={`${o.uid}-${f.auditId}`}>
                    <td>{o.fullName}</td>
                    <td><input form={formId} name="initial" type="number" min="0" step="0.01" defaultValue={f.initialLiters} required /></td>
                    <td><input form={formId} name="perTrip" type="number" min="0" step="0.01" defaultValue={f.litersPerTrip} required /></td>
                    <td><form id={formId} onSubmit={(e) => saveFuel(e, o.uid)}><button type="submit">Guardar</button></form></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Bitácora de cambios</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th><th>Antes</th><th>Después</th></tr></thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td className="small">{formatDateTime(l.changedAt, time.utcOffsetMinutes)}</td>
                  <td>{l.changedBy ? names[l.changedBy] ?? l.changedBy : 'Sistema'}</td>
                  <td>{l.collection === 'fuelSettings' ? `Combustible: ${names[l.docId] ?? l.docId}` : `Configuración: ${l.docId}`}</td>
                  <td className="small mono">{describe(l.before)}</td>
                  <td className="small mono">{describe(l.after)}</td>
                </tr>
              ))}
              {!log.length && <tr><td colSpan="5" className="muted">Sin cambios registrados.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const LABELS = {
  label: 'zona', utcOffsetMinutes: 'desfase (min)',
  initialLiters: 'inicial', litersPerTrip: 'L/viaje',
  defaultInitialLiters: 'inicial def.', defaultLitersPerTrip: 'L/viaje def.',
};

function describe(values) {
  if (!values) return '';
  return Object.entries(values)
    .filter(([k]) => LABELS[k])
    .map(([k, v]) => `${LABELS[k]}: ${v}`)
    .join(', ');
}

