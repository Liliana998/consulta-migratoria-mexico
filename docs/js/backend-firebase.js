// Capa de datos real: Firebase Authentication (Google) + Cloud Firestore con copia local persistente.
import { firebaseConfig, FIREBASE_SDK_VERSION as V } from "./config.js";

const CDN = `https://www.gstatic.com/firebasejs/${V}`;
const COLECCIONES = ["tramites", "supuestos", "honorarios"];

export function firebaseConfigurado() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

export async function crearBackend() {
  const appMod = await import(`${CDN}/firebase-app.js`);
  const authMod = await import(`${CDN}/firebase-auth.js`);
  const fs = await import(`${CDN}/firebase-firestore.js`);

  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.initializeAuth(app, {
    persistence: [authMod.indexedDBLocalPersistence, authMod.browserLocalPersistence],
    popupRedirectResolver: authMod.browserPopupRedirectResolver
  });
  auth.languageCode = "es";
  // Copia local persistente para consulta sin conexión.
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
  });

  let uid = null;
  const base = () => `usuarios/${uid}`;
  const col = (nombre) => fs.collection(db, `${base()}/${nombre}`);
  const ref = (nombre, id) => fs.doc(db, `${base()}/${nombre}/${id}`);

  return {
    onAuth(cb) {
      return authMod.onAuthStateChanged(auth, (u) => {
        uid = u ? u.uid : null;
        cb(u ? { uid: u.uid, email: u.email || "", nombre: u.displayName || "" } : null);
      });
    },

    async entrarConGoogle() {
      const proveedor = new authMod.GoogleAuthProvider();
      proveedor.setCustomParameters({ prompt: "select_account" });
      try {
        await authMod.signInWithPopup(auth, proveedor);
      } catch (e) {
        if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
          await authMod.signInWithRedirect(auth, proveedor);
          return;
        }
        throw e;
      }
    },

    async salir() {
      await authMod.signOut(auth);
    },

    // Escucha en tiempo real; entrega el estado completo cada vez que algo cambia.
    suscribir(cb) {
      const estado = { tramites: [], supuestos: [], honorarios: [], seguridad: null, app: null,
        recibidos: new Set(), desdeCache: true, seguridadConfirmada: false, appConfirmada: false };
      const emitir = () => cb({
        tramites: estado.tramites, supuestos: estado.supuestos, honorarios: estado.honorarios,
        seguridad: estado.seguridad, app: estado.app,
        seguridadConfirmada: estado.seguridadConfirmada, appConfirmada: estado.appConfirmada,
        cargado: estado.recibidos.size === COLECCIONES.length + 2,
        desdeCache: estado.desdeCache
      });
      const opts = { includeMetadataChanges: true };
      const fallo = (donde) => (err) => {
        console.error(donde, err);
        if (err && err.code === "permission-denied") cb({ sinPermiso: true });
      };
      const bajas = COLECCIONES.map((nombre) =>
        fs.onSnapshot(col(nombre), opts, (snap) => {
          estado[nombre] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          estado.recibidos.add(nombre);
          estado.desdeCache = snap.metadata.fromCache;
          emitir();
        }, fallo(nombre))
      );
      bajas.push(fs.onSnapshot(ref("config", "seguridad"), opts, (snap) => {
        estado.seguridad = snap.exists() ? snap.data() : null;
        estado.seguridadConfirmada = snap.exists() || !snap.metadata.fromCache;
        estado.recibidos.add("seguridad");
        emitir();
      }, fallo("seguridad")));
      bajas.push(fs.onSnapshot(ref("config", "app"), opts, (snap) => {
        estado.app = snap.exists() ? snap.data() : null;
        estado.appConfirmada = snap.exists() || !snap.metadata.fromCache;
        estado.recibidos.add("app");
        emitir();
      }, fallo("app")));
      return () => bajas.forEach((b) => b());
    },

    nuevoId(nombre) {
      return fs.doc(col(nombre)).id;
    },

    // Guarda con control de versión: si otro dispositivo modificó el registro, se rechaza.
    async guardar(nombre, id, datos, versionEsperada) {
      const r = ref(nombre, id);
      await fs.runTransaction(db, async (tx) => {
        const actual = await tx.get(r);
        const versionActual = actual.exists() ? (actual.data().version || 0) : 0;
        if (versionEsperada !== null && versionEsperada !== undefined && versionActual !== versionEsperada) {
          const e = new Error("conflicto");
          e.code = "conflicto";
          throw e;
        }
        if (versionEsperada === null && actual.exists()) {
          const e = new Error("conflicto");
          e.code = "conflicto";
          throw e;
        }
        const limpio = { ...datos };
        delete limpio.id;
        tx.set(r, { ...limpio, version: versionActual + 1, actualizado: new Date().toISOString() });
      });
    },

    async eliminar(lista) {
      for (let i = 0; i < lista.length; i += 400) {
        const lote = fs.writeBatch(db);
        lista.slice(i, i + 400).forEach(({ coleccion, id }) => lote.delete(ref(coleccion, id)));
        await lote.commit();
      }
    },

    async guardarSeguridad(registro) {
      await fs.setDoc(ref("config", "seguridad"), registro);
    },

    // Crea el contenido inicial solo una vez por cuenta.
    async inicializarSiHaceFalta(semilla) {
      const rApp = ref("config", "app");
      const yaExiste = await fs.getDocFromServer(rApp).then((s) => s.exists());
      if (yaExiste) return false;
      const lote = fs.writeBatch(db);
      const ahora = new Date().toISOString();
      for (const nombre of COLECCIONES) {
        for (const item of semilla[nombre]) {
          const { id, ...resto } = item;
          lote.set(ref(nombre, id), { ...resto, version: 1, actualizado: ahora });
        }
      }
      lote.set(rApp, { inicializado: ahora, esquema: 1 });
      await lote.commit();
      return true;
    },

    // Sustituye toda la biblioteca y los honorarios por el contenido de un respaldo ya validado.
    async reemplazarTodo(datos, actuales) {
      const ops = [];
      for (const nombre of COLECCIONES) {
        const nuevosIds = new Set(datos[nombre].map((x) => x.id));
        actuales[nombre].forEach((x) => { if (!nuevosIds.has(x.id)) ops.push(["del", nombre, x.id]); });
        datos[nombre].forEach((x) => ops.push(["set", nombre, x.id, x]));
      }
      const ahora = new Date().toISOString();
      for (let i = 0; i < ops.length; i += 400) {
        const lote = fs.writeBatch(db);
        ops.slice(i, i + 400).forEach(([tipo, nombre, id, x]) => {
          if (tipo === "del") lote.delete(ref(nombre, id));
          else {
            const { id: _omit, ...resto } = x;
            const previa = actuales[nombre].find((a) => a.id === id);
            lote.set(ref(nombre, id), { ...resto, version: ((previa && previa.version) || 0) + 1, actualizado: ahora });
          }
        });
        await lote.commit();
      }
    }
  };
}
