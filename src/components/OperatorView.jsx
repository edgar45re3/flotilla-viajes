import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { errorMessage, formatDateTime, formatWorkDate, todayFor } from '../format.js';

// El operador solo ve su registro de hoy. No hay datos de combustible aquí
// (y las reglas tampoco se los entregarían: solo el administrador los lee).
export default function OperatorView({ uid }) {
  const [offset, setOffset] = useState(null);
  const [record, setRecord] = useState(undefined); // undefined = cargando, null = sin registro
  const [value, setValue] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  const workDate = offset === null ? null : todayFor(offset);
  const ref = workDate ? doc(db, 'dailyTrips', `${uid}_${workDate}`) : null;

  const load = useCallback(async () => {
    try {
      const time = await getDoc(doc(db, 'settings', 'time'));
      const off = time.data()?.utcOffsetMinutes ?? -360;
      setOffset(off);
      const snap = await getDoc(doc(db, 'dailyTrips', `${uid}_${todayFor(off)}`));
      setRecord(snap.exists() ? snap.data() : null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const review = (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d+$/.test(value.trim()) || Number(value) > 100) {
      setError('Escribe un número entero entre 0 y 100.');
      return;
    }
    setConfirming(true);
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      // Las reglas verifican que el ID y la fecha sean los de HOY según la hora
      // del servidor, que el usuario sea quien inicia sesión y que no exista ya.
      await setDoc(ref, {
        userId: uid,
        workDate,
        trips: Number(value),
        createdAt: serverTimestamp(),
      });
      setJustSaved(true);
    } catch (err) {
      if (err.code === 'permission-denied') {
        const snap = await getDoc(ref).catch(() => null);
        setError(snap?.exists()
          ? 'Ya existe un registro para hoy.'
          : 'No se pudo guardar. Revisa que la fecha y hora de tu teléfono sean correctas.');
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirming(false);
      await load();
    }
  };

  if (record === undefined) return error ? <p className="alert error">{error}</p> : <p className="muted">Cargando…</p>;

  return (
    <section className="card">
      <h2>Viajes de hoy</h2>
      <p className="muted">{formatWorkDate(workDate)}</p>

      {record ? (
        <>
          {justSaved && <p className="alert ok">Registro guardado correctamente.</p>}
          <p className="big">{record.trips} {record.trips === 1 ? 'viaje' : 'viajes'}</p>
          <p className="muted">
            Registrado el {formatDateTime(record.createdAt, offset)}. Ya no se puede registrar otra vez hoy.
          </p>
        </>
      ) : confirming ? (
        <div>
          <p>¿Confirmas <strong>{Number(value)}</strong> {Number(value) === 1 ? 'viaje' : 'viajes'} para hoy?</p>
          <p className="muted">Después de guardar no podrás cambiarlo.</p>
          <div className="row">
            <button onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Sí, guardar'}</button>
            <button className="secondary" onClick={() => setConfirming(false)} disabled={busy}>Corregir</button>
          </div>
        </div>
      ) : (
        <form onSubmit={review}>
          <label htmlFor="trips">¿Cuántos viajes hiciste hoy?</label>
          <input
            id="trips"
            type="number"
            inputMode="numeric"
            min="0"
            max="100"
            step="1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
          <p className="muted small">Si no hiciste viajes, registra 0 para que quede constancia.</p>
          <button type="submit">Continuar</button>
        </form>
      )}
      {error && <p className="alert error" role="alert">{error}</p>}
    </section>
  );
}
