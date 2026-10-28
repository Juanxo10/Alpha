/* Guía rápida de cada módulo (texto del manual original). */
export const AYUDA: [string, string, string][] = [
  ['inicio', 'Primeros pasos', `
    <ol><li>En <b>⚙ Configuración</b> complete los datos del vendedor (salen en recibos, contratos e informes), la cuenta bancaria y las reglas de cartera.</li>
    <li>En <b>Administración → Usuarios</b> cree un usuario para cada persona de la oficina. Nadie debe usar la cuenta de otro.</li>
    <li>Asigne los <b>precios de lista</b> (⚙ → Respaldos y red → Asignar precios por manzana, o lote por lote).</li>
    <li>Defina una <b>carpeta de respaldo</b> en Google Drive o una USB: la base se copia allí todos los días.</li></ol>`],
  ['mapa', 'Mapa y ficha del lote', `
    <p>Toque un lote para ver su <b>tarjeta</b>; el botón <b>Ficha</b> abre la ficha completa con el plan de pagos, los pagos, la cobranza, los documentos y el historial.</p>
    <p>Arriba a la izquierda se cambia la lectura del mapa: <b>estado comercial</b>, <b>cartera</b> (mora por edad) o <b>avance de pago</b>. Con el buscador se encuentra un lote por código, comprador o documento.</p>`],
  ['ventas', 'Separar y vender', `
    <p><b>Separar</b> aparta el lote con un abono y una fecha límite. <b>Vender</b> registra el valor, la cuota inicial y el número de cuotas: el plan de pagos se genera solo.</p>
    <p>Si la venta lleva comisionista se elige en el mismo formulario. Un operador puede vender a precio de lista; si da un <b>descuento</b> mayor al permitido o cambia el % de comisión, la venta queda <b>pendiente de aprobación</b>.</p>`],
  ['bloques', 'Venta en bloque (varios lotes)', `
    <p>En el mapa use <b>Seleccionar varios lotes</b> y toque los lotes que el comprador quiere (en computador también puede mantener <b>Mayús</b> y arrastrar un recuadro sobre la manzana). El panel suma área, precio y porcentaje del predio. Luego <b>Vender en bloque</b>.</p>
    <p>El comprador se escribe una sola vez; el sistema propone el <b>descuento por volumen</b> de la tabla del proyecto (si se da más, lo aprueba un dueño), y arma <b>un solo plan de pagos</b>:</p>
    <ul><li><b>Progresivo</b> (recomendado): los pagos terminan un lote antes de seguir con el siguiente, con la misma cuota mensual; el comprador puede <b>escriturar cada lote</b> apenas lo termine de pagar.</li><li><b>Parejo</b>: todos los lotes avanzan al mismo ritmo.</li></ul>
    <p>Cada lote queda con su propia venta (se escritura, se desiste o se cede por separado) dentro del <b>negocio en bloque</b> (NEG-0001). En <b>Comercial → Negocios en bloque</b> se registra el pago del bloque: un <b>recibo consolidado</b> que se reparte solo entre los lotes, y que la conciliación bancaria cruza contra la transferencia única del comprador. Desde ahí también salen el estado de cuenta consolidado y la <b>promesa de compraventa en bloque</b>.</p>`],
  ['pagos', 'Pagos, recibos y abonos a capital', `
    <p>Cada pago se registra desde la ficha del lote y genera un <b>recibo de caja</b> con consecutivo y valor en letras. Los pagos se aplican en orden: primero la cuota inicial y después las cuotas más antiguas.</p>
    <p>Para un <b>abono a capital</b> elija ese concepto y si quiere <b>acortar el plazo</b> o <b>bajar la cuota</b>. Para cambiar el plan por un acuerdo, use <b>Reestructurar plan</b> en la ficha. El plan anterior queda en el historial.</p>
    <p>Un recibo nunca se borra: se <b>anula</b> con motivo (requiere aprobación de un dueño) y conserva su número.</p>`],
  ['desistimientos', 'Desistimientos y devoluciones', `
    <p>Con <b>Desistimiento</b> en la ficha del lote, el sistema calcula solo la liquidación: <b>pagado − cláusula penal − otros descuentos = valor a devolver</b>. La cláusula penal es un % del precio (por defecto el de la promesa, y se puede cambiar ahí mismo); los otros descuentos se escriben con su concepto. Un operador necesita aprobación de un dueño.</p>
    <p>En <b>Cartera → Desistimientos</b> se ven los que faltan por devolver, con el <b>plazo</b> (configurable) y si ya venció. «Registrar devolución» la anota como un gasto «Devoluciones a compradores» con comprobante de egreso: sale de la caja y se concilia con el banco. Desde ahí también se imprime la <b>liquidación</b> y se genera la <b>resciliación</b> con el valor ya calculado.</p>`],
  ['cobranza', 'Cobranza', `
    <p><b>Cartera → Cobranza</b> muestra a quién cobrar: cuotas vencidas (por días de mora), separaciones por vencer y cuotas próximas.</p>
    <p>Con un clic se abre <b>WhatsApp</b> con el mensaje ya redactado o se registra una <b>gestión</b> (llamada, visita…) con el <b>compromiso de pago</b>. Los compromisos incumplidos se marcan en rojo.</p>
`],
  ['documentos', 'Documentos y expediente', `
    <p>En la ficha del lote, pestaña <b>Documentos</b>: <b>ficha integral</b>, <b>estado de cuenta</b>, <b>promesa de compraventa</b>, <b>certificado de pagos</b> y <b>paz y salvo</b> (solo con saldo $0), todos en PDF.</p>
    <p>En el <b>expediente</b> se suben la cédula, la promesa firmada, los comprobantes y la escritura. Cada archivo guarda su huella: si alguien lo cambia, el sistema lo detecta.</p>
    <p>La promesa se arma con los datos del negocio y los linderos. Hágala revisar por su abogado la primera vez y ajuste en ⚙ la cláusula penal, la notaría y el plazo.</p>`],
  ['contratos', 'Contratos y firmas', `
    <p>En la ficha del lote, pestaña <b>Documentos</b> → <b>Contratos del negocio</b>, se genera la <b>promesa de compraventa</b>, el <b>acuerdo de separación</b>, un <b>otrosí</b> de forma de pago, el <b>acta de entrega</b>, la <b>resciliación</b> o la <b>cesión de derechos</b>. También la <b>autorización de tratamiento de datos personales</b> (Ley 1581 de 2012), que se firma una vez por comprador; en <b>Comercial → Contratos</b> se ve quién aún no la ha firmado.</p>
    <p>Cada contrato queda <b>numerado</b> (PCV-0001, SEP-0001…) y con una copia fija de su texto: lo que se firmó no cambia aunque después se modifique la plantilla. Cuando las partes firman, use <b>Registrar firma</b> y suba el escaneo: queda en el expediente del lote.</p>
    <p>En <b>Comercial → Contratos</b> se ven todos los contratos, los que faltan por firmar y las ventas que aún no tienen promesa firmada. El dueño ajusta el texto de cada contrato en <b>Plantillas</b>, con su abogado, sin tocar el programa.</p>`],
  ['comercial', 'Prospectos y comisionistas', `
    <p><b>Prospectos</b>: registre a cada interesado, su origen y el próximo seguimiento. Desde su ficha se le <b>cotiza</b> un lote (PDF con plan de pagos) o se <b>convierte en venta</b>.</p>
    <p><b>Comisionistas</b>: cada uno con su % y su regla de causación. Se le paga solo lo causado, con <b>comprobante de egreso</b> y retención.</p>`],
  ['finanzas', 'Gastos, flujo de caja y conciliación', `
    <p><b>Gastos</b>: todo egreso con comprobante de egreso (CE) consecutivo. Cargue el <b>presupuesto</b> de obra por categoría para controlar lo ejecutado.</p>
    <p><b>Flujo de caja</b>: ingresos y egresos por mes, recaudo esperado según los planes de pago y el <b>resultado proyectado</b> del proyecto.</p>
    <p><b>Conciliación</b>: descargue el extracto del banco en Excel (.xlsx) o CSV, cárguelo, indique las columnas y el sistema cruza cada movimiento con los recibos y egresos. Lo que esté en el banco sin registro, o registrado sin estar en el banco, se señala para revisar.</p>`],
  ['bienes', 'Bienes como pago y permutas', `
    <p>Cuando un comprador paga con un <b>vehículo, un inmueble, otro lote u otro bien</b>: en la ficha del lote use <b>Recibir bien como pago</b>. Registre el bien, su identificación (placa, matrícula), su <b>avalúo</b> y el <b>valor por el que se recibe</b>. Ese valor se abona al lote con un recibo «En especie» y se aplica a las cuotas como cualquier pago.</p>
    <p>Para una <b>permuta</b> (cambiar el lote por un bien), registre la venta del lote por su valor y reciba el bien como pago con la modalidad «Permuta»; si el lote vale más, la diferencia queda como saldo a pagar.</p>
    <p>En <b>Finanzas → Bienes recibidos</b> se controla cada bien: el <b>traspaso</b> a nombre del vendedor, si está <b>en venta</b> y su <b>venta</b>, con la utilidad o pérdida frente al valor de recibo. Lo recibido en especie <b>no es dinero</b>: no se espera en el banco y entra a la caja cuando el bien se vende. Desde Documentos se generan el <b>contrato de dación en pago</b> o el <b>de permuta</b>.</p>
    <p>Recibir un bien, venderlo o anularlo lo aprueba un dueño cuando lo hace un operador.</p>`],
  ['seguridad', 'Seguridad, aprobaciones y auditoría', `
    <p><b>Roles</b>: el <b>dueño</b> puede todo y aprueba; el <b>operador</b> trabaja el día a día pero lo sensible queda pendiente; <b>solo consulta</b> ve todo sin modificar (contador).</p>
    <p>Requieren aprobación: cambios de precio, descuentos, anulaciones, desistimientos, cambios en ventas, reestructuraciones, gastos, pagos y cambios de comisiones, datos bancarios de comisionistas y la configuración.</p>
    <p>La <b>auditoría</b> muestra cada movimiento con su autor. La bitácora va <b>sellada en cadena</b>: si alguien altera la base por fuera del geovisor, se detecta en <b>Verificar integridad</b>.</p>`],
  ['respaldos', 'Respaldos y acceso', `
    <p>La base se respalda sola cada vez que se abre el geovisor (carpeta <code>datos\\\\respaldos</code>) y una vez al día en la carpeta externa que configure.</p>
    <p>Para usarlo desde otros equipos de la oficina o el celular en la misma wifi, active <b>acceso en red</b> en ⚙ y reinicie: la ventana negra muestra la dirección. Todos entran con su usuario y clave.</p>`],
]
export const AYUDA_VISTA: Record<string, string> = {
  mapa: 'mapa', tablero: 'mapa', cartera: 'pagos', pagos: 'pagos', cobranza: 'cobranza', prospectos: 'comercial',
  comisionistas: 'comercial', gastos: 'finanzas', flujo: 'finanzas', conciliacion: 'finanzas', aprobaciones: 'seguridad',
  usuarios: 'seguridad', auditoria: 'seguridad', contratos: 'contratos', bloques: 'bloques', bienes: 'bienes', desistimientos: 'desistimientos',
}
