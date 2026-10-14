"""Pruebas funcionales de la interfaz con datos de prueba (sin Firebase).
Uso: python3 -I tests/pruebas.py  (con un servidor local en el puerto 8765 sirviendo la carpeta del proyecto)"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8765/tests/prueba.html"
SALIDA = sys.argv[1] if len(sys.argv) > 1 else "/tmp/capturas"
os.makedirs(SALIDA, exist_ok=True)
resultados = []

def prueba(nombre, fn):
    try:
        fn(); resultados.append(("SUPERADA", nombre, ""))
    except Exception as e:
        resultados.append(("FALLIDA", nombre, str(e)[:300]))

def pin(page, digitos):
    for d in digitos:
        page.click(f'[data-digito="{d}"]')
    page.wait_for_timeout(1500)

with sync_playwright() as p:
    nav = p.chromium.launch()
    ctx = nav.new_context(viewport={"width": 390, "height": 844}, accept_downloads=True, device_scale_factor=2)
    page = ctx.new_page()
    errores_js = []
    page.on("pageerror", lambda e: errores_js.append(str(e)))
    page.goto(URL)
    page.evaluate("localStorage.clear(); sessionStorage.clear()")
    page.reload()

    def acceso_inicial():
        page.click('[data-accion="google"]')
        page.wait_for_selector("text=Cree su PIN")
        page.screenshot(path=f"{SALIDA}/01-crear-pin.png")
        pin(page, "1234567")
        page.wait_for_selector("text=Confirme el PIN")
        pin(page, "1234567")
        page.wait_for_selector("text=Biblioteca de consulta")
        bd = page.evaluate("JSON.parse(localStorage.getItem('cmm_prueba_bd'))")
        seg = bd["config"]["seguridad"]
        assert "1234567" not in json.dumps(seg), "El PIN aparece en texto plano"
        assert seg["algoritmo"] == "PBKDF2-SHA256"
        page.screenshot(path=f"{SALIDA}/02-inicio.png")
    prueba("Acceso inicial: crear PIN de 7 dígitos (se guarda solo la huella)", acceso_inicial)

    def contenido_inicial():
        page.click("text=Consultas migratorias")
        for t in ["Residencia temporal", "Residencia permanente", "Renovación de tarjeta de residencia", "Naturalización mexicana"]:
            page.wait_for_selector(f".fila-nombre:has-text('{t}')")
        page.screenshot(path=f"{SALIDA}/03-tramites.png")
    prueba("Cuatro trámites iniciales visibles", contenido_inicial)

    def ficha():
        page.click(".fila-nombre:has-text('Residencia temporal')")
        page.click("text=Supuesto de prueba")
        page.wait_for_selector(".aviso-prueba")
        assert page.is_visible("text=Pendiente de verificar")
        for pest in ["Requisitos", "Gastos", "Observaciones", "Preguntas"]:
            page.click(f".pestana:has-text('{pest}')")
            page.wait_for_selector(".panel-titulo")
        page.screenshot(path=f"{SALIDA}/04-ficha-preguntas.png", full_page=True)
        page.click(".pestana:has-text('Requisitos')")
        page.wait_for_selector("text=Aplica cuando:")
        page.screenshot(path=f"{SALIDA}/05-ficha-requisitos.png", full_page=True)
        page.click(".pestana:has-text('Gastos')")
        page.wait_for_selector("text=Importe pendiente de verificar")
        page.screenshot(path=f"{SALIDA}/06-ficha-gastos.png", full_page=True)
    prueba("Ficha con los cuatro apartados y estado pendiente de verificar", ficha)

    def modo_consulta_sin_controles():
        assert page.locator('[data-accion="editar"]').count() == 0
        assert page.locator('[data-accion="nuevo-item"]').count() == 0
    prueba("Modo consulta no muestra controles de edición", modo_consulta_sin_controles)

    def editar_pregunta():
        page.click(".pestana:has-text('Preguntas')")
        page.click('[data-accion="modo"]')
        page.click('[data-accion="nuevo-item"]')
        page.fill('textarea[name="texto"]', "¿Cuenta con oferta de empleo? (prueba)")
        page.click("dialog button[type=submit]")
        page.wait_for_selector("text=¿Cuenta con oferta de empleo? (prueba)")
        # Mover la nueva pregunta (última) hacia arriba
        n = page.locator(".items .item").count()
        page.locator('[data-accion="subir"]').nth(n - 1).click()
        page.wait_for_timeout(300)
        textos = page.locator(".items .item .item-texto").all_inner_texts()
        assert "oferta de empleo" in textos[n - 2], textos
        page.screenshot(path=f"{SALIDA}/07-edicion.png", full_page=True)
    prueba("Agregar y reordenar una pregunta en modo edición", editar_pregunta)

    def requisito_condicional():
        page.click(".pestana:has-text('Requisitos')")
        page.click('[data-accion="nuevo-item"]')
        page.select_option('select[name="tipo"]', "condicional")
        page.fill('textarea[name="texto"]', "Documento de prueba condicional")
        page.click("dialog button[type=submit]")
        assert page.is_visible("dialog .error"), "Debía exigir la circunstancia"
        page.fill('textarea[name="circunstancia"]', "Cuando aplique (prueba)")
        page.click("dialog button[type=submit]")
        page.wait_for_selector("text=Documento de prueba condicional")
    prueba("Requisito condicional exige indicar la circunstancia", requisito_condicional)

    def gasto_validacion():
        page.click(".pestana:has-text('Gastos')")
        page.click('[data-accion="nuevo-item"]')
        page.fill('input[name="concepto"]', "Derecho de prueba")
        page.select_option('select[name="estado"]', "verificado")
        page.click("dialog button[type=submit]")
        assert page.is_visible("dialog .error"), "No debía permitir 'verificado' sin importe, fuente y fecha"
        page.fill('input[name="importe"]', "1234.5")
        page.fill('input[name="fuente"]', "Fuente de prueba")
        page.fill('input[name="fechaVerificacion"]', "2026-10-01")
        page.click("dialog button[type=submit]")
        page.wait_for_selector("text=$1,234.50")
        assert page.locator("text=Total").count() == 0
    prueba("Gasto: no se marca verificado sin importe, fuente y fecha; sin totales", gasto_validacion)

    def vigencia():
        page.click('[data-accion="editar-supuesto"]')
        page.fill('input[name="fechaVerificacion"]', "2025-01-15")
        page.select_option('select[name="estadoRevision"]', "aprobado")
        page.click("dialog button[type=submit]")
        page.wait_for_selector(".aviso-vigencia")
        assert page.is_visible(".insignia.ok")
        page.screenshot(path=f"{SALIDA}/08-vigencia.png")
        page.click('[data-accion="editar-supuesto"]')
        page.fill('input[name="fechaVerificacion"]', "2026-09-01")
        page.click("dialog button[type=submit]")
        page.wait_for_timeout(300)
        assert page.locator(".aviso-vigencia").count() == 0
    prueba("Aviso de vigencia tras seis meses y estado Aprobado", vigencia)

    def conflicto():
        # Simula que el otro dispositivo modificó el supuesto mientras este editaba.
        page.click(".pestana:has-text('Observaciones')")
        page.click('[data-accion="editar-observaciones"]')
        page.evaluate("""() => { const b = window.__bdPrueba.leer(); b.supuestos['s-prueba'].version += 1;
            b.supuestos['s-prueba'].observaciones = 'Texto escrito en la tableta'; window.__bdPrueba.escribir(b); }""")
        page.fill('textarea[name="obs"]', "Texto escrito en el teléfono")
        page.click("dialog button[type=submit]")
        page.wait_for_selector("text=Cambio no guardado")
        page.screenshot(path=f"{SALIDA}/09-conflicto.png")
        page.click("text=Entendido")
        bd = page.evaluate("window.__bdPrueba.leer()")
        assert bd["supuestos"]["s-prueba"]["observaciones"] == "Texto escrito en la tableta"
    prueba("Evita sobrescrituras silenciosas (conflicto entre dispositivos)", conflicto)

    def honorarios():
        page.goto(URL + "#/honorarios")
        page.wait_for_selector("text=Sin definir")
        page.locator('[data-accion="editar"][data-tipo="honorario"]').first.click()
        page.fill('input[name="importe"]', "15000")
        page.click("dialog button[type=submit]")
        page.wait_for_selector("text=$15,000.00")
        page.click('[data-accion="nuevo-honorario"]')
        page.fill('input[name="procedimiento"]', "Procedimiento de prueba")
        page.click("dialog button[type=submit]")
        page.wait_for_selector("td:has-text('Procedimiento de prueba')")
        page.locator('[data-accion="borrar"][data-tipo="honorario"]').last.click()
        page.click("dialog button[value=si]")
        page.wait_for_timeout(300)
        assert page.locator("td:has-text('Procedimiento de prueba')").count() == 0
        page.screenshot(path=f"{SALIDA}/10-honorarios.png")
    prueba("Honorarios: modificar importe, agregar y eliminar (con confirmación)", honorarios)

    def busqueda():
        page.goto(URL + "#/")
        page.fill('input[name="q"]', "naturalizacion")
        page.wait_for_selector(".resultados")
        assert page.is_visible("text=Naturalización mexicana")
        page.fill('input[name="q"]', "oferta empleo")
        page.wait_for_selector(".res-tipo:has-text('Pregunta')")
        page.screenshot(path=f"{SALIDA}/11-busqueda.png")
        page.click(".resultados a")
        page.wait_for_selector(".pestana.activa:has-text('Preguntas')")
    prueba("Buscador (sin acentos, varias palabras) abre la ficha relacionada", busqueda)

    def persistencia():
        page.reload()
        page.wait_for_selector(".panel-titulo")  # misma sesión: no pide PIN
        assert page.locator(".teclado").count() == 0
        assert page.is_visible("text=¿Cuenta con oferta de empleo? (prueba)")
    prueba("Conserva cambios y la sesión al recargar (no pide PIN)", persistencia)

    def respaldo():
        page.goto(URL + "#/ajustes")
        with page.expect_download() as d:
            page.click('[data-accion="exportar"]')
        ruta = f"{SALIDA}/respaldo.json"; d.value.save_as(ruta)
        datos = json.load(open(ruta))
        assert datos["formato"] == "consulta-migratoria-mexico"
        assert len(datos["tramites"]) == 4 and len(datos["honorarios"]) == 4
        assert "seguridad" not in json.dumps(datos)
        s = datos["supuestos"][0]
        assert s["estadoRevision"] == "aprobado" and s["fechaVerificacion"]
        # Archivo incorrecto: no debe modificar nada
        malo = f"{SALIDA}/malo.json"; json.dump({"formato": "otro"}, open(malo, "w"))
        with page.expect_file_chooser() as fc:
            page.click('[data-accion="importar"]')
        fc.value.set_files(malo)
        page.wait_for_selector("text=no se ha modificado ninguna información")
        page.click("text=Entendido")
        # Restaurar el respaldo tras borrar un trámite
        page.evaluate("""() => { const b = window.__bdPrueba.leer(); delete b.tramites['t-naturalizacion']; window.__bdPrueba.escribir(b); window.__bdPrueba.emitir(); }""")
        with page.expect_file_chooser() as fc:
            page.click('[data-accion="importar"]')
        fc.value.set_files(ruta)
        page.wait_for_selector("text=será sustituida")
        page.screenshot(path=f"{SALIDA}/12-restaurar.png")
        with page.expect_download():
            page.click("dialog button[value=si]")
        page.wait_for_selector("text=se restauró correctamente")
        page.click("text=Entendido")
        assert "t-naturalizacion" in page.evaluate("window.__bdPrueba.leer()")["tramites"]
    prueba("Respaldo: exportar, rechazar archivo incorrecto y restaurar con confirmación", respaldo)

    def offline():
        page.goto(URL + "#/consultas")
        ctx.set_offline(True)
        page.wait_for_selector(".sin-linea")
        assert page.is_disabled('[data-accion="modo"]')
        assert page.locator('[data-accion="editar"]').count() == 0
        page.fill('input[name="q"]', "prueba")
        page.wait_for_selector(".resultados")
        page.screenshot(path=f"{SALIDA}/13-sin-conexion.png")
        ctx.set_offline(False)
        page.wait_for_function("!document.querySelector('.sin-linea')")
    prueba("Sin conexión: indicador visible, edición deshabilitada, búsqueda disponible (simulado en navegador)", offline)

    def eliminar_tramite():
        page.goto(URL + "#/consultas")
        page.click('[data-accion="modo"]')
        page.click('[data-accion="nuevo-tramite"]')
        page.fill('input[name="nombre"]', "Trámite de prueba")
        page.click("dialog button[type=submit]")
        page.wait_for_selector(".fila-nombre:has-text('Trámite de prueba')")
        page.locator('[data-accion="borrar"][data-tipo="tramite"]').last.click()
        page.wait_for_selector("text=no se puede deshacer")
        page.click("dialog button[value=si]")
        page.wait_for_timeout(300)
        assert page.locator(".fila-nombre:has-text('Trámite de prueba')").count() == 0
        page.click('[data-accion="modo"]')
    prueba("Agregar y eliminar trámite con confirmación", eliminar_tramite)

    def nueva_sesion_pide_pin():
        ctx2_page = ctx.new_page()  # pestaña nueva = sesión nueva
        ctx2_page.goto(URL)
        ctx2_page.wait_for_selector("text=Introduzca su PIN")
        ctx2_page.close()
    prueba("Una sesión nueva pide el PIN", nueva_sesion_pide_pin)

    def intentos():
        pg = ctx.new_page(); pg.goto(URL); pg.wait_for_selector(".teclado")
        for i in range(5):
            pin(pg, "7654321")
        assert pg.is_visible("text=Espere 30 segundos"), pg.inner_text(".pin-error")
        pg.screenshot(path=f"{SALIDA}/14-espera.png")
        # Saltar la espera y llegar a 10 fallos
        for i in range(5):
            pg.evaluate("const v=JSON.parse(localStorage.getItem('cmm_intentos_pin')); v.bloqueadoHasta=0; localStorage.setItem('cmm_intentos_pin', JSON.stringify(v))")
            pin(pg, "7654321")
        pg.wait_for_selector("text=Acceso bloqueado")
        pg.click("text=Entendido")
        pg.wait_for_selector("text=Continuar con Google")
        pg.close()
    prueba("PIN incorrecto: espera tras 5 intentos y cierre de sesión tras 10", intentos)

    def recuperacion():
        pg = ctx.new_page(); pg.goto(URL)
        pg.click('[data-accion="google"]')
        pg.wait_for_selector("text=Introduzca su PIN")
        pg.click('[data-accion="olvide-pin"]')
        pg.click("dialog button[value=si]")
        pg.wait_for_selector("text=Recuperar el acceso")
        pg.click('[data-accion="google"]')
        pg.wait_for_selector("text=Cree un PIN nuevo")
        pin(pg, "2468024"); pin(pg, "2468024")
        pg.wait_for_selector("text=Biblioteca de consulta")
        pg2 = ctx.new_page(); pg2.goto(URL); pg2.wait_for_selector(".teclado")
        pin(pg2, "2468024")
        pg2.wait_for_selector("text=Biblioteca de consulta")
        pg.close(); pg2.close()
    prueba("Recuperación: identificarse con Google y crear PIN nuevo", recuperacion)

    # Capturas en tamaño tableta
    tab = nav.new_context(viewport={"width": 1000, "height": 1300}, device_scale_factor=1.5)
    tp = tab.new_page()
    estado = ctx.storage_state()
    tp.goto(URL)
    tp.evaluate("([o]) => { for (const [k,v] of o) localStorage.setItem(k,v); sessionStorage.setItem('cmm_desbloqueado','1'); }",
                [[(i["name"], i["value"]) for i in estado["origins"][0]["localStorage"]]])
    tp.goto(URL + "#/supuesto/s-prueba/requisitos"); tp.reload()
    tp.wait_for_selector(".panel-titulo")
    tp.screenshot(path=f"{SALIDA}/15-tableta-ficha.png", full_page=True)
    tp.goto(URL + "#/"); tp.wait_for_selector(".accesos")
    tp.screenshot(path=f"{SALIDA}/16-tableta-inicio.png")

    nav.close()

for estado, nombre, det in resultados:
    print(f"{estado:9} {nombre}" + (f"\n          → {det}" if det else ""))
print("Errores JavaScript:", errores_js or "ninguno")
