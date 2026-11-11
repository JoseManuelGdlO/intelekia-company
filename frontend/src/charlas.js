/**
 * Vida de oficina para las pantallas: charlas casuales en globos de cómic, "entrevistas a cámara"
 * estilo documental y reacciones a lo que pasa (WhatsApp, logros). Todo es guion fijo: no gasta
 * créditos de IA aunque la pantalla esté prendida 24/7. {A} = quien habla primero, {B} = su compañero.
 */

// Charlas entre dos compañeros: A y B se alternan según `quien`.
const CHARLAS = [
  [['A', '{B}, ¿tú te comiste mi yogurt? Tenía mi nombre.'], ['B', 'Tenía TU nombre, no decía "no tocar".'], ['A', 'Voy a demandar.']],
  [['A', '¿Ya viste el correo de las 7 am?'], ['B', 'Lo abrí, lo cerré y fingí que no existe.'], ['A', 'Estrategia corporativa de alto nivel.']],
  [['A', 'Hoy sí voy a terminar todo antes de las 6.'], ['B', 'Dijiste lo mismo el martes.'], ['A', 'Y el martes también lo creí.']],
  [['A', '{B}, ¿me prestas tu engrapadora?'], ['B', 'Tú no me regresaste la anterior.'], ['A', 'Esa era la anterior.']],
  [['A', '¿Por qué hay una junta para planear la junta?'], ['B', 'Para que la junta salga bien.'], ['A', 'Necesito una junta para procesar esto.']],
  [['A', 'Le puse "urgente" al asunto del correo.'], ['B', '¿Y qué pasó?'], ['A', 'Nada, pero me sentí importante.']],
  [['A', 'El café de hoy sabe a lunes.'], ['B', 'Hoy es jueves.'], ['A', 'Pues el café no se enteró.']],
  [['A', '{B}, ¿la impresora funciona?'], ['B', 'Funciona cuando no la necesitas.'], ['A', 'Entonces sí funciona.']],
  [['A', 'Respondí "visto" y ya.'], ['B', '¿Al cliente?'], ['A', '...Voy a escribirle algo más largo.']],
  [['A', 'Aprendí una palabra nueva: "sinergia".'], ['B', '¿Qué significa?'], ['A', 'Nadie sabe. Por eso funciona.']],
  [['A', 'Si alguien pregunta, estoy en una llamada.'], ['B', '¿Con quién?'], ['A', 'Con mi tranquilidad.']],
  [['A', '¿Viste que pusieron plantas nuevas?'], ['B', 'Son de plástico.'], ['A', 'Como mi motivación, pero se ven bien.']],
  [['A', 'Hoy traigo energía de viernes.'], ['B', 'Es lunes.'], ['A', 'Por eso la traigo prestada.']],
  [['A', '{B}, tu código compila a la primera.'], ['B', 'Gracias.'], ['A', 'No era cumplido, me dio miedo.']],
  [['A', 'Me dijeron "es un cambio pequeñito".'], ['B', 'Uy.'], ['A', 'Llevo tres días.']],
  [['A', '¿Quién dejó el microondas con 0:01?'], ['B', 'Un rebelde.'], ['A', 'Un héroe, diría yo.']],
  [['A', 'Voy a organizar mi escritorio.'], ['B', '¿Con qué propósito?'], ['A', 'Postergar con estilo.']],
  [['A', '{B}, ¿cómo se dice "no" sin decir "no"?'], ['B', '"Lo revisamos y te aviso".'], ['A', 'Eres un artista.']],
  [['A', 'El wifi se llama "NoEsTuyo".'], ['B', '¿Y la clave?'], ['A', '"PideleASistemas". Con mayúsculas.']],
  [['A', 'Pusieron un letrero de "días sin incidentes".'], ['B', '¿Cuántos van?'], ['A', 'Lo acaban de regresar a cero.']],
  [['A', '¿Ya almorzaste?'], ['B', 'Desayuné a las 2.'], ['A', 'Entonces vas adelantado para la cena.']],
  [['A', 'Le di "responder a todos" sin querer.'], ['B', 'Ay no.'], ['A', 'Dije "jajaja ok". A dirección.']],
  [['A', '{B}, ¿te puedo hacer una pregunta rápida?'], ['B', 'Nunca son rápidas.'], ['A', 'Esta es de 45 minutos, pero rápida.']],
  [['A', 'Ya entendí el nuevo sistema.'], ['B', '¿En serio?'], ['A', 'No, pero ya no me da pena preguntar.']],
  [['A', 'Hoy estoy muy productivo.'], ['B', '¿Qué hiciste?'], ['A', 'Hice una lista de lo que voy a hacer.']],
  [['A', '¿A qué hora es la junta?'], ['B', 'Era hace 10 minutos.'], ['A', 'Entonces voy perfecto de tarde.']],
  [['A', 'Mi computadora quiere actualizarse.'], ['B', '¿Y la dejaste?'], ['A', 'Le dije "mañana" por tercera semana.']],
  [['A', '{B}, ¿hueles eso?'], ['B', '¿Qué?'], ['A', 'Huele a deadline.']],
  [['A', 'Encontré un bug.'], ['B', '¿Grave?'], ['A', 'Lo bauticé. Ya es de la familia.']],
  [['A', 'Pedí pizza para la oficina.'], ['B', '¿Para todos?'], ['A', 'Para la oficina. La oficina soy yo.']],
  [['A', 'Me dijeron que sea más proactivo.'], ['B', '¿Y qué hiciste?'], ['A', 'Me adelanté y me tomé el café de las 5.']],
  [['A', 'Hoy no me voy a quejar.'], ['B', 'Ok.'], ['A', '...Aunque el aire acondicionado, ¿eh?']],
  [['A', '{B}, ¿ese es mi bolígrafo?'], ['B', 'Los bolígrafos no tienen dueño.'], ['A', 'Este tenía. Hasta hace un minuto.']],
  [['A', '¿Viste la presentación de 80 diapositivas?'], ['B', 'Vi la primera y la última.'], ['A', 'O sea, la viste completa.']],
  [['A', 'Ya llegó el cliente.'], ['B', '¿Cuál?'], ['A', 'El que "solo quería una cosita".']],
  [['A', 'Tengo una idea genial.'], ['B', 'Uy.'], ['A', 'Es otro tablero de Excel.']],
  [['A', 'El jefe dijo "buen trabajo".'], ['B', '¿A quién?'], ['A', 'No sé, pero lo voy a poner en mi CV.']],
  [['A', '{B}, ¿me cubres cinco minutos?'], ['B', '¿Cinco reales o cinco de oficina?'], ['A', 'De oficina.'], ['B', 'Entonces nos vemos en una hora.']],
  [['A', 'Cambiaron el garrafón.'], ['B', '¿Quién?'], ['A', 'Nadie lo sabe. Es una leyenda.']],
  [['A', 'Ya casi es hora de irnos.'], ['B', 'Son las 11.'], ['A', 'Casi, en términos geológicos.']],
];

// Entrevistas "a cámara" (estilo documental): cada trabajador le cuenta algo al público.
const ENTREVISTAS_GENERALES = [
  'No es que no me gusten las juntas. Me gustan cuando se cancelan.',
  'Aquí somos una familia. Una familia que se pelea por la engrapadora.',
  'Mi método de trabajo es simple: primero el café, luego el pánico.',
  'Si me ves serio, estoy pensando. Si me ves sonriendo, también. Es estrategia.',
  'Dicen que no hay preguntas tontas. Yo he escuchado varias en las juntas.',
  'El secreto de la productividad es tener una lista. No hacerla, tenerla.',
  'Yo no procrastino. Le doy tiempo a las ideas para que maduren.',
  'Mi relación con la impresora es complicada. Ella sabe lo que hizo.',
  'Nunca he perdido un deadline. Solo los he negociado.',
  'Me encanta trabajar en equipo. Sobre todo cuando el equipo hace la parte difícil.',
  'Puse mi estado en "ocupado" hace tres años. Nadie lo ha cuestionado.',
  'El día que se cayó el internet fue el más productivo del año. Coincidencia.',
];

const ENTREVISTAS_POR_AGENTE = {
  cotizador: [
    '¿El precio? Depende. ¿De qué? También depende.',
    'Yo no invento precios. Pongo "por definir" con mucha seguridad.',
  ],
  'revisor-prs': [
    'Leo código ajeno todo el día. Es como leer el diario de alguien, pero con más punto y coma.',
    'Apruebo PRs con amor. Y con tres comentarios. Mínimo.',
  ],
  pm: [
    'Mi trabajo es preguntar "¿cómo vamos?" hasta que alguien responda "bien".',
    'Tengo un tablero para los tableros. Así sé dónde están los tableros.',
  ],
  publicador: [
    'Publiqué un post a las 3 am. El algoritmo y yo tenemos algo especial.',
    'Mi métrica favorita son los likes. La segunda favorita también.',
  ],
  'buscador-tendencias': [
    'Ya vi la tendencia de mañana. No puedo decir más. Es confidencial.',
    'Cada que algo se vuelve viral, yo ya lo había dicho. En mi mente.',
  ],
  'buscador-prospectos': [
    'Cada cafetería de Durango es un cliente potencial. Y cada cafetería tiene café. Ganar-ganar.',
    'No busco clientes. Los clientes me encuentran a mí. Después de que yo los encuentro.',
  ],
  'seguimiento-crm': [
    'Mi trabajo es dar seguimiento. Al seguimiento también le doy seguimiento.',
    'Un "lo pienso y te aviso" para mí es un "sí" en proceso.',
  ],
  'respuestas-redes': [
    'Contesto comentarios con cariño. Incluso el que dice "precio" sin signos.',
    'Un emoji bien puesto vale más que mil palabras. Yo pongo tres, por si acaso.',
  ],
};

// Lo que dicen según la hora o el día (humor involuntario de calendario).
function contexto(fecha = new Date()) {
  const h = fecha.getHours();
  const d = fecha.getDay();
  const frases = [];
  if (d === 1) frases.push([['A', 'Feliz lunes.'], ['B', 'Esas dos palabras no van juntas.']]);
  if (d === 5) frases.push([['A', '¡Ya es viernes!'], ['B', 'Shh, que no se entere el servidor.']]);
  if (h >= 14 && h < 16) frases.push([['A', '¿Ya vamos a comer?'], ['B', 'Yo ya comí. Dos veces. Por estrés.']]);
  if (h >= 18 || h < 7) frases.push([['A', '¿Qué haces aquí tan tarde?'], ['B', 'Soy un programa. ¿Tú?'], ['A', 'También. Qué bueno que hablamos.']]);
  if (h >= 7 && h < 10) frases.push([['A', 'Buenos días.'], ['B', 'Todavía no sé si son buenos. Dame un café.']]);
  return frases;
}

// Reacciones a lo que pasa de verdad (sin datos: solo el hecho).
const REACCIONES = {
  whatsapp: [
    [['A', '¡Me llegó un WhatsApp del jefe!'], ['B', 'Haz como que no lo viste.'], ['A', 'Ya salió con palomitas azules.']],
    [['A', 'WhatsApp nuevo. Modo profesional: activado.'], ['B', 'Te vi enderezarte en la silla.']],
    [['A', 'El jefe escribió. Todos actúen normal.'], ['B', 'Yo siempre actúo normal.'], ['A', 'Por eso te lo digo a ti.']],
  ],
  celebracion: [
    [['A', '¡Eso, equipo!'], ['B', 'Yo ayudé.'], ['A', '¿Cómo?'], ['B', 'Moralmente.']],
    [['A', '¡Logro desbloqueado!'], ['B', '¿Hay pastel?'], ['A', 'Hay satisfacción.'], ['B', 'Prefería pastel.']],
  ],
};

const elegir = (lista) => lista[Math.floor(Math.random() * lista.length)];
const llenar = (texto, a, b) => texto.replaceAll('{A}', a.label).replaceAll('{B}', b.label);

/** Frase de entrevista para un trabajador (propia si tiene, si no una general). */
export function entrevistaPara(agentId) {
  const propias = ENTREVISTAS_POR_AGENTE[agentId] || [];
  return Math.random() < 0.6 && propias.length ? elegir(propias) : elegir(ENTREVISTAS_GENERALES);
}

/**
 * Motor de charlas. `agentes()` → [{ id, label, departamento }].
 * scene.say(id, texto, { ms, mirarA }) muestra el globo; scene.isBusy(id) evita encimarse con
 * una conversación real entre agentes.
 */
export function createCharlas({ scene, agentes, cadaMs = [22000, 40000] }) {
  let timer = null;
  let activa = false;
  let pausada = false;
  const ocupados = new Set();

  const duracion = (texto) => Math.min(6500, 2200 + texto.length * 55);

  function pareja({ conId = null } = {}) {
    const todos = agentes().filter((a) => !ocupados.has(a.id) && !scene.isBusy(a.id));
    const a = conId ? todos.find((x) => x.id === conId) : elegir(todos);
    if (!a) return null;
    // Preferible alguien de su misma área (están cerca); si no hay, cualquiera.
    const cerca = todos.filter((x) => x.id !== a.id && x.departamento === a.departamento);
    const b = elegir(cerca.length ? cerca : todos.filter((x) => x.id !== a.id));
    return b ? [a, b] : null;
  }

  async function reproducir(guion, [a, b]) {
    ocupados.add(a.id);
    ocupados.add(b.id);
    try {
      for (const [quien, texto] of guion) {
        if (pausada) break;
        const habla = quien === 'A' ? a : b;
        const otro = quien === 'A' ? b : a;
        const frase = llenar(texto, a, b);
        const ms = duracion(frase);
        scene.say(habla.id, frase, { ms, mirarA: otro.id });
        await new Promise((r) => setTimeout(r, ms + 350));
      }
    } finally {
      ocupados.delete(a.id);
      ocupados.delete(b.id);
    }
  }

  function siguiente() {
    if (!activa) return;
    const [min, max] = cadaMs;
    timer = setTimeout(async () => {
      if (!pausada) {
        const p = pareja();
        const extras = contexto();
        const guion = extras.length && Math.random() < 0.25 ? elegir(extras) : elegir(CHARLAS);
        if (p) await reproducir(guion, p);
      }
      siguiente();
    }, min + Math.random() * (max - min));
  }

  /** Reacción a un hecho real ('whatsapp' | 'celebracion'); con conId empieza ese trabajador. */
  function reaccionar(tipo, { conId = null } = {}) {
    const guiones = REACCIONES[tipo];
    if (!guiones || pausada) return;
    const p = pareja({ conId }) || pareja();
    if (p) reproducir(elegir(guiones), p);
  }

  return {
    iniciar() {
      if (activa) return;
      activa = true;
      siguiente();
    },
    detener() {
      activa = false;
      clearTimeout(timer);
    },
    /** Pantalla de noche: nadie habla (y no se acumulan charlas). */
    pausar(valor) {
      pausada = Boolean(valor);
    },
    reaccionar,
  };
}
