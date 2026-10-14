// Reglas de contenido: contenido inicial, búsqueda, vigencia y validación de respaldos.

export const FORMATO_RESPALDO = "consulta-migratoria-mexico";
export const ESQUEMA = 1;
export const TIPOS_REQUISITO = {
  obligatorio: "Obligatorio",
  condicional: "Condicional",
  pendiente: "Pendiente de verificar"
};
export const ESTADOS_REVISION = {
  borrador: "Borrador pendiente de aprobación",
  aprobado: "Aprobado"
};
export const ESTADOS_GASTO = { verificado: "Verificado", pendiente: "Pendiente de verificar" };

export const uid = () =>
  "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Contenido inicial: las cuatro categorías indicadas por la usuaria, la lista de honorarios
// "Sin definir" y un único supuesto DE PRUEBA con datos ficticios para comprobar las funciones.
export function crearSemilla() {
  const t = [
    { id: "t-residencia-temporal", nombre: "Residencia temporal", orden: 1 },
    { id: "t-residencia-permanente", nombre: "Residencia permanente", orden: 2 },
    { id: "t-renovacion-tarjeta", nombre: "Renovación de tarjeta de residencia", orden: 3 },
    { id: "t-naturalizacion", nombre: "Naturalización mexicana", orden: 4 }
  ];
  const prueba = {
    id: "s-prueba",
    tramiteId: "t-residencia-temporal",
    nombre: "Supuesto de prueba (datos ficticios)",
    orden: 1,
    esPrueba: true,
    estadoRevision: "borrador",
    fechaVerificacion: "",
    fuentes: "",
    preguntas: [
      { id: uid(), texto: "Pregunta de prueba 1: dato ficticio para comprobar la lista de preguntas." },
      { id: uid(), texto: "Pregunta de prueba 2: dato ficticio para comprobar el orden y la edición." }
    ],
    requisitos: [
      { id: uid(), texto: "Requisito de prueba A (ficticio).", tipo: "obligatorio", circunstancia: "", referencia: "" },
      { id: uid(), texto: "Requisito de prueba B (ficticio).", tipo: "condicional", circunstancia: "Circunstancia de prueba (ficticia).", referencia: "" },
      { id: uid(), texto: "Requisito de prueba C (ficticio).", tipo: "pendiente", circunstancia: "", referencia: "" }
    ],
    gastos: [
      { id: uid(), concepto: "Concepto de prueba (ficticio)", importe: null, moneda: "MXN", fuente: "", enlace: "", fechaVerificacion: "", estado: "pendiente" }
    ],
    observaciones: "Texto de prueba. Este supuesto existe solo para comprobar el funcionamiento de la aplicación y no contiene información jurídica real. Puede eliminarlo cuando la aplicación quede validada."
  };
  const h = [
    { id: "h-residencia-temporal", procedimiento: "Residencia temporal", importe: null, orden: 1 },
    { id: "h-residencia-permanente", procedimiento: "Residencia permanente", importe: null, orden: 2 },
    { id: "h-renovacion", procedimiento: "Renovación de residencia", importe: null, orden: 3 },
    { id: "h-naturalizacion", procedimiento: "Naturalización mexicana", importe: null, orden: 4 }
  ];
  return { tramites: t, supuestos: [prueba], honorarios: h };
}

export const porOrden = (a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.nombre || a.procedimiento || "").localeCompare(String(b.nombre || b.procedimiento || ""), "es");

export function normalizar(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ---- Vigencia ----
export function estadoVigencia(fechaISO, hoy = new Date()) {
  if (!fechaISO) return { tipo: "nunca" };
  const f = new Date(fechaISO + "T12:00:00");
  if (isNaN(f)) return { tipo: "nunca" };
  const limite = new Date(f);
  limite.setMonth(limite.getMonth() + 6);
  return { tipo: hoy >= limite ? "revisar" : "vigente", fecha: f };
}

// ---- Búsqueda local (funciona sin conexión) ----
export function buscar(consulta, { tramites, supuestos }) {
  const q = normalizar(consulta).trim();
  if (q.length < 2) return [];
  const terminos = q.split(/\s+/).filter(Boolean);
  const coincide = (txt) => { const n = normalizar(txt); return terminos.every((t) => n.includes(t)); };
  const tPorId = Object.fromEntries(tramites.map((t) => [t.id, t]));
  const res = [];
  tramites.forEach((t) => { if (coincide(t.nombre)) res.push({ tipo: "Trámite", texto: t.nombre, ruta: `#/tramite/${t.id}` }); });
  supuestos.forEach((s) => {
    const tr = tPorId[s.tramiteId];
    const ctx = `${tr ? tr.nombre : "Sin trámite"} › ${s.nombre}`;
    if (coincide(s.nombre)) res.push({ tipo: "Supuesto", texto: s.nombre, contexto: tr ? tr.nombre : "", ruta: `#/supuesto/${s.id}` });
    (s.preguntas || []).forEach((p) => { if (coincide(p.texto)) res.push({ tipo: "Pregunta", texto: p.texto, contexto: ctx, ruta: `#/supuesto/${s.id}/preguntas` }); });
    (s.requisitos || []).forEach((r) => {
      if (coincide(`${r.texto} ${r.circunstancia || ""}`)) res.push({ tipo: "Requisito", texto: r.texto, contexto: ctx, ruta: `#/supuesto/${s.id}/requisitos` });
    });
    if (s.observaciones && coincide(s.observaciones)) res.push({ tipo: "Observaciones", texto: extracto(s.observaciones, terminos[0]), contexto: ctx, ruta: `#/supuesto/${s.id}/observaciones` });
  });
  return res;
}

function extracto(texto, termino) {
  const n = normalizar(texto);
  const i = Math.max(0, n.indexOf(termino) - 60);
  const s = texto.slice(i, i + 180);
  return (i > 0 ? "…" : "") + s + (i + 180 < texto.length ? "…" : "");
}

// ---- Respaldos ----
export function construirRespaldo({ tramites, supuestos, honorarios }) {
  const limpiar = (x) => { const { version, actualizado, ...resto } = x; return resto; };
  return {
    formato: FORMATO_RESPALDO,
    esquema: ESQUEMA,
    exportado: new Date().toISOString(),
    tramites: tramites.map(limpiar),
    supuestos: supuestos.map(limpiar),
    honorarios: honorarios.map(limpiar)
  };
}

const esTexto = (v) => typeof v === "string";
const esTextoOpc = (v) => v === undefined || v === null || typeof v === "string";
const esImporte = (v) => v === null || v === undefined || (typeof v === "number" && isFinite(v) && v >= 0);

// Devuelve { ok, errores[], datos } — datos normalizados listos para guardar.
export function validarRespaldo(obj) {
  const errores = [];
  const err = (m) => { if (errores.length < 12) errores.push(m); };
  if (!obj || typeof obj !== "object") return { ok: false, errores: ["El archivo no contiene datos válidos."] };
  if (obj.formato !== FORMATO_RESPALDO) err("El archivo no es un respaldo de esta aplicación.");
  if (obj.esquema !== ESQUEMA) err("La versión del respaldo no es compatible.");
  for (const k of ["tramites", "supuestos", "honorarios"]) if (!Array.isArray(obj[k])) err(`Falta la lista «${k}».`);
  if (errores.length) return { ok: false, errores };

  const ids = new Set();
  const idValido = (id, donde) => {
    if (!esTexto(id) || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) { err(`Identificador no válido en ${donde}.`); return false; }
    if (ids.has(id)) { err(`Identificador repetido en ${donde}: ${id}.`); return false; }
    ids.add(id); return true;
  };
  const tramites = obj.tramites.map((t, i) => {
    idValido(t && t.id, `trámite ${i + 1}`);
    if (!t || !esTexto(t.nombre) || !t.nombre.trim()) err(`El trámite ${i + 1} no tiene nombre.`);
    return { id: t.id, nombre: String(t.nombre || "").trim(), orden: Number(t.orden) || i + 1 };
  });
  const idsTramites = new Set(tramites.map((t) => t.id));
  const supuestos = obj.supuestos.map((s, i) => {
    const donde = `supuesto ${i + 1}`;
    idValido(s && s.id, donde);
    if (!s || !esTexto(s.nombre) || !s.nombre.trim()) err(`El ${donde} no tiene nombre.`);
    if (!s || !idsTramites.has(s.tramiteId)) err(`El ${donde} pertenece a un trámite inexistente.`);
    if (s && s.estadoRevision && !ESTADOS_REVISION[s.estadoRevision]) err(`Estado de revisión no válido en ${donde}.`);
    if (s && s.fechaVerificacion && !/^\d{4}-\d{2}-\d{2}$/.test(s.fechaVerificacion)) err(`Fecha de verificación no válida en ${donde}.`);
    for (const k of ["preguntas", "requisitos", "gastos"]) if (s && s[k] !== undefined && !Array.isArray(s[k])) err(`La lista «${k}» del ${donde} no es válida.`);
    if (s && !esTextoOpc(s.observaciones)) err(`Las observaciones del ${donde} no son válidas.`);
    if (s && !esTextoOpc(s.fuentes)) err(`Las fuentes del ${donde} no son válidas.`);
    const preguntas = ((s && s.preguntas) || []).map((p, j) => {
      if (!p || !esTexto(p.texto)) err(`Pregunta ${j + 1} del ${donde} no válida.`);
      return { id: (p && esTexto(p.id) && p.id) || uid(), texto: String((p && p.texto) || "") };
    });
    const requisitos = ((s && s.requisitos) || []).map((r, j) => {
      if (!r || !esTexto(r.texto)) err(`Requisito ${j + 1} del ${donde} no válido.`);
      if (r && !TIPOS_REQUISITO[r.tipo]) err(`Clasificación no válida en el requisito ${j + 1} del ${donde}.`);
      if (r && (!esTextoOpc(r.circunstancia) || !esTextoOpc(r.referencia))) err(`Datos no válidos en el requisito ${j + 1} del ${donde}.`);
      return { id: (r && esTexto(r.id) && r.id) || uid(), texto: String((r && r.texto) || ""), tipo: r && r.tipo, circunstancia: (r && r.circunstancia) || "", referencia: (r && r.referencia) || "" };
    });
    const gastos = ((s && s.gastos) || []).map((g, j) => {
      if (!g || !esTexto(g.concepto)) err(`Gasto ${j + 1} del ${donde} no válido.`);
      if (g && !esImporte(g.importe)) err(`Importe no válido en el gasto ${j + 1} del ${donde}.`);
      if (g && g.estado && !ESTADOS_GASTO[g.estado]) err(`Estado no válido en el gasto ${j + 1} del ${donde}.`);
      if (g && g.fechaVerificacion && !/^\d{4}-\d{2}-\d{2}$/.test(g.fechaVerificacion)) err(`Fecha no válida en el gasto ${j + 1} del ${donde}.`);
      if (g && (!esTextoOpc(g.fuente) || !esTextoOpc(g.enlace) || !esTextoOpc(g.moneda))) err(`Datos no válidos en el gasto ${j + 1} del ${donde}.`);
      const importe = g && typeof g.importe === "number" ? g.importe : null;
      return { id: (g && esTexto(g.id) && g.id) || uid(), concepto: String((g && g.concepto) || ""), importe,
        moneda: (g && g.moneda) || "MXN", fuente: (g && g.fuente) || "", enlace: (g && g.enlace) || "",
        fechaVerificacion: (g && g.fechaVerificacion) || "", estado: importe === null ? "pendiente" : ((g && g.estado) || "pendiente") };
    });
    return { id: s && s.id, tramiteId: s && s.tramiteId, nombre: String((s && s.nombre) || "").trim(), orden: Number(s && s.orden) || i + 1,
      esPrueba: Boolean(s && s.esPrueba), estadoRevision: (s && s.estadoRevision) || "borrador",
      fechaVerificacion: (s && s.fechaVerificacion) || "", fuentes: (s && s.fuentes) || "",
      preguntas, requisitos, gastos, observaciones: (s && s.observaciones) || "" };
  });
  const honorarios = obj.honorarios.map((h, i) => {
    idValido(h && h.id, `honorario ${i + 1}`);
    if (!h || !esTexto(h.procedimiento) || !h.procedimiento.trim()) err(`El honorario ${i + 1} no tiene procedimiento.`);
    if (h && !esImporte(h.importe)) err(`Importe no válido en el honorario ${i + 1}.`);
    return { id: h && h.id, procedimiento: String((h && h.procedimiento) || "").trim(), importe: h && typeof h.importe === "number" ? h.importe : null, orden: Number(h && h.orden) || i + 1 };
  });
  if (errores.length) return { ok: false, errores };
  return { ok: true, errores: [], datos: { tramites, supuestos, honorarios } };
}
