# Registro diario de viajes – Flotilla de revolvedoras

Aplicación web para que cada operador registre **una vez al día** cuántos viajes hizo, y para que el
administradores (Daniel y Édgar) consulten registros y estimaciones de diésel.

- Frontend: React + Vite, publicado en **Netlify**.
- Backend: **Firebase** plan gratuito *Spark*: Authentication (correo/contraseña) y Cloud Firestore.
- Seguridad: **reglas de Firestore** (`firestore.rules`). No se usan Cloud Functions (requieren el plan de pago Blaze).

---

## 1. Cómo funciona la seguridad

| Regla | Dónde se aplica |
|---|---|
| Rol y cuenta activa | Las reglas leen `/users/{uid}` en **cada** petición. Nadie puede escribir `/users` desde el navegador |
| Un registro por operador y fecha | El ID del documento es `<uid>_<YYYY-MM-DD>`. Crear uno que ya existe cuenta como "modificar", y eso está prohibido |
| Solo la fecha de hoy | Las reglas calculan "hoy" con la hora del **servidor** (`request.time`) y el desfase configurado. Rechazan cualquier otra fecha en el ID o en el contenido |
| Datos no falsificables | `userId` debe ser el usuario autenticado, `createdAt` debe ser la hora del servidor y solo se aceptan los campos permitidos |
| Registros inmutables | `update` y `delete` prohibidos para todos, incluido el admin |
| Operador solo ve lo suyo | Reglas de `dailyTrips` y `users` |
| Combustible, litros por defecto, bitácora y reportes | Solo `isAdmin()` |
| Bitácora obligatoria | Todo cambio de configuración debe ir en el mismo *batch* que su entrada en `auditLog`. Las reglas verifican quién, cuándo, valores anteriores y nuevos |
| Cambio obligatorio de contraseña temporal | Con `mustChangePassword: true` las reglas niegan registrar y todo acceso de admin. El usuario solo puede quitar esa marca en su propio perfil |
| Sin secretos en el navegador | La configuración web de Firebase es pública por diseño. La llave de cuenta de servicio solo se usa en el script local. El build falla si detecta una llave privada en variables `VITE_*` |

### Inicio de sesión con número de empleado

Firebase Auth trabaja con correo. Cada empleado tiene un correo interno `empleado<N>@<dominio>` que nadie
escribe ni ve. La pantalla pide número de empleado y contraseña. Firebase valida la contraseña en sus
servidores, guarda solo un hash y limita los intentos repetidos (`auth/too-many-requests`).

### Contraseña temporal y primer inicio de sesión

1. El script crea cada cuenta con una **contraseña temporal aleatoria** (por ejemplo `K7PM-4QXR`). La muestra
   una sola vez en pantalla y no la guarda en ningún archivo.
2. La cuenta queda marcada con `mustChangePassword: true`.
3. Al entrar por primera vez, la app muestra **"Crea tu contraseña"**. La persona escribe la temporal y elige
   una nueva de 8 caracteres o más.
4. Mientras no la cambie, las reglas **bloquean todo**: no puede registrar viajes ni ver nada administrativo.
5. Después, cualquiera puede cambiar su contraseña cuando quiera con el botón **"Cambiar contraseña"**.

Firebase exige contraseñas de 6 caracteres o más. La app antepone `flota:` a lo que escribe el usuario, para
que funcionen también las cuentas demo de 1 dígito. **Eso no es una medida de seguridad.**

---

## 2. Estructura

```
├── src/
│   ├── App.jsx                      Sesión, perfil y vista por rol
│   ├── firebase.js                  Inicialización de Firebase
│   ├── format.js                    Fechas y formatos
│   └── components/
│       ├── Login.jsx                Inicio de sesión
│       ├── ChangePassword.jsx       Cambio de contraseña (obligatorio la primera vez)
│       ├── OperatorView.jsx         Registro del día
│       └── AdminView.jsx            Panel de administradores
├── firestore.rules                  Reglas de seguridad
├── firestore.indexes.json           Índice compuesto (userId + workDate)
├── firebase.json                    Configuración de Firebase CLI y emuladores
├── scripts/manage-users.mjs         Cuentas, contraseñas y datos demo (uso local, Admin SDK)
├── tests/firestore.rules.test.mjs   Pruebas de las reglas (emulador)
├── netlify.toml                     Build, rutas SPA y cabeceras de seguridad
├── .env.example                     Variables del frontend
└── .env.scripts.example             Variables del script administrativo
```

### Modelo de datos (Firestore)

| Colección | Contenido | Quién escribe |
|---|---|---|
| `users/{uid}` | `employeeNumber`, `fullName`, `role` (`operator`/`admin`), `active`, `isDemo`, `mustChangePassword`, `passwordChangedAt` | El script. El usuario solo puede quitar su propia marca `mustChangePassword` |
| `dailyTrips/{uid}_{fecha}` | `userId`, `workDate` (`YYYY-MM-DD`), `trips` (0–100), `createdAt` | Operador, solo hoy y una vez |
| `fuelSettings/{uid}` | `initialLiters`, `litersPerTrip`, `updatedBy`, `updatedAt`, `auditId` | Admin, con bitácora |
| `settings/time` | `utcOffsetMinutes` (−360), `label` (`America/Mexico_City`) | Admin, con bitácora |
| `settings/fuel` | `defaultInitialLiters` (200), `defaultLitersPerTrip` (20) | Admin, con bitácora |
| `auditLog/{id}` | `collection`, `docId`, `before`, `after`, `changedBy`, `changedAt` | Admin, junto con el cambio; inmutable |

**Diésel estimado** = asignación inicial − (total acumulado de viajes × litros por viaje).
Si el resultado es negativo se muestra como **"Estimación por revisar"**.

---

## 3. Crear el proyecto de Firebase

Necesitas Node.js 20.12 o superior.

1. Entra a <https://console.firebase.google.com> y crea un proyecto. Google Analytics no es necesario.
   El proyecto queda en el plan gratuito **Spark**; no pide tarjeta.
2. **Authentication → Comenzar → Método de acceso**: habilita **Correo electrónico/contraseña**.
   Deja desactivado "Vínculo de correo electrónico".
3. **Authentication → Configuración → Acciones del usuario**: desmarca **"Habilitar creación (registro)"**.
   Así nadie crea cuentas desde fuera; solo el script.
   Deja activada la **protección contra la enumeración de correos**.
4. **Firestore Database → Crear base de datos**: modo **producción**. Ubicación sugerida: `us-central1` o `northamerica-south1`.
   La ubicación no se puede cambiar después.
5. **Configuración del proyecto → General → Tus apps → Web (`</>`)**: registra una app y copia
   `apiKey`, `authDomain`, `projectId` y `appId`.
6. Publica reglas e índices:
   ```bash
   npm install
   npx firebase login
   copy .firebaserc.example .firebaserc     # edita y pon tu ID de proyecto
   npm run deploy:rules
   ```
7. **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**. Descarga el JSON y
   guárdalo **fuera** de la carpeta del proyecto.

> ⚠️ La llave de cuenta de servicio da control total del proyecto. Nunca la subas a GitHub, Netlify, chats ni
> correos. Si se filtra, bórrala en *Google Cloud Console → IAM → Cuentas de servicio → Claves* y genera otra.

---

## 4. Ejecutar en local

1. Copia `.env.example` a `.env.local` y rellena los valores del paso 3.5.
2. Copia `.env.scripts.example` a `.env.scripts` y pon:
   - `FIREBASE_PROJECT_ID`
   - `GOOGLE_APPLICATION_CREDENTIALS` (ruta al JSON del paso 3.7)
   - el mismo `EMPLOYEE_EMAIL_DOMAIN` que `VITE_EMPLOYEE_EMAIL_DOMAIN`
3. Crea la configuración inicial (zona horaria y litros por defecto):
   ```bash
   npm run usuarios -- init
   ```
4. Crea las cuentas con `npm run usuarios -- bootstrap` (detalles en la sección 5).
5. Arranca:
   ```bash
   npm run dev
   ```
   Abre <http://localhost:5173>.

`.env.local`, `.env.scripts`, `.firebaserc` y las llaves JSON están en `.gitignore`. Compruébalo antes del primer `git push`.

### Pruebas de seguridad de las reglas

Requieren **Java 21** (o 11+) instalado, por ejemplo [Eclipse Temurin](https://adoptium.net/).

```bash
npm run test:rules
```

Levanta el emulador de Firestore localmente y comprueba 26 casos: doble registro, fechas pasadas, campos
falsos, acceso entre operadores, combustible, bitácora, admin desactivado y contraseña temporal. No toca tu
proyecto real.

Si ya tienes un emulador abierto en el puerto 8080, ciérralo antes. En Windows, a veces el emulador de
Firestore sigue abierto al terminar; ciérralo desde el Administrador de tareas (proceso `java.exe`).

### Probar todo sin tocar el proyecto real (emuladores)

1. Terminal 1: `npx firebase emulators:start --only auth,firestore --project demo-flotilla`
2. Terminal 2, con PowerShell:
   ```powershell
   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; $env:FIREBASE_PROJECT_ID="demo-flotilla"
   npm run usuarios -- init
   npm run usuarios -- seed-demo
   ```
3. En `.env.local` pon `VITE_USE_EMULATORS=true`, `VITE_FIREBASE_PROJECT_ID=demo-flotilla` y cualquier valor en
   las demás variables `VITE_FIREBASE_*`. Luego ejecuta `npm run dev`.

---

## 5. Cuentas

### Cuentas de la flotilla

| Nombre | Empleado | Rol | Qué puede hacer |
|---|---|---|---|
| Ángel | 100 | Operador | Registrar sus viajes del día |
| Jonah | 101 | Operador | Registrar sus viajes del día |
| Johnny | 102 | Operador | Registrar sus viajes del día |
| Sergio | 103 | Operador | Registrar sus viajes del día |
| Daniel | 900 | Administrador | Panel completo: resumen, registros, combustible, configuración y bitácora |
| Édgar | 901 | Administrador | Lo mismo que Daniel |

Los nombres están en `FLEET_ACCOUNTS`, dentro de `scripts/manage-users.mjs`. Corrígelos ahí antes de crear las cuentas si hace falta.

### Crear las cuentas (una sola vez)

1. Si en este proyecto de Firebase creaste antes las cuentas **demo** (100, 101 y 102 con contraseñas 1, 2 y 3),
   bórralas primero. Usan los mismos números de empleado:
   ```bash
   npm run usuarios -- remove-demo
   ```
2. Crea las 6 cuentas:
   ```bash
   npm run usuarios -- bootstrap
   ```
3. El script muestra una tabla con la **contraseña temporal** de cada persona:
   ```
   ================  CONTRASEÑAS TEMPORALES  ================
     100    Ángel      operador  K7PM-4QXR
     ...
   ```
   **Cópiala en ese momento.** No se guarda en ningún archivo y no se vuelve a mostrar.
4. Entrega a cada persona su número de empleado y su contraseña temporal, en persona o por mensaje privado.
   No uses un grupo de chat.
5. Cada persona entra a la app y crea su propia contraseña. Hasta que lo haga, la cuenta no puede hacer nada más.

Si vuelves a ejecutar `bootstrap`, omite las cuentas que ya existen.

### Olvidó su contraseña

```bash
npm run usuarios -- reset-password --employee 103
```

Genera una nueva contraseña temporal, la muestra en pantalla y obliga otra vez a cambiarla al entrar.
Las sesiones abiertas de esa persona se cierran en máximo 1 hora.

### Agregar a alguien nuevo

```bash
npm run usuarios -- create --employee 104 --name "Nombre" --role operator
npm run usuarios -- create --employee 902 --name "Nombre" --role admin
```

También recibe una contraseña temporal que debe cambiar al entrar.

### Desactivar a alguien

```bash
npm run usuarios -- deactivate --employee 103
npm run usuarios -- activate --employee 103
```

Desactivar bloquea el inicio de sesión en Firebase Auth y marca `active: false`. Las reglas niegan cualquier
acceso de inmediato. Sus registros se conservan.

### Datos de demostración (solo proyectos de prueba)

> ⚠️ Las cuentas demo usan los números 100, 101 y 102, los mismos que las cuentas reales, con contraseñas
> triviales (1, 2 y 3). Úsalas solo en los emuladores o en un proyecto de Firebase **distinto** al real.

```bash
npm run usuarios -- seed-demo      # crea Ángel 100/1, Jonah 101/2, Johnny 102/3 y 5 días de ejemplo
npm run usuarios -- reset-demo     # borra y regenera solo los registros demo
npm run usuarios -- remove-demo    # borra las cuentas demo y sus registros
```

Las cuentas demo no piden cambiar contraseña. `reset-demo` también restablece su combustible a los valores
por defecto y lo anota en la bitácora como "Sistema". Nunca toca cuentas reales.

---

## 6. Desplegar en Netlify desde GitHub

1. Crea un repositorio **privado** en GitHub y sube el proyecto:
   ```bash
   git init
   git add .
   git status        # confirma que NO aparecen .env.local, .env.scripts, .firebaserc ni archivos .json de llaves
   git commit -m "Versión inicial"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/flotilla-viajes.git
   git push -u origin main
   ```
2. En <https://app.netlify.com>: **Add new site → Import an existing project → GitHub**, y elige el repositorio.
   `netlify.toml` ya define el build (`npm run build`), la carpeta (`dist`) y Node 20.
3. En **Site configuration → Environment variables** agrega las 5 variables de `.env.example`:
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` y
   `VITE_EMPLOYEE_EMAIL_DOMAIN`. **No** agregues la llave de cuenta de servicio.
4. Despliega y copia la URL (por ejemplo `https://flotilla-viajes.netlify.app`).
5. En Firebase: **Authentication → Configuración → Dominios autorizados → Agregar dominio**, y pega el
   dominio de Netlify sin `https://`.
6. Recomendado: en **Google Cloud Console → APIs y servicios → Credenciales**, restringe la *API key* del
   navegador a tu dominio de Netlify y a `localhost`.
7. Cada `git push` a `main` vuelve a publicar el sitio. Si cambias `firestore.rules`, ejecuta `npm run deploy:rules`.

---

## 7. Correcciones administrativas

Los registros no se pueden editar desde la app, ni siquiera por los administradores. Para corregir un error, usa la
consola de Firebase (**Firestore Database → Datos**), que no pasa por las reglas. Anota el motivo en otro
lugar, porque ese cambio no queda en `auditLog`.

---

## 8. Lista de verificación de seguridad

- [x] Reglas en modo producción. Nada se lee ni escribe sin sesión.
- [x] Doble registro el mismo día: rechazado.
- [x] Fecha pasada, fecha distinta entre ID y contenido, `createdAt` falso o campos extra: rechazados.
- [x] Operador: no lee registros, perfiles, combustible ni bitácora de otros; no cambia su rol.
- [x] Admin: no puede editar ni borrar registros; no puede cambiar configuración sin bitácora ni con bitácora falsa.
- [x] Cuenta desactivada: pierde acceso en la siguiente petición.
- [x] Cuenta con contraseña temporal: no registra ni ve datos de admin hasta cambiarla; solo puede quitar su propia marca.
- [x] El build no incluye llaves privadas; las variables `VITE_*` se revisan al compilar.

Todos estos casos están en `tests/firestore.rules.test.mjs`. Ejecútalos con `npm run test:rules`.

---

## 9. Decisiones y límites conocidos

**Decisiones**

- **Cero viajes es válido.** Deja constancia de que el operador no hizo viajes ese día.
- **Máximo 100 viajes por día**, como protección contra errores de captura.
- **Registros inmutables.** La app pide confirmación antes de guardar.
- **Los administradores (Daniel y Édgar) no registran viajes**; solo los operadores activos.
- **Diésel acumulado histórico.** Usa todos los viajes desde el inicio y no modela cargas reales.
  Para "reiniciar" el saldo, un administrador ajusta la asignación inicial (queda en la bitácora).
- **Valores por defecto** de combustible: aplican a operadores nuevos.

**Zona horaria**

- Las reglas de Firestore no entienden nombres de zona como `America/Mexico_City`; usan un **desfase fijo**
  respecto a UTC. Inicia en UTC−06:00, que es correcto todo el año para el centro de México (sin horario de verano desde 2022).
- Si la flotilla opera en una zona con horario de verano, un administrador debe cambiar el desfase en cada cambio de horario.
- El día cambia a las 00:00 de esa zona. Un turno que cruza medianoche cuenta en la fecha en que se registra.
- La app calcula la fecha con el reloj del teléfono, pero el servidor decide. Si el reloj del teléfono está
  mal cerca de medianoche, el guardado se rechaza con un mensaje para revisar la fecha y hora.

**Inicio de sesión**

- La protección contra fuerza bruta es la de Firebase Auth. No hay bloqueo propio por número de empleado.
  Con contraseñas demo de 1 dígito cualquiera puede adivinar; por eso son solo para demostración.
- La contraseña nueva pide 8 caracteres o más; no se exige mayúsculas ni símbolos para que sea fácil en el teléfono.
- La marca "cambiar contraseña" la quita la app después de cambiarla. Un usuario con conocimientos técnicos
  podría quitarla sin cambiar la contraseña llamando a la API; solo se perjudica a sí mismo (sigue con la temporal).
- Si alguien olvida su contraseña, un administrador ejecuta `reset-password` desde su computadora; no hay
  recuperación por correo porque los correos internos no existen.
- Opcional: activar **App Check** con reCAPTCHA reduce el uso de la API fuera de la app.

**Panel**

- La tabla muestra hasta 1,000 filas; el total del periodo siempre es exacto (agregación en servidor).
- El resumen hace una consulta de suma por operador. Es adecuado para una flotilla pequeña.

**Plan gratuito** (verifica valores vigentes en la página de precios de Firebase y Netlify; pueden cambiar)

- Firestore Spark: 1 GiB almacenado, 50,000 lecturas, 20,000 escrituras y 20,000 borrados **por día**.
  Este uso queda muy por debajo. Al pasar el límite, Firestore deja de responder hasta el día siguiente; no cobra.
- Authentication: correo/contraseña sin costo para este volumen.
- Sin respaldos automáticos en Spark. Exporta datos periódicamente si son importantes.
- Netlify Free: cuota mensual limitada de builds y ancho de banda; suficiente para este uso.
