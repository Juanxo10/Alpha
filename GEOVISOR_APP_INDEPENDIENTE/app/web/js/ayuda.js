/* ==========================================================================
   Ayuda integrada: guía rápida de cada módulo. Abre en la sección de la vista actual.
   ========================================================================== */
"use strict";

const AYUDA = [
  ["inicio", "Primeros pasos", `
    <ol><li>En <b>⚙ Configuración</b> complete los datos del vendedor (salen en recibos, contratos e informes), la cuenta bancaria y las reglas de cartera.</li>
    <li>En <b>Administración → Usuarios</b> cree un usuario para cada persona de la oficina. Nadie debe usar la cuenta de otro.</li>
    <li>Asigne los <b>precios de lista</b> (⚙ → Respaldos y red → Asignar precios por manzana, o lote por lote).</li>
    <li>Defina una <b>carpeta de respaldo</b> en Google Drive o una USB: la base se copia allí todos los días.</li></ol>`],
  ["mapa", "Mapa y ficha del lote", `
    <p>Toque un lote para ver su <b>tarjeta</b>; el botón <b>Ficha</b> abre la ficha completa con el plan de pagos, los pagos, la cobranza, los documentos y el historial.</p>
    <p>Arriba a la izquierda se cambia la lectura del mapa: <b>estado comercial</b>, <b>cartera</b> (mora por edad) o <b>avance de pago</b>. Con el buscador se encuentra un lote por código, comprador o documento.</p>`],
  ["ventas", "Separar y vender", `
    <p><b>Separar</b> aparta el lote con un abono y una fecha límite. <b>Vender</b> registra el valor, la cuota inicial y el número de cuotas: el plan de pagos se genera solo.</p>
    <p>Si la venta lleva comisionista se elige en el mismo formulario. Un operador puede vender a precio de lista; si da un <b>descuento</b> mayor al permitido o cambia el % de comisión, la venta queda <b>pendiente de aprobación</b>.</p>`],
  ["pagos", "Pagos, recibos y abonos a capital", `
    <p>Cada pago se registra desde la ficha del lote y genera un <b>recibo de caja</b> con consecutivo y valor en letras. Los pagos se aplican en orden: primero la cuota inicial y después las cuotas más antiguas.</p>
    <p>Para un <b>abono a capital</b> elija ese concepto y si quiere <b>acortar el plazo</b> o <b>bajar la cuota</b>. Para cambiar el plan por un acuerdo, use <b>Reestructurar plan</b> en la ficha. El plan anterior queda en el historial.</p>
    <p>Un recibo nunca se borra: se <b>anula</b> con motivo (requiere aprobación de un dueño) y conserva su número.</p>`],
  ["cobranza", "Cobranza", `
    <p><b>Cartera → Cobranza</b> muestra a quién cobrar: cuotas vencidas (por días de mora), separaciones por vencer y cuotas próximas.</p>
    <p>Con un clic se abre <b>WhatsApp</b> con el mensaje ya redactado o se registra una <b>gestión</b> (llamada, visita…) con el <b>compromiso de pago</b>. Los compromisos incumplidos se marcan en rojo.</p>
`],
  ["documentos", "Documentos y expediente", `
    <p>En la ficha del lote, pestaña <b>Documentos</b>: <b>ficha integral</b>, <b>estado de cuenta</b>, <b>promesa de compraventa</b>, <b>certificado de pagos</b> y <b>paz y salvo</b> (solo con saldo $0), todos en PDF.</p>
    <p>En el <b>expediente</b> se suben la cédula, la promesa firmada, los comprobantes y la escritura. Cada archivo guarda su huella: si alguien lo cambia, el sistema lo detecta.</p>
    <p>La promesa se arma con los datos del negocio y los linderos. Hágala revisar por su abogado la primera vez y ajuste en ⚙ la cláusula penal, la notaría y el plazo.</p>`],
  ["comercial", "Prospectos y comisionistas", `
    <p><b>Prospectos</b>: registre a cada interesado, su origen y el próximo seguimiento. Desde su ficha se le <b>cotiza</b> un lote (PDF con plan de pagos) o se <b>convierte en venta</b>.</p>
    <p><b>Comisionistas</b>: cada uno con su % y su regla de causación. Se le paga solo lo causado, con <b>comprobante de egreso</b> y retención.</p>`],
  ["finanzas", "Gastos, flujo de caja y conciliación", `
    <p><b>Gastos</b>: todo egreso con comprobante de egreso (CE) consecutivo. Cargue el <b>presupuesto</b> de obra por categoría para controlar lo ejecutado.</p>
    <p><b>Flujo de caja</b>: ingresos y egresos por mes, recaudo esperado según los planes de pago y el <b>resultado proyectado</b> del proyecto.</p>
    <p><b>Conciliación</b>: descargue el extracto del banco en CSV, cárguelo, indique las columnas y el sistema cruza cada movimiento con los recibos y egresos. Lo que esté en el banco sin registro, o registrado sin estar en el banco, se señala para revisar.</p>`],
  ["seguridad", "Seguridad, aprobaciones y auditoría", `
    <p><b>Roles</b>: el <b>dueño</b> puede todo y aprueba; el <b>operador</b> trabaja el día a día pero lo sensible queda pendiente; <b>solo consulta</b> ve todo sin modificar (contador).</p>
    <p>Requieren aprobación: cambios de precio, descuentos, anulaciones, desistimientos, cambios en ventas, reestructuraciones, gastos, pagos y cambios de comisiones, datos bancarios de comisionistas y la configuración.</p>
    <p>La <b>auditoría</b> muestra cada movimiento con su autor. La bitácora va <b>sellada en cadena</b>: si alguien altera la base por fuera del geovisor, se detecta en <b>Verificar integridad</b>.</p>`],
  ["alertas", "Alertas en el celular (Telegram) y correo", `
    <ol><li>En Telegram busque <b>@BotFather</b>, escriba <code>/newbot</code>, póngale un nombre y copie el <b>token</b>.</li>
    <li>En ⚙ → Seguridad y alertas, pegue el token y guárdelo.</li>
    <li>Cada dueño entra a <b>Mi cuenta → Generar código</b>, abre el bot en Telegram y le envía ese código.</li>
    <li>Para el correo (Gmail): active la verificación en dos pasos, cree una <b>contraseña de aplicación</b> y guárdela en ⚙ junto con el correo que envía.</li>
    <li>Use <b>Enviarme una prueba</b> para confirmar.</li></ol>
    <p>Recibirán: solicitudes de aprobación (con botones para aprobar o rechazar), pagos altos en efectivo, operaciones fuera de horario, intentos fallidos de ingreso, alertas de integridad y el <b>resumen diario de caja</b>.</p>`],
  ["respaldos", "Respaldos y acceso", `
    <p>La base se respalda sola cada vez que se abre el geovisor (carpeta <code>datos\\respaldos</code>) y una vez al día en la carpeta externa que configure.</p>
    <p>Para usarlo desde otros equipos de la oficina o el celular en la misma wifi, active <b>acceso en red</b> en ⚙ y reinicie: la ventana negra muestra la dirección. Todos entran con su usuario y clave.</p>`],
];
if (!ALERTAS_ACTIVAS) AYUDA.splice(AYUDA.findIndex((x) => x[0] === "alertas"), 1);
const AYUDA_VISTA = { mapa: "mapa", tablero: "mapa", cartera: "pagos", pagos: "pagos", cobranza: "cobranza", prospectos: "comercial",
  comisionistas: "comercial", gastos: "finanzas", flujo: "finanzas", conciliacion: "finanzas", aprobaciones: "seguridad",
  usuarios: "seguridad", auditoria: "seguridad" };

function abrirAyuda() {
  const vista = ($(".vista.activa")?.id || "").replace("vista-", "");
  const inicial = AYUDA_VISTA[vista] || "inicio";
  modal("Ayuda", `<div class="ayuda"><nav>${AYUDA.map(([k, t]) => `<button type="button" data-a="${k}" class="${k === inicial ? "activo" : ""}">${t}</button>`).join("")}</nav>
    <div class="ay-txt" id="ayTxt"></div></div>`, { ancho: "extra" });
  $("[data-cerrar2]").textContent = "Cerrar";
  const ver = (k) => {
    $$(".ayuda nav button").forEach((b) => b.classList.toggle("activo", b.dataset.a === k));
    const [, t, h] = AYUDA.find((x) => x[0] === k);
    $("#ayTxt").innerHTML = `<h3>${t}</h3>${h}`;
  };
  $$(".ayuda nav button").forEach((b) => b.addEventListener("click", () => ver(b.dataset.a)));
  ver(inicial);
}
