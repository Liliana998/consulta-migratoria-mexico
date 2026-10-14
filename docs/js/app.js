import {
  crearSemilla, porOrden, buscar, estadoVigencia, construirRespaldo, validarRespaldo,
  TIPOS_REQUISITO, ESTADOS_REVISION, ESTADOS_GASTO, uid
} from "./datos.js";
import {
  PIN_LONGITUD, crearRegistroPin, verificarPin, registrarFallo, reiniciarIntentos,
  segundosDeEspera, leerIntentos, INTENTOS_MAXIMOS
} from "./pin.js";

// ---------------------------------------------------------------- Estado
const S = {
  backend: null,
  usuario: undefined,          // undefined = comprobando; null = sin sesión
  datos: null,                 // último estado recibido de la base de datos
  online: navigator.onLine,
  edicion: false,
  busqueda: "",
  error: null
};
let cancelarSuscripcion = null;
let semillaIntentada = false;

const raiz = document.getElementById("app");
const ses = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
  del: (k) => { try { sessionStorage.removeItem(k); } catch {} }
};
const desbloqueado = () => ses.get("cmm_desbloqueado") === "1";

// ---------------------------------------------------------------- Utilidades
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const conSaltos = (s) => esc(s).replace(/\n/g, "<br>");
const fmtFecha = (iso) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return isNaN(d) ? iso : d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
};
const fmtImporte = (v, moneda = "MXN") => {
  if (v === null || v === undefined || v === "") return null;
  try { return new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda || "MXN" }).format(v); }
  catch { return `${Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${moneda}`; }
};
const enlaceSeguro = (u) => /^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : null;

const tramites = () => [...(S.datos?.tramites || [])].sort(porOrden);
const supuestosDe = (tid) => (S.datos?.supuestos || []).filter((s) => s.tramiteId === tid).sort(porOrden);
const honorarios = () => [...(S.datos?.honorarios || [])].sort(porOrden);
const tramite = (id) => (S.datos?.tramites || []).find((t) => t.id === id);
const supuesto = (id) => (S.datos?.supuestos || []).find((s) => s.id === id);

const puedeEditar = () => S.edicion && S.online;

// ---------------------------------------------------------------- Diálogos
function dialogo(html, alAbrir) {
  const d = document.createElement("dialog");
  d.className = "dlg";
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener("close", () => d.remove());
  d.addEventListener("cancel", (e) => { if (d.dataset.ocupado) e.preventDefault(); });
  d.showModal();
  if (alAbrir) alAbrir(d);
  return d;
}

function confirmar(mensaje, { boton = "Confirmar", peligro = false, titulo = "Confirmación" } = {}) {
  return new Promise((ok) => {
    const d = dialogo(`
      <form method="dialog">
        <h2>${esc(titulo)}</h2>
        <div class="dlg-cuerpo">${mensaje}</div>
        <div class="dlg-acciones">
          <button value="no" class="btn">Cancelar</button>
          <button value="si" class="btn ${peligro ? "btn-peligro" : "btn-primario"}">${esc(boton)}</button>
        </div>
      </form>`);
    d.addEventListener("close", () => ok(d.returnValue === "si"));
  });
}

function aviso(mensaje, titulo = "Aviso") {
  return new Promise((ok) => {
    const d = dialogo(`
      <form method="dialog">
        <h2>${esc(titulo)}</h2>
        <div class="dlg-cuerpo">${mensaje}</div>
        <div class="dlg-acciones"><button class="btn btn-primario" value="ok">Entendido</button></div>
      </form>`);
    d.addEventListener("close", () => ok());
  });
}

// campos: [{ nombre, etiqueta, tipo, valor, opciones, requerido, ayuda, visibleSi(valores) }]
function formulario({ titulo, campos, guardar = "Guardar", alGuardar }) {
  const campoHtml = (c) => {
    const id = `f-${c.nombre}`;
    const req = c.requerido ? " required" : "";
    let control;
    if (c.tipo === "textarea") control = `<textarea id="${id}" name="${c.nombre}" rows="${c.filas || 5}"${req}>${esc(c.valor)}</textarea>`;
    else if (c.tipo === "select") control = `<select id="${id}" name="${c.nombre}">${Object.entries(c.opciones).map(([v, t]) => `<option value="${esc(v)}"${v === c.valor ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
    else control = `<input id="${id}" name="${c.nombre}" type="${c.tipo || "text"}" value="${esc(c.valor ?? "")}"${c.tipo === "number" ? ' inputmode="decimal" step="0.01" min="0"' : ""}${req}>`;
    return `<div class="campo" data-campo="${c.nombre}"><label for="${id}">${esc(c.etiqueta)}</label>${control}${c.ayuda ? `<p class="ayuda">${esc(c.ayuda)}</p>` : ""}</div>`;
  };
  const d = dialogo(`
    <form class="dlg-form" novalidate>
      <h2>${esc(titulo)}</h2>
      <div class="dlg-cuerpo">${campos.map(campoHtml).join("")}<p class="error" hidden></p></div>
      <div class="dlg-acciones">
        <button type="button" class="btn" data-cancelar>Cancelar</button>
        <button type="submit" class="btn btn-primario">${esc(guardar)}</button>
      </div>
    </form>`);
  const form = d.querySelector("form");
  const valores = () => Object.fromEntries(campos.map((c) => [c.nombre, form.elements[c.nombre].value]));
  const refrescar = () => campos.forEach((c) => {
    if (c.visibleSi) form.querySelector(`[data-campo="${c.nombre}"]`).hidden = !c.visibleSi(valores());
  });
  form.addEventListener("input", refrescar);
  refrescar();
  d.querySelector("[data-cancelar]").onclick = () => d.close();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = form.querySelector(".error");
    errorEl.hidden = true;
    const v = valores();
    for (const c of campos) {
      const visible = !c.visibleSi || c.visibleSi(v);
      if (visible && c.requerido && !String(v[c.nombre]).trim()) { errorEl.textContent = `Complete el campo «${c.etiqueta}».`; errorEl.hidden = false; return; }
    }
    if (!S.online) { errorEl.textContent = "No hay conexión a internet. Los cambios solo pueden guardarse con conexión."; errorEl.hidden = false; return; }
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true; d.dataset.ocupado = "1"; btn.textContent = "Guardando…";
    try {
      const r = await alGuardar(v);
      if (r && r.error) { errorEl.textContent = r.error; errorEl.hidden = false; return; }
      d.close();
    } catch (err) {
      d.close();
      manejarErrorGuardado(err);
    } finally {
      btn.disabled = false; delete d.dataset.ocupado; btn.textContent = guardar;
    }
  });
  setTimeout(() => form.querySelector("input,textarea,select")?.focus(), 50);
  return d;
}

function manejarErrorGuardado(err) {
  console.error(err);
  if (err && err.code === "conflicto") {
    aviso("Este registro fue modificado desde otro dispositivo mientras usted editaba, por lo que su cambio <strong>no se guardó</strong> para no sustituir la versión más reciente.<br><br>La pantalla ya muestra los datos actualizados. Revíselos y, si sigue siendo necesario, vuelva a aplicar su cambio.", "Cambio no guardado");
  } else if (err && /offline|unavailable/i.test(String(err.code || err.message))) {
    aviso("No fue posible conectar con el servidor. Compruebe su conexión a internet e inténtelo de nuevo.", "Cambio no guardado");
  } else {
    aviso(`No fue posible guardar el cambio. Detalle técnico: ${esc(err && (err.code || err.message))}`, "Cambio no guardado");
  }
}

// Guarda una copia modificada de un supuesto con control de versión.
async function modificarSupuesto(s, mutar) {
  const copia = structuredClone(s);
  mutar(copia);
  await S.backend.guardar("supuestos", s.id, copia, s.version ?? 0);
}

async function reordenar(coleccion, lista, indice, delta) {
  const j = indice + delta;
  if (j < 0 || j >= lista.length) return;
  const nueva = [...lista];
  [nueva[indice], nueva[j]] = [nueva[j], nueva[indice]];
  try {
    for (let k = 0; k < nueva.length; k++) {
      if ((nueva[k].orden ?? 0) !== k + 1) await S.backend.guardar(coleccion, nueva[k].id, { ...nueva[k], orden: k + 1 }, nueva[k].version ?? 0);
    }
  } catch (e) { manejarErrorGuardado(e); }
}

// ---------------------------------------------------------------- Marco común
function barra({ volver, titulo } = {}) {
  const ed = S.edicion;
  return `
  <header class="barra">
    <div class="barra-izq">
      ${volver ? `<a class="btn-icono" href="${volver}" aria-label="Volver">${icono("atras")}</a>` : `<a class="marca" href="#/">Consulta Migratoria</a>`}
      ${titulo ? `<span class="barra-titulo">${esc(titulo)}</span>` : ""}
    </div>
    <div class="barra-der">
      <span class="conexion ${S.online ? "en-linea" : "sin-linea"}" role="status">${S.online ? "En línea" : "Sin conexión"}</span>
      <button class="modo ${ed ? "modo-edicion" : ""}" data-accion="modo" ${S.online ? "" : "disabled"} aria-pressed="${ed}">
        ${ed ? "Modo edición" : "Modo consulta"}
      </button>
      <a class="btn-icono" href="#/ajustes" aria-label="Ajustes">${icono("menu")}</a>
    </div>
  </header>
  ${ed ? `<div class="franja-edicion">Modo edición activo. Los cambios se guardan en la nube y llegan al otro dispositivo.</div>` : ""}
  ${!S.online ? `<div class="franja-offline">Está consultando la copia guardada en este dispositivo. Para editar, conéctese a internet.</div>` : ""}`;
}

function icono(n) {
  const p = {
    atras: '<path d="M15 5l-7 7 7 7" />',
    menu: '<path d="M4 7h16M4 12h16M4 17h16" />',
    arriba: '<path d="M6 14l6-6 6 6" />',
    abajo: '<path d="M6 10l6 6 6-6" />',
    editar: '<path d="M4 20h4L19 9l-4-4L4 16v4z" />',
    borrar: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />',
    mas: '<path d="M12 5v14M5 12h14" />',
    buscar: '<circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" />'
  }[n];
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

function controlesFila(datos) {
  if (!puedeEditar()) return "";
  return `<div class="ctrl-fila">
    <button class="btn-icono" data-accion="subir" ${datos} aria-label="Subir">${icono("arriba")}</button>
    <button class="btn-icono" data-accion="bajar" ${datos} aria-label="Bajar">${icono("abajo")}</button>
    <button class="btn-icono" data-accion="editar" ${datos} aria-label="Modificar">${icono("editar")}</button>
    <button class="btn-icono peligro" data-accion="borrar" ${datos} aria-label="Eliminar">${icono("borrar")}</button>
  </div>`;
}

function cajaBusqueda(valor = "") {
  return `<form class="busqueda" data-form="buscar" role="search">
    ${icono("buscar")}
    <input type="search" name="q" value="${esc(valor)}" placeholder="Buscar en trámites, supuestos, preguntas, requisitos y observaciones" aria-label="Buscar" enterkeyhint="search">
  </form>`;
}

// ---------------------------------------------------------------- Pantallas de acceso
function pantallaAcceso(contenido) {
  raiz.innerHTML = `<main class="acceso"><div class="acceso-caja">
    <p class="acceso-marca">Consulta Migratoria</p>${contenido}</div></main>`;
}

function vistaConfiguracionPendiente() {
  pantallaAcceso(`<h1>Configuración pendiente</h1>
    <p>La aplicación todavía no está vinculada a su proyecto de Firebase. Este paso se completa una sola vez durante la instalación.</p>`);
}

function vistaEntrar() {
  const recuperando = ses.get("cmm_recuperar") === "1";
  pantallaAcceso(`
    <h1>${recuperando ? "Recuperar el acceso" : "Preparar este dispositivo"}</h1>
    <p>${recuperando
      ? "Identifíquese con su cuenta de Google para crear un PIN nuevo. El nuevo PIN se aplicará también en su otro dispositivo."
      : "Identifíquese con su cuenta de Google. Solo se pide al preparar el dispositivo o para recuperar el acceso; en el uso diario bastará su PIN."}</p>
    ${S.online ? "" : `<p class="error">Este paso requiere conexión a internet.</p>`}
    <button class="btn btn-primario btn-ancho" data-accion="google" ${S.online ? "" : "disabled"}>Continuar con Google</button>
    ${recuperando ? `<button class="btn btn-ancho btn-texto" data-accion="cancelar-recuperacion">Cancelar</button>` : ""}
    ${S.error ? `<p class="error">${esc(S.error)}</p>` : ""}`);
}

function vistaPreparando(texto) {
  pantallaAcceso(`<h1>${esc(texto)}</h1><div class="cargando" aria-hidden="true"></div>`);
}

function tecladoPin({ titulo, subtitulo, alCompletar, extra = "" }) {
  pantallaAcceso(`
    <h1>${esc(titulo)}</h1>
    ${subtitulo ? `<p>${subtitulo}</p>` : ""}
    <div class="pin-puntos" aria-live="polite">${Array.from({ length: PIN_LONGITUD }, () => "<span></span>").join("")}</div>
    <p class="error pin-error" hidden></p>
    <div class="teclado">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="tecla" data-digito="${n}">${n}</button>`).join("")}
      <span></span><button class="tecla" data-digito="0">0</button>
      <button class="tecla tecla-borrar" data-borrar aria-label="Borrar">⌫</button>
    </div>
    ${extra}`);
  let pin = "";
  const puntos = raiz.querySelectorAll(".pin-puntos span");
  const errorEl = raiz.querySelector(".pin-error");
  const pintar = () => puntos.forEach((p, i) => p.classList.toggle("lleno", i < pin.length));
  const ctl = {
    error(msg) { errorEl.textContent = msg; errorEl.hidden = !msg; },
    reiniciar() { pin = ""; pintar(); },
    bloquear(b) { raiz.querySelectorAll(".tecla").forEach((t) => (t.disabled = b)); }
  };
  const pulsar = async (d) => {
    if (pin.length >= PIN_LONGITUD) return;
    pin += d; pintar();
    if (pin.length === PIN_LONGITUD) {
      ctl.bloquear(true);
      const valor = pin;
      await alCompletar(valor, ctl);
      if (document.body.contains(errorEl)) ctl.bloquear(false);
    }
  };
  raiz.querySelectorAll("[data-digito]").forEach((b) => (b.onclick = () => pulsar(b.dataset.digito)));
  raiz.querySelector("[data-borrar]").onclick = () => { pin = pin.slice(0, -1); pintar(); };
  document.onkeydown = (e) => {
    if (!raiz.querySelector(".teclado")) { document.onkeydown = null; return; }
    if (/^\d$/.test(e.key)) pulsar(e.key);
    else if (e.key === "Backspace") { pin = pin.slice(0, -1); pintar(); }
  };
  return ctl;
}

function vistaCrearPin(esRecuperacion) {
  let primero = null;
  const paso1 = () => tecladoPin({
    titulo: esRecuperacion ? "Cree un PIN nuevo" : "Cree su PIN",
    subtitulo: "Elija un PIN de 7 dígitos. Lo usará en su teléfono y en su tableta.",
    alCompletar: async (pin, ctl) => { primero = pin; paso2(); }
  });
  const paso2 = () => tecladoPin({
    titulo: "Confirme el PIN",
    subtitulo: "Introduzca de nuevo los 7 dígitos.",
    alCompletar: async (pin, ctl) => {
      if (pin !== primero) { paso1(); setTimeout(() => raiz.querySelector(".pin-error") && (raiz.querySelector(".pin-error").textContent = "Los PIN no coinciden. Vuelva a empezar.", raiz.querySelector(".pin-error").hidden = false), 0); return; }
      if (!S.online) { ctl.error("Se necesita conexión a internet para guardar el PIN."); ctl.reiniciar(); return; }
      try {
        vistaPreparando("Guardando el PIN…");
        await S.backend.guardarSeguridad(await crearRegistroPin(pin));
        reiniciarIntentos();
        ses.del("cmm_recuperar");
        ses.set("cmm_desbloqueado", "1");
        render();
      } catch (e) {
        console.error(e);
        await aviso("No fue posible guardar el PIN. Compruebe su conexión e inténtelo de nuevo.");
        vistaCrearPin(esRecuperacion);
      }
    }
  });
  paso1();
}

function vistaPin() {
  const espera = segundosDeEspera();
  const ctl = tecladoPin({
    titulo: "Introduzca su PIN",
    subtitulo: "",
    extra: `<button class="btn btn-texto btn-ancho" data-accion="olvide-pin">Olvidé mi PIN</button>`,
    alCompletar: async (pin, ctl) => {
      const w = segundosDeEspera();
      if (w > 0) { ctl.error(`Espere ${w} segundos antes de volver a intentarlo.`); ctl.reiniciar(); return; }
      if (await verificarPin(pin, S.datos.seguridad)) {
        reiniciarIntentos();
        ses.set("cmm_desbloqueado", "1");
        render();
        return;
      }
      const r = registrarFallo();
      ctl.reiniciar();
      if (r.cerrarSesion) {
        reiniciarIntentos();
        await aviso("Se alcanzó el número máximo de intentos. Por seguridad se cerró la sesión de este dispositivo. Identifíquese de nuevo con su cuenta de Google.", "Acceso bloqueado");
        await S.backend.salir();
        return;
      }
      const restantes = INTENTOS_MAXIMOS - r.fallos;
      ctl.error(r.esperaSegundos
        ? `PIN incorrecto. Espere ${r.esperaSegundos} segundos. Intentos restantes antes de cerrar la sesión: ${restantes}.`
        : `PIN incorrecto. Intentos restantes antes de esperar: ${5 - r.fallos}.`);
    }
  });
  if (espera > 0) ctl.error(`Demasiados intentos. Espere ${espera} segundos antes de volver a intentarlo.`);
}

// ---------------------------------------------------------------- Vistas de la aplicación
function vistaInicio() {
  const n = (S.datos.supuestos || []).length;
  return `${barra()}
  <main class="contenido">
    <h1 class="titulo-inicio">Biblioteca de consulta</h1>
    ${cajaBusqueda(S.busqueda)}
    <nav class="accesos">
      <a class="acceso-seccion" href="#/consultas">
        <span class="acceso-nombre">Consultas migratorias</span>
        <span class="acceso-detalle">${tramites().length} trámites · ${n} ${n === 1 ? "supuesto" : "supuestos"}</span>
      </a>
      <a class="acceso-seccion" href="#/honorarios">
        <span class="acceso-nombre">Honorarios profesionales</span>
        <span class="acceso-detalle">${honorarios().length} procedimientos</span>
      </a>
    </nav>
  </main>`;
}

function vistaBuscar() {
  const res = buscar(S.busqueda, S.datos);
  const q = S.busqueda.trim();
  return `${barra({ volver: "#/", titulo: "Buscar" })}
  <main class="contenido">
    ${cajaBusqueda(S.busqueda)}
    ${q.length < 2 ? `<p class="vacio">Escriba al menos dos letras.</p>`
      : !res.length ? `<p class="vacio">No hay resultados para «${esc(q)}».</p>`
      : `<p class="conteo">${res.length} ${res.length === 1 ? "resultado" : "resultados"}</p>
         <ul class="resultados">${res.map((r) => `
          <li><a href="${r.ruta}">
            <span class="res-tipo">${esc(r.tipo)}</span>
            <span class="res-texto">${esc(r.texto)}</span>
            ${r.contexto ? `<span class="res-ctx">${esc(r.contexto)}</span>` : ""}
          </a></li>`).join("")}</ul>`}
  </main>`;
}

function vistaConsultas() {
  const lista = tramites();
  return `${barra({ volver: "#/", titulo: "Consultas migratorias" })}
  <main class="contenido">
    ${cajaBusqueda(S.busqueda)}
    <ul class="lista">
      ${lista.map((t, i) => {
        const n = supuestosDe(t.id).length;
        return `<li class="fila">
          <a class="fila-enlace" href="#/tramite/${t.id}">
            <span class="fila-nombre">${esc(t.nombre)}</span>
            <span class="fila-detalle">${n ? `${n} ${n === 1 ? "supuesto" : "supuestos"}` : "Sin supuestos"}</span>
          </a>
          ${controlesFila(`data-tipo="tramite" data-indice="${i}"`)}
        </li>`;
      }).join("")}
    </ul>
    ${!lista.length ? `<p class="vacio">Aún no hay trámites. ${S.online ? "Active el modo edición para agregar el primero." : ""}</p>` : ""}
    ${puedeEditar() ? `<button class="btn btn-agregar" data-accion="nuevo-tramite">${icono("mas")} Agregar trámite</button>` : ""}
  </main>`;
}

function insigniaRevision(s) {
  return s.estadoRevision === "aprobado"
    ? `<span class="insignia ok">Aprobado</span>`
    : `<span class="insignia borrador">Borrador pendiente de aprobación</span>`;
}

function vistaTramite(id) {
  const t = tramite(id);
  if (!t) return vistaNoEncontrado();
  const lista = supuestosDe(id);
  return `${barra({ volver: "#/consultas", titulo: t.nombre })}
  <main class="contenido">
    <h1 class="titulo-seccion">${esc(t.nombre)}</h1>
    <p class="subtitulo">Supuestos o vías jurídicas</p>
    <ul class="lista">
      ${lista.map((s, i) => {
        const v = estadoVigencia(s.fechaVerificacion);
        return `<li class="fila">
          <a class="fila-enlace" href="#/supuesto/${s.id}">
            <span class="fila-nombre">${esc(s.nombre)}</span>
            <span class="fila-insignias">
              ${s.esPrueba ? `<span class="insignia prueba">Datos de prueba</span>` : ""}
              ${insigniaRevision(s)}
              ${v.tipo === "nunca" ? `<span class="insignia pendiente">Pendiente de verificar</span>` : v.tipo === "revisar" ? `<span class="insignia revisar">Revisar vigencia</span>` : ""}
            </span>
          </a>
          ${controlesFila(`data-tipo="supuesto" data-tramite="${id}" data-indice="${i}"`)}
        </li>`;
      }).join("")}
    </ul>
    ${!lista.length ? `<p class="vacio">Este trámite aún no tiene supuestos.${S.online ? " Active el modo edición para agregar uno." : ""}</p>` : ""}
    ${puedeEditar() ? `<button class="btn btn-agregar" data-accion="nuevo-supuesto" data-tramite="${id}">${icono("mas")} Agregar supuesto</button>` : ""}
  </main>`;
}

const PESTANAS = [
  ["preguntas", "Preguntas"],
  ["requisitos", "Requisitos"],
  ["gastos", "Gastos"],
  ["observaciones", "Observaciones"]
];

function vistaSupuesto(id, pestana = "preguntas") {
  const s = supuesto(id);
  if (!s) return vistaNoEncontrado();
  if (!PESTANAS.some(([k]) => k === pestana)) pestana = "preguntas";
  const t = tramite(s.tramiteId);
  const v = estadoVigencia(s.fechaVerificacion);
  const fuentes = String(s.fuentes || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const ed = puedeEditar();
  return `${barra({ volver: `#/tramite/${s.tramiteId}`, titulo: t ? t.nombre : "" })}
  <main class="contenido ficha">
    ${s.esPrueba ? `<div class="aviso-prueba">Supuesto de prueba con datos ficticios. No contiene requisitos legales reales.</div>` : ""}
    <section class="caratula">
      <p class="caratula-tramite">${esc(t ? t.nombre : "")}</p>
      <h1>${esc(s.nombre)}</h1>
      <dl class="caratula-datos">
        <div><dt>Estado de revisión</dt><dd>${insigniaRevision(s)}</dd></div>
        <div><dt>Última verificación</dt><dd>${v.tipo === "nunca" ? `<span class="insignia pendiente">Pendiente de verificar</span>` : esc(fmtFecha(s.fechaVerificacion))}</dd></div>
        <div class="dd-ancho"><dt>Fuentes oficiales principales</dt><dd>${fuentes.length ? `<ul class="fuentes">${fuentes.map((f) => `<li>${enlaceSeguro(f) ? `<a href="${esc(f)}" target="_blank" rel="noopener">${esc(f)}</a>` : esc(f)}</li>`).join("")}</ul>` : `<span class="tenue">Sin registrar</span>`}</dd></div>
      </dl>
      ${v.tipo === "revisar" ? `<p class="aviso-vigencia">Han transcurrido más de seis meses desde la última verificación. Conviene revisar la vigencia de esta información.</p>` : ""}
      ${ed ? `<div class="caratula-acciones">
        <button class="btn" data-accion="editar-supuesto" data-id="${s.id}">${icono("editar")} Modificar datos del supuesto</button>
      </div>` : ""}
    </section>
    <nav class="pestanas" role="tablist">
      ${PESTANAS.map(([k, n]) => {
        const c = k === "observaciones" ? "" : ` <span class="cuenta">${(s[k] || []).length}</span>`;
        return `<a role="tab" aria-selected="${k === pestana}" class="pestana ${k === pestana ? "activa" : ""}" href="#/supuesto/${s.id}/${k}">${n}${c}</a>`;
      }).join("")}
    </nav>
    <section class="panel">${panel(s, pestana)}</section>
  </main>`;
}

function panel(s, p) {
  const ed = puedeEditar();
  const datos = (i) => `data-tipo="${p}" data-id="${s.id}" data-indice="${i}"`;
  if (p === "preguntas") {
    const l = s.preguntas || [];
    return `<h2 class="panel-titulo">Preguntas para la primera entrevista</h2>
      ${l.length ? `<ol class="items">${l.map((q, i) => `<li class="item"><div class="item-texto">${conSaltos(q.texto)}</div>${controlesFila(datos(i))}</li>`).join("")}</ol>` : `<p class="vacio">Sin preguntas registradas.</p>`}
      ${ed ? `<button class="btn btn-agregar" data-accion="nuevo-item" data-tipo="preguntas" data-id="${s.id}">${icono("mas")} Agregar pregunta</button>` : ""}`;
  }
  if (p === "requisitos") {
    const l = s.requisitos || [];
    return `<h2 class="panel-titulo">Requisitos y documentación</h2>
      ${l.length ? `<ol class="items">${l.map((r, i) => `<li class="item">
        <div class="item-texto">
          <span class="tipo-req tipo-${esc(r.tipo)}">${esc(TIPOS_REQUISITO[r.tipo] || r.tipo)}</span>
          <div>${conSaltos(r.texto)}</div>
          ${r.tipo === "condicional" && r.circunstancia ? `<p class="detalle"><strong>Aplica cuando:</strong> ${conSaltos(r.circunstancia)}</p>` : ""}
          ${r.referencia ? `<p class="detalle"><strong>Referencia oficial:</strong> ${enlaceSeguro(r.referencia) ? `<a href="${esc(r.referencia)}" target="_blank" rel="noopener">${esc(r.referencia)}</a>` : conSaltos(r.referencia)}</p>` : ""}
        </div>${controlesFila(datos(i))}</li>`).join("")}</ol>` : `<p class="vacio">Sin requisitos registrados.</p>`}
      ${ed ? `<button class="btn btn-agregar" data-accion="nuevo-item" data-tipo="requisitos" data-id="${s.id}">${icono("mas")} Agregar requisito</button>` : ""}`;
  }
  if (p === "gastos") {
    const l = s.gastos || [];
    return `<h2 class="panel-titulo">Gastos gubernamentales</h2>
      <p class="nota">Derechos y tarifas oficiales. Se mantienen separados de los honorarios profesionales.</p>
      ${l.length ? `<ul class="items gastos">${l.map((g, i) => {
        const imp = fmtImporte(g.importe, g.moneda);
        const enl = enlaceSeguro(g.enlace);
        const verificado = g.estado === "verificado" && imp;
        return `<li class="item">
          <div class="item-texto">
            <div class="gasto-cabecera">
              <span class="gasto-concepto">${esc(g.concepto)}</span>
              <span class="gasto-importe ${imp ? "" : "sin-importe"}">${imp ? esc(imp) : "Importe pendiente de verificar"}</span>
            </div>
            <p class="detalle">${verificado ? `<span class="insignia ok">Verificado</span>` : `<span class="insignia pendiente">Pendiente de verificar</span>`}
              ${g.fechaVerificacion ? ` Verificado el ${esc(fmtFecha(g.fechaVerificacion))}.` : ""}</p>
            ${g.fuente ? `<p class="detalle"><strong>Fuente:</strong> ${esc(g.fuente)}</p>` : ""}
            ${enl ? `<p class="detalle"><a href="${esc(enl)}" target="_blank" rel="noopener">Abrir la fuente oficial</a></p>` : ""}
          </div>${controlesFila(datos(i))}</li>`;
      }).join("")}</ul>` : `<p class="vacio">Sin gastos registrados.</p>`}
      ${ed ? `<button class="btn btn-agregar" data-accion="nuevo-item" data-tipo="gastos" data-id="${s.id}">${icono("mas")} Agregar concepto</button>` : ""}`;
  }
  return `<h2 class="panel-titulo">Observaciones</h2>
    ${s.observaciones ? `<div class="observaciones">${conSaltos(s.observaciones)}</div>` : `<p class="vacio">Sin observaciones.</p>`}
    ${ed ? `<button class="btn btn-agregar" data-accion="editar-observaciones" data-id="${s.id}">${icono("editar")} ${s.observaciones ? "Modificar observaciones" : "Escribir observaciones"}</button>
      <p class="nota">No incluya datos personales de clientes.</p>` : ""}`;
}

function vistaHonorarios() {
  const l = honorarios();
  return `${barra({ volver: "#/", titulo: "Honorarios profesionales" })}
  <main class="contenido">
    <h1 class="titulo-seccion">Honorarios profesionales</h1>
    <table class="tabla-honorarios">
      <thead><tr><th scope="col">Procedimiento</th><th scope="col" class="num">Honorarios (MXN)</th>${puedeEditar() ? "<th></th>" : ""}</tr></thead>
      <tbody>
        ${l.map((h, i) => `<tr>
          <td>${esc(h.procedimiento)}</td>
          <td class="num">${h.importe === null || h.importe === undefined ? `<span class="tenue">Sin definir</span>` : esc(fmtImporte(h.importe, "MXN"))}</td>
          ${puedeEditar() ? `<td class="acciones-celda"><div class="acciones-h">
            <button class="btn-icono" data-accion="editar" data-tipo="honorario" data-indice="${i}" aria-label="Modificar">${icono("editar")}</button>
            <button class="btn-icono peligro" data-accion="borrar" data-tipo="honorario" data-indice="${i}" aria-label="Eliminar">${icono("borrar")}</button>
          </div></td>` : ""}
        </tr>`).join("")}
      </tbody>
    </table>
    ${!l.length ? `<p class="vacio">No hay procedimientos registrados.</p>` : ""}
    ${puedeEditar() ? `<button class="btn btn-agregar" data-accion="nuevo-honorario">${icono("mas")} Agregar procedimiento</button>` : ""}
  </main>`;
}

function vistaAjustes() {
  return `${barra({ volver: "#/", titulo: "Ajustes" })}
  <main class="contenido">
    <h1 class="titulo-seccion">Ajustes</h1>
    <section class="bloque">
      <h2>Copias de seguridad</h2>
      <p>Descargue toda la información (biblioteca, fuentes, fechas, estados y honorarios) en un archivo JSON, o restáurela desde un respaldo.</p>
      <div class="botones">
        <button class="btn btn-primario" data-accion="exportar">Descargar respaldo</button>
        <button class="btn" data-accion="importar" ${S.online ? "" : "disabled"}>Restaurar un respaldo</button>
      </div>
      ${S.online ? "" : `<p class="nota">La restauración requiere conexión a internet.</p>`}
      <input type="file" accept="application/json,.json" id="archivo-respaldo" hidden>
    </section>
    <section class="bloque">
      <h2>Acceso</h2>
      <p>Cuenta vinculada: ${esc(S.usuario?.email || "")}</p>
      <div class="botones">
        <button class="btn" data-accion="cambiar-pin" ${S.online ? "" : "disabled"}>Cambiar PIN</button>
        <button class="btn" data-accion="bloquear">Bloquear ahora</button>
        <button class="btn btn-peligro" data-accion="cerrar-sesion" ${S.online ? "" : "disabled"}>Cerrar sesión en este dispositivo</button>
      </div>
      ${S.online ? "" : `<p class="nota">Cambiar el PIN y cerrar la sesión requieren conexión a internet.</p>`}
    </section>
    <section class="bloque">
      <h2>Estado de la copia local</h2>
      <p>${S.datos.desdeCache ? "Mostrando la copia guardada en este dispositivo." : "Copia local actualizada con la nube."}</p>
    </section>
  </main>`;
}

function vistaNoEncontrado() {
  return `${barra({ volver: "#/" })}<main class="contenido"><p class="vacio">El elemento solicitado no existe o fue eliminado.</p><a class="btn" href="#/">Ir al inicio</a></main>`;
}

// ---------------------------------------------------------------- Render principal
function render() {
  document.onkeydown = null;
  if (S.usuario === undefined) return vistaPreparando("Abriendo…");
  if (S.usuario === null) return vistaEntrar();
  const d = S.datos;
  if (!d || !d.cargado) {
    if (!S.online && !(d && d.seguridad)) return pantallaAcceso(`<h1>Sin conexión</h1><p>Este dispositivo aún no tiene la información descargada. Conéctese a internet para prepararlo por primera vez.</p>`);
    return vistaPreparando("Cargando la información…");
  }
  if (ses.get("cmm_recuperar") === "1") return vistaCrearPin(true);
  if (!d.seguridad) {
    if (!d.seguridadConfirmada) return pantallaAcceso(`<h1>Sin conexión</h1><p>Conéctese a internet para terminar de preparar este dispositivo.</p>`);
    return vistaCrearPin(false);
  }
  if (!desbloqueado()) return vistaPin();
  renderApp();
}

function ruta() {
  return (location.hash || "#/").slice(1).split("/").filter(Boolean);
}

function renderApp() {
  const [seccion, id, extra] = ruta();
  const scroll = window.scrollY;
  const mismo = raiz.dataset.ruta === location.hash;
  let html;
  switch (seccion) {
    case undefined: html = vistaInicio(); break;
    case "buscar": html = vistaBuscar(); break;
    case "consultas": html = vistaConsultas(); break;
    case "tramite": html = vistaTramite(id); break;
    case "supuesto": html = vistaSupuesto(id, extra); break;
    case "honorarios": html = vistaHonorarios(); break;
    case "ajustes": html = vistaAjustes(); break;
    default: html = vistaNoEncontrado();
  }
  const activo = document.activeElement;
  const enBusqueda = activo && activo.name === "q";
  const sel = enBusqueda ? [activo.selectionStart, activo.selectionEnd] : null;
  raiz.innerHTML = html;
  raiz.dataset.ruta = location.hash;
  if (mismo) window.scrollTo(0, scroll); else window.scrollTo(0, 0);
  if (enBusqueda) {
    const q = raiz.querySelector('input[name="q"]');
    if (q) { q.focus(); try { q.setSelectionRange(...sel); } catch {} }
  }
}

// ---------------------------------------------------------------- Acciones
document.addEventListener("submit", (e) => {
  if (e.target.matches('[data-form="buscar"]')) {
    e.preventDefault();
    S.busqueda = e.target.elements.q.value;
    if (location.hash !== "#/buscar") location.hash = "#/buscar"; else renderApp();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.name === "q" && e.target.closest('[data-form="buscar"]')) {
    S.busqueda = e.target.value;
    if (location.hash === "#/buscar") renderApp();
    else if (S.busqueda.trim().length >= 2) location.hash = "#/buscar";
  }
});

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-accion]");
  if (!b || b.disabled) return;
  const a = b.dataset.accion;
  try {
    await (ACCIONES[a] && ACCIONES[a](b));
  } catch (err) { manejarErrorGuardado(err); }
});

const ACCIONES = {
  async google() {
    S.error = null;
    try { await S.backend.entrarConGoogle(); }
    catch (e) {
      if (e && e.code === "auth/popup-closed-by-user") return;
      S.error = `No fue posible iniciar sesión con Google. Código: ${(e && (e.code || e.message)) || "desconocido"}`;
      console.error(e); render();
    }
  },
  "cancelar-recuperacion"() { ses.del("cmm_recuperar"); render(); },
  async "olvide-pin"() {
    if (!S.online) return aviso("Para recuperar el acceso necesita conexión a internet, ya que deberá identificarse con su cuenta de Google.");
    if (!(await confirmar("Para crear un PIN nuevo se cerrará la sesión de este dispositivo y deberá identificarse con su cuenta de Google.", { boton: "Continuar" }))) return;
    ses.set("cmm_recuperar", "1");
    ses.del("cmm_desbloqueado");
    reiniciarIntentos();
    await S.backend.salir();
  },
  modo() {
    if (!S.online) return;
    S.edicion = !S.edicion;
    renderApp();
  },
  bloquear() { ses.del("cmm_desbloqueado"); location.hash = "#/"; render(); },
  async "cerrar-sesion"() {
    if (!(await confirmar("Se cerrará la sesión en este dispositivo. Para volver a usar la aplicación deberá identificarse con Google y después introducir su PIN. Sus datos permanecen en la nube.", { boton: "Cerrar sesión", peligro: true }))) return;
    ses.del("cmm_desbloqueado");
    S.edicion = false;
    await S.backend.salir();
  },
  async "cambiar-pin"() {
    // Se verifica el PIN actual y se crea uno nuevo.
    const d = S.datos;
    let paso = "actual", nuevo = null;
    const volver = () => { location.hash = "#/ajustes"; render(); };
    const pedir = () => {
      const t = { actual: ["PIN actual", "Introduzca su PIN actual."], nuevo: ["PIN nuevo", "Elija un PIN nuevo de 7 dígitos."], confirmar: ["Confirme el PIN nuevo", "Introduzca de nuevo los 7 dígitos."] }[paso];
      tecladoPin({
        titulo: t[0], subtitulo: t[1], extra: `<button class="btn btn-texto btn-ancho" data-accion="cancelar-cambio">Cancelar</button>`,
        alCompletar: async (pin, ctl) => {
          if (paso === "actual") {
            if (await verificarPin(pin, d.seguridad)) { paso = "nuevo"; return pedir(); }
            ctl.error("PIN incorrecto."); ctl.reiniciar(); return;
          }
          if (paso === "nuevo") { nuevo = pin; paso = "confirmar"; return pedir(); }
          if (pin !== nuevo) { paso = "nuevo"; pedir(); return; }
          vistaPreparando("Guardando el PIN…");
          try { await S.backend.guardarSeguridad(await crearRegistroPin(pin)); await aviso("El PIN se actualizó. El cambio se aplicará en su otro dispositivo en cuanto tenga conexión."); }
          catch (e) { await aviso("No fue posible guardar el PIN nuevo. El PIN anterior sigue vigente."); }
          volver();
        }
      });
    };
    ACCIONES["cancelar-cambio"] = volver;
    pedir();
  },

  // ---- Trámites
  "nuevo-tramite"() {
    formulario({
      titulo: "Agregar trámite",
      campos: [{ nombre: "nombre", etiqueta: "Nombre del trámite", requerido: true }],
      guardar: "Agregar",
      alGuardar: async (v) => {
        const lista = tramites();
        await S.backend.guardar("tramites", S.backend.nuevoId("tramites"), { nombre: v.nombre.trim(), orden: lista.length + 1 }, null);
      }
    });
  },
  "nuevo-supuesto"(b) {
    const tid = b.dataset.tramite;
    formulario({
      titulo: "Agregar supuesto",
      campos: [{ nombre: "nombre", etiqueta: "Nombre del supuesto o vía jurídica", requerido: true }],
      guardar: "Agregar",
      alGuardar: async (v) => {
        const nid = S.backend.nuevoId("supuestos");
        await S.backend.guardar("supuestos", nid, {
          tramiteId: tid, nombre: v.nombre.trim(), orden: supuestosDe(tid).length + 1, esPrueba: false,
          estadoRevision: "borrador", fechaVerificacion: "", fuentes: "",
          preguntas: [], requisitos: [], gastos: [], observaciones: ""
        }, null);
        location.hash = `#/supuesto/${nid}`;
      }
    });
  },
  "editar-supuesto"(b) {
    const s = supuesto(b.dataset.id);
    formulario({
      titulo: "Datos del supuesto",
      campos: [
        { nombre: "nombre", etiqueta: "Nombre del supuesto", valor: s.nombre, requerido: true },
        { nombre: "estadoRevision", etiqueta: "Estado de revisión", tipo: "select", opciones: ESTADOS_REVISION, valor: s.estadoRevision || "borrador",
          ayuda: "La aprobación corresponde exclusivamente a usted." },
        { nombre: "fechaVerificacion", etiqueta: "Fecha de última verificación", tipo: "date", valor: s.fechaVerificacion || "",
          ayuda: "Déjela vacía si la información nunca se ha verificado." },
        { nombre: "fuentes", etiqueta: "Fuentes oficiales principales", tipo: "textarea", filas: 4, valor: s.fuentes || "",
          ayuda: "Una fuente por línea (por ejemplo, el artículo de la ley o el enlace oficial)." },
        { nombre: "esPrueba", etiqueta: "Tipo de contenido", tipo: "select", opciones: { no: "Contenido real", si: "Datos de prueba (ficticios)" }, valor: s.esPrueba ? "si" : "no" }
      ],
      alGuardar: async (v) => {
        if (v.fechaVerificacion && v.fechaVerificacion > new Date().toISOString().slice(0, 10)) return { error: "La fecha de verificación no puede ser posterior a hoy." };
        await modificarSupuesto(s, (c) => {
          c.nombre = v.nombre.trim(); c.estadoRevision = v.estadoRevision; c.fechaVerificacion = v.fechaVerificacion;
          c.fuentes = v.fuentes.trim(); c.esPrueba = v.esPrueba === "si";
        });
      }
    });
  },
  "editar-observaciones"(b) {
    const s = supuesto(b.dataset.id);
    formulario({
      titulo: "Observaciones",
      campos: [{ nombre: "obs", etiqueta: "Observaciones profesionales generales", tipo: "textarea", filas: 10, valor: s.observaciones || "",
        ayuda: "No incluya datos personales de clientes." }],
      alGuardar: async (v) => modificarSupuesto(s, (c) => { c.observaciones = v.obs.trim(); })
    });
  },
  "nuevo-item"(b) { formItem(b.dataset.tipo, supuesto(b.dataset.id), -1); },

  "nuevo-honorario"() {
    formHonorario(null);
  },

  async subir(b) { await moverGenerico(b, -1); },
  async bajar(b) { await moverGenerico(b, 1); },

  async editar(b) {
    const { tipo } = b.dataset, i = Number(b.dataset.indice);
    if (tipo === "tramite") {
      const t = tramites()[i];
      return formulario({
        titulo: "Modificar trámite",
        campos: [{ nombre: "nombre", etiqueta: "Nombre del trámite", valor: t.nombre, requerido: true }],
        alGuardar: async (v) => S.backend.guardar("tramites", t.id, { ...t, nombre: v.nombre.trim() }, t.version ?? 0)
      });
    }
    if (tipo === "supuesto") return ACCIONES["editar-supuesto"]({ dataset: { id: supuestosDe(b.dataset.tramite)[i].id } });
    if (tipo === "honorario") return formHonorario(honorarios()[i]);
    formItem(tipo, supuesto(b.dataset.id), i);
  },

  async borrar(b) {
    const { tipo } = b.dataset, i = Number(b.dataset.indice);
    if (tipo === "tramite") {
      const t = tramites()[i];
      const hijos = supuestosDe(t.id);
      const msg = `¿Eliminar el trámite <strong>${esc(t.nombre)}</strong>?` +
        (hijos.length ? `<br><br>También se eliminarán sus ${hijos.length} ${hijos.length === 1 ? "supuesto" : "supuestos"}, con todas sus preguntas, requisitos, gastos y observaciones.` : "") +
        `<br><br>Esta acción no se puede deshacer. Le recomendamos descargar antes un respaldo.`;
      if (!(await confirmar(msg, { boton: "Eliminar", peligro: true }))) return;
      await S.backend.eliminar([...hijos.map((s) => ({ coleccion: "supuestos", id: s.id })), { coleccion: "tramites", id: t.id }]);
      return;
    }
    if (tipo === "supuesto") {
      const s = supuestosDe(b.dataset.tramite)[i];
      if (!(await confirmar(`¿Eliminar el supuesto <strong>${esc(s.nombre)}</strong> con todas sus preguntas, requisitos, gastos y observaciones?<br><br>Esta acción no se puede deshacer. Le recomendamos descargar antes un respaldo.`, { boton: "Eliminar", peligro: true }))) return;
      await S.backend.eliminar([{ coleccion: "supuestos", id: s.id }]);
      return;
    }
    if (tipo === "honorario") {
      const h = honorarios()[i];
      if (!(await confirmar(`¿Eliminar <strong>${esc(h.procedimiento)}</strong> de la lista de honorarios?`, { boton: "Eliminar", peligro: true }))) return;
      await S.backend.eliminar([{ coleccion: "honorarios", id: h.id }]);
      return;
    }
    const s = supuesto(b.dataset.id);
    const item = s[tipo][i];
    const nombre = { preguntas: "esta pregunta", requisitos: "este requisito", gastos: "este concepto de gasto" }[tipo];
    if (!(await confirmar(`¿Eliminar ${nombre}?<br><br><em>${esc(item.texto || item.concepto)}</em>`, { boton: "Eliminar", peligro: true }))) return;
    await modificarSupuesto(s, (c) => c[tipo].splice(i, 1));
  },

  exportar() {
    const blob = new Blob([JSON.stringify(construirRespaldo(S.datos), null, 2)], { type: "application/json" });
    const fecha = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `respaldo-consulta-migratoria-${fecha}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },

  importar() {
    const input = document.getElementById("archivo-respaldo");
    input.value = "";
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) return aviso("El archivo es demasiado grande para ser un respaldo de esta aplicación.", "Archivo no válido");
      let obj;
      try { obj = JSON.parse(await f.text()); }
      catch { return aviso("El archivo no se puede leer: no tiene formato JSON válido. No se ha modificado ninguna información.", "Archivo no válido"); }
      const r = validarRespaldo(obj);
      if (!r.ok) return aviso(`El archivo no supera la validación y <strong>no se ha modificado ninguna información</strong>:<ul>${r.errores.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`, "Respaldo no válido");
      const n = r.datos;
      const fechaR = obj.exportado ? fmtFecha(obj.exportado) : "fecha desconocida";
      const ok = await confirmar(`
        <p>Respaldo del ${esc(fechaR)}: ${n.tramites.length} trámites, ${n.supuestos.length} supuestos y ${n.honorarios.length} honorarios.</p>
        <p><strong>La información actual será sustituida por la del respaldo</strong> en ambos dispositivos.</p>
        <p>Antes de restaurar se descargará automáticamente una copia de la información actual, por precaución.</p>`,
        { boton: "Restaurar", peligro: true, titulo: "Restaurar respaldo" });
      if (!ok) return;
      if (!S.online) return aviso("Se perdió la conexión. No se ha modificado ninguna información.");
      ACCIONES.exportar();
      const espera = dialogo(`<div class="dlg-cuerpo"><p>Restaurando…</p><div class="cargando"></div></div>`);
      espera.dataset.ocupado = "1";
      try {
        await S.backend.reemplazarTodo(n, S.datos);
        delete espera.dataset.ocupado; espera.close();
        await aviso("La información se restauró correctamente.", "Respaldo restaurado");
      } catch (e) {
        delete espera.dataset.ocupado; espera.close();
        console.error(e);
        await aviso("La restauración no pudo completarse. Puede volver a intentarlo, o restaurar la copia descargada automáticamente antes de comenzar.", "Restauración incompleta");
      }
    };
    input.click();
  }
};

async function moverGenerico(b, delta) {
  const { tipo } = b.dataset, i = Number(b.dataset.indice);
  if (tipo === "tramite") return reordenar("tramites", tramites(), i, delta);
  if (tipo === "supuesto") return reordenar("supuestos", supuestosDe(b.dataset.tramite), i, delta);
  const s = supuesto(b.dataset.id);
  const j = i + delta;
  if (j < 0 || j >= s[tipo].length) return;
  await modificarSupuesto(s, (c) => { [c[tipo][i], c[tipo][j]] = [c[tipo][j], c[tipo][i]]; });
}

function formItem(tipo, s, i) {
  const nuevo = i < 0;
  const actual = nuevo ? {} : s[tipo][i];
  const aplicar = (item) => modificarSupuesto(s, (c) => {
    c[tipo] = c[tipo] || [];
    if (nuevo) c[tipo].push({ id: uid(), ...item }); else c[tipo][i] = { ...c[tipo][i], ...item };
  });
  if (tipo === "preguntas") {
    return formulario({
      titulo: nuevo ? "Agregar pregunta" : "Modificar pregunta",
      campos: [{ nombre: "texto", etiqueta: "Pregunta", tipo: "textarea", filas: 4, valor: actual.texto || "", requerido: true }],
      guardar: nuevo ? "Agregar" : "Guardar",
      alGuardar: async (v) => aplicar({ texto: v.texto.trim() })
    });
  }
  if (tipo === "requisitos") {
    return formulario({
      titulo: nuevo ? "Agregar requisito" : "Modificar requisito",
      campos: [
        { nombre: "texto", etiqueta: "Requisito o documento", tipo: "textarea", filas: 4, valor: actual.texto || "", requerido: true },
        { nombre: "tipo", etiqueta: "Clasificación", tipo: "select", opciones: TIPOS_REQUISITO, valor: actual.tipo || "pendiente" },
        { nombre: "circunstancia", etiqueta: "¿En qué circunstancias aplica?", tipo: "textarea", filas: 3, valor: actual.circunstancia || "", requerido: true, visibleSi: (v) => v.tipo === "condicional" },
        { nombre: "referencia", etiqueta: "Referencia oficial (opcional)", valor: actual.referencia || "", ayuda: "Artículo, lineamiento o enlace a la fuente." }
      ],
      guardar: nuevo ? "Agregar" : "Guardar",
      alGuardar: async (v) => aplicar({ texto: v.texto.trim(), tipo: v.tipo, circunstancia: v.tipo === "condicional" ? v.circunstancia.trim() : "", referencia: v.referencia.trim() })
    });
  }
  return formulario({
    titulo: nuevo ? "Agregar concepto de gasto" : "Modificar concepto de gasto",
    campos: [
      { nombre: "concepto", etiqueta: "Nombre del concepto", valor: actual.concepto || "", requerido: true },
      { nombre: "importe", etiqueta: "Importe", tipo: "number", valor: actual.importe ?? "", ayuda: "Déjelo vacío si no está verificado. Nunca registre importes no comprobados." },
      { nombre: "moneda", etiqueta: "Moneda", valor: actual.moneda || "MXN", requerido: true },
      { nombre: "fuente", etiqueta: "Fuente oficial", valor: actual.fuente || "" },
      { nombre: "enlace", etiqueta: "Enlace a la fuente", tipo: "url", valor: actual.enlace || "" },
      { nombre: "fechaVerificacion", etiqueta: "Fecha de verificación", tipo: "date", valor: actual.fechaVerificacion || "" },
      { nombre: "estado", etiqueta: "Estado", tipo: "select", opciones: ESTADOS_GASTO, valor: actual.estado || "pendiente" }
    ],
    guardar: nuevo ? "Agregar" : "Guardar",
    alGuardar: async (v) => {
      const imp = String(v.importe).trim() === "" ? null : Number(String(v.importe).replace(",", "."));
      if (imp !== null && (!isFinite(imp) || imp < 0)) return { error: "El importe no es válido." };
      const moneda = v.moneda.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(moneda)) return { error: "La moneda debe indicarse con su código de tres letras (por ejemplo, MXN)." };
      if (v.enlace.trim() && !enlaceSeguro(v.enlace)) return { error: "El enlace debe comenzar por https:// o http://." };
      if (v.estado === "verificado" && (imp === null || !v.fuente.trim() || !v.fechaVerificacion))
        return { error: "Para marcar el concepto como verificado, registre el importe, la fuente oficial y la fecha de verificación." };
      await aplicar({ concepto: v.concepto.trim(), importe: imp, moneda, fuente: v.fuente.trim(), enlace: v.enlace.trim(), fechaVerificacion: v.fechaVerificacion, estado: imp === null ? "pendiente" : v.estado });
    }
  });
}

function formHonorario(h) {
  formulario({
    titulo: h ? "Modificar honorarios" : "Agregar procedimiento",
    campos: [
      { nombre: "procedimiento", etiqueta: "Nombre del procedimiento", valor: h ? h.procedimiento : "", requerido: true },
      { nombre: "importe", etiqueta: "Honorarios en MXN", tipo: "number", valor: h && h.importe !== null ? h.importe : "", ayuda: "Déjelo vacío para mostrar «Sin definir»." }
    ],
    guardar: h ? "Guardar" : "Agregar",
    alGuardar: async (v) => {
      const imp = String(v.importe).trim() === "" ? null : Number(String(v.importe).replace(",", "."));
      if (imp !== null && (!isFinite(imp) || imp < 0)) return { error: "El importe no es válido." };
      if (h) await S.backend.guardar("honorarios", h.id, { ...h, procedimiento: v.procedimiento.trim(), importe: imp }, h.version ?? 0);
      else await S.backend.guardar("honorarios", S.backend.nuevoId("honorarios"), { procedimiento: v.procedimiento.trim(), importe: imp, orden: honorarios().length + 1 }, null);
    }
  });
}

// ---------------------------------------------------------------- Arranque
function actualizarConexion() {
  S.online = navigator.onLine;
  if (!S.online) S.edicion = false;
  render();
}
window.addEventListener("online", actualizarConexion);
window.addEventListener("offline", actualizarConexion);
window.addEventListener("hashchange", () => { if (S.usuario && desbloqueado()) renderApp(); });

export async function iniciar(fabricaBackend) {
  render();
  try {
    S.backend = await fabricaBackend();
  } catch (e) {
    console.error(e);
    return pantallaAcceso(`<h1>No se pudo abrir</h1><p>${S.online ? "Ocurrió un error al cargar la aplicación. Cierre y vuelva a abrirla." : "Este dispositivo aún no tiene la aplicación preparada para usarse sin conexión. Ábrala una vez con internet."}</p>`);
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  S.backend.onAuth((u) => {
    S.usuario = u;
    if (cancelarSuscripcion) { cancelarSuscripcion(); cancelarSuscripcion = null; }
    S.datos = null;
    if (!u) { ses.del("cmm_desbloqueado"); S.edicion = false; render(); return; }
    cancelarSuscripcion = S.backend.suscribir(async (d) => {
      S.datos = d;
      if (d.cargado && d.appConfirmada && !d.app && S.online && !semillaIntentada) {
        semillaIntentada = true;
        try { await S.backend.inicializarSiHaceFalta(crearSemilla()); } catch (e) { console.error("semilla", e); semillaIntentada = false; }
      }
      // Evita redibujar mientras hay un formulario abierto (los datos se actualizan al cerrarlo).
      if (document.querySelector("dialog[open]")) { aplazado = true; return; }
      render();
    });
    render();
  });
}
let aplazado = false;
document.addEventListener("close", () => { if (aplazado) { aplazado = false; setTimeout(render, 0); } }, true);
