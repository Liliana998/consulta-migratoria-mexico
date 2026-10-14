// SOLO PARA PRUEBAS LOCALES. No se publica. Imita la interfaz de backend-firebase.js
// guardando en localStorage, para probar la interfaz sin acceso a Firebase.
const CLAVE = "cmm_prueba_bd";
const leer = () => JSON.parse(localStorage.getItem(CLAVE) || '{"tramites":{},"supuestos":{},"honorarios":{},"config":{}}');
const escribir = (bd) => localStorage.setItem(CLAVE, JSON.stringify(bd));

export async function crearBackendPrueba() {
  let oyentes = [];
  let usuario = localStorage.getItem("cmm_prueba_usuario") ? JSON.parse(localStorage.getItem("cmm_prueba_usuario")) : null;
  let authCb = null;
  const emitir = () => {
    const bd = leer();
    const lista = (n) => Object.entries(bd[n]).map(([id, v]) => ({ id, ...v }));
    const d = { tramites: lista("tramites"), supuestos: lista("supuestos"), honorarios: lista("honorarios"),
      seguridad: bd.config.seguridad || null, app: bd.config.app || null,
      seguridadConfirmada: navigator.onLine || !!bd.config.seguridad, appConfirmada: navigator.onLine || !!bd.config.app,
      cargado: true, desdeCache: !navigator.onLine };
    oyentes.forEach((f) => f(d));
  };
  window.__bdPrueba = { leer, escribir, emitir };
  const necesitaRed = () => { if (!navigator.onLine) { const e = new Error("unavailable"); e.code = "unavailable"; throw e; } };
  return {
    onAuth(cb) { authCb = cb; setTimeout(() => cb(usuario), 0); },
    async entrarConGoogle() {
      usuario = { uid: "prueba", email: "prueba@example.com", nombre: "Prueba" };
      localStorage.setItem("cmm_prueba_usuario", JSON.stringify(usuario));
      authCb(usuario);
    },
    async salir() { usuario = null; localStorage.removeItem("cmm_prueba_usuario"); authCb(null); },
    suscribir(cb) { oyentes.push(cb); setTimeout(emitir, 0); return () => (oyentes = oyentes.filter((f) => f !== cb)); },
    nuevoId() { return "n" + Math.random().toString(36).slice(2, 10); },
    async guardar(col, id, datos, versionEsperada) {
      necesitaRed();
      const bd = leer();
      const actual = bd[col][id];
      const va = actual ? actual.version || 0 : 0;
      if ((versionEsperada === null && actual) || (versionEsperada !== null && versionEsperada !== undefined && va !== versionEsperada)) {
        const e = new Error("conflicto"); e.code = "conflicto"; throw e;
      }
      const { id: _o, ...resto } = datos;
      bd[col][id] = { ...resto, version: va + 1, actualizado: new Date().toISOString() };
      escribir(bd); emitir();
    },
    async eliminar(lista) { necesitaRed(); const bd = leer(); lista.forEach(({ coleccion, id }) => delete bd[coleccion][id]); escribir(bd); emitir(); },
    async guardarSeguridad(r) { necesitaRed(); const bd = leer(); bd.config.seguridad = r; escribir(bd); emitir(); },
    async inicializarSiHaceFalta(semilla) {
      const bd = leer();
      if (bd.config.app) return false;
      for (const n of ["tramites", "supuestos", "honorarios"]) for (const x of semilla[n]) { const { id, ...r } = x; bd[n][id] = { ...r, version: 1 }; }
      bd.config.app = { inicializado: new Date().toISOString(), esquema: 1 };
      escribir(bd); emitir(); return true;
    },
    async reemplazarTodo(datos) {
      necesitaRed();
      const bd = leer();
      for (const n of ["tramites", "supuestos", "honorarios"]) {
        const prev = bd[n]; bd[n] = {};
        datos[n].forEach((x) => { const { id, ...r } = x; bd[n][id] = { ...r, version: ((prev[id] && prev[id].version) || 0) + 1 }; });
      }
      escribir(bd); emitir();
    }
  };
}
