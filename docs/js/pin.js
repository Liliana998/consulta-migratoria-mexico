// Protección del PIN: nunca se guarda el PIN, solo una huella irreversible (PBKDF2-SHA256 con sal aleatoria).

export const PIN_LONGITUD = 7;
const ITERACIONES = 310000;

const enc = new TextEncoder();

function aBase64(buf) {
  let s = "";
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}
function deBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function pinValido(pin) {
  return typeof pin === "string" && new RegExp(`^\\d{${PIN_LONGITUD}}$`).test(pin);
}

async function derivar(pin, sal, iteraciones) {
  const clave = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iteraciones }, clave, 256);
}

export async function crearRegistroPin(pin) {
  if (!pinValido(pin)) throw new Error("El PIN debe tener exactamente 7 dígitos.");
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const huella = await derivar(pin, sal, ITERACIONES);
  return {
    algoritmo: "PBKDF2-SHA256",
    iteraciones: ITERACIONES,
    sal: aBase64(sal),
    huella: aBase64(huella),
    actualizado: new Date().toISOString()
  };
}

export async function verificarPin(pin, registro) {
  if (!pinValido(pin) || !registro || !registro.sal || !registro.huella) return false;
  const calculada = new Uint8Array(await derivar(pin, deBase64(registro.sal), registro.iteraciones || ITERACIONES));
  const guardada = deBase64(registro.huella);
  if (calculada.length !== guardada.length) return false;
  let dif = 0;
  for (let i = 0; i < calculada.length; i++) dif |= calculada[i] ^ guardada[i];
  return dif === 0;
}

// ---- Control de intentos fallidos (local a cada dispositivo) ----
const CLAVE_INTENTOS = "cmm_intentos_pin";
export const INTENTOS_ANTES_DE_ESPERA = 5;
export const INTENTOS_MAXIMOS = 10;

export function leerIntentos() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_INTENTOS)) || { fallos: 0, bloqueadoHasta: 0 };
  } catch {
    return { fallos: 0, bloqueadoHasta: 0 };
  }
}
function guardarIntentos(v) {
  try { localStorage.setItem(CLAVE_INTENTOS, JSON.stringify(v)); } catch {}
}
export function reiniciarIntentos() {
  guardarIntentos({ fallos: 0, bloqueadoHasta: 0 });
}
// Devuelve el estado tras registrar un fallo: { fallos, esperaSegundos, cerrarSesion }
export function registrarFallo() {
  const v = leerIntentos();
  v.fallos += 1;
  let espera = 0;
  if (v.fallos >= INTENTOS_ANTES_DE_ESPERA && v.fallos < INTENTOS_MAXIMOS) {
    espera = 30 * Math.pow(2, v.fallos - INTENTOS_ANTES_DE_ESPERA); // 30 s, 60 s, 2 min, 4 min, 8 min
    v.bloqueadoHasta = Date.now() + espera * 1000;
  }
  guardarIntentos(v);
  return { fallos: v.fallos, esperaSegundos: espera, cerrarSesion: v.fallos >= INTENTOS_MAXIMOS };
}
export function segundosDeEspera() {
  const v = leerIntentos();
  return Math.max(0, Math.ceil((v.bloqueadoHasta - Date.now()) / 1000));
}
