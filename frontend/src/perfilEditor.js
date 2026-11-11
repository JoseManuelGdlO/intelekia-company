import { fetchPerfil, savePerfil, fetchMemoria, saveMemoria, comprimirMemoria, fetchBaseDatosEstado, probarBaseDatos, fetchConsultasBD, fetchCorreoEstado, saveCorreoConfig, probarCorreo, fetchCorreos, fetchCiclos, fetchInstalables, instalarSkill, quitarSkillInstalada, instalarPlugin, probarPlugin, quitarPlugin } from './api.js';
import { fechaCorta } from './fechas.js';

const TIPO_LABELS = { skill: 'Skill', plugin: 'Plugin', documento: 'Documento' };

function $(id) {
  return document.getElementById(id);
}

/** Nombre sugerido para un archivo cargado: `name:` del frontmatter, primer título o el nombre del archivo. */
function guessName(fileName, text) {
  const front = text.match(/^---[\s\S]*?\nname:\s*(.+)\n[\s\S]*?---/);
  if (front) return front[1].trim().replace(/^["']|["']$/g, '');
  const heading = text.match(/^#\s+(.+)$/m);
  if (heading && /^skill\.md$/i.test(fileName)) return heading[1].trim();
  return fileName.replace(/\.[^.]+$/, '');
}

/**
 * Editor del perfil de un trabajador: rol/contexto, skills-plugins-documentos y memoria.
 */
export function createPerfilEditor({ accentOf, onSaved }) {
  const modal = $('perfil-modal');
  const toast = $('perfil-toast');
  const skillsBox = $('perfil-skills');
  let agentId = null;
  let perfil = null;
  let skills = [];
  let dirty = { rol: false, skills: false, memoria: false, herramientas: false, instalados: false };
  let catalogo = { skills: [], plugins: [] };
  let asignados = { skills: new Set(), plugins: new Set() };
  let closeArmed = false;
  let compressArmed = false;
  let toastTimer = null;

  function notify(text, isError = false) {
    toast.textContent = text;
    toast.classList.toggle('error', isError);
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  function setBusy(button, busy) {
    button.disabled = busy;
  }

  function showTab(name) {
    document.querySelectorAll('.perfil-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.perfil-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  }

  function updateCounts() {
    $('perfil-rol-count').textContent = `${$('perfil-rol').value.length.toLocaleString('es-MX')} caracteres`;
    const activas = skills.filter((s) => s.activo !== false).length;
    $('perfil-skills-count').textContent = skills.length ? `(${activas}/${skills.length})` : '';
    const total = skills.filter((s) => s.activo !== false).reduce((n, s) => n + s.contenido.length, 0);
    $('perfil-skills-total').textContent = skills.length
      ? `${activas} activa(s) · ${total.toLocaleString('es-MX')} caracteres que se envían en cada tarea`
      : '';
    const mem = $('perfil-memoria').value.length;
    $('perfil-mem-chars').textContent = `${mem.toLocaleString('es-MX')} caracteres`;
    $('perfil-mem-count').textContent = mem ? `(${Math.ceil(mem / 1000)}k)` : '';
  }

  function renderSkills() {
    skillsBox.innerHTML = '';
    if (!skills.length) {
      skillsBox.innerHTML = '<div class="skill-empty">Aún no tiene skills ni plugins. Agrega uno o carga un archivo.</div>';
    }
    skills.forEach((skill, index) => {
      const card = document.createElement('div');
      card.className = `skill-card${skill.activo === false ? ' off' : ''}${skill._open === false ? ' collapsed' : ''}`;
      card.innerHTML = `
        <div class="skill-head">
          <select class="skill-tipo" aria-label="Tipo"></select>
          <input class="skill-nombre" type="text" placeholder="Nombre (ej. Manejo de objeciones)" maxlength="80" />
          <label class="skill-switch" title="Activa: se le entrega al agente"><input type="checkbox" class="skill-activo" /> Activa</label>
          <button class="icon-btn skill-toggle" title="Mostrar / ocultar">▾</button>
          <button class="icon-btn skill-delete" title="Eliminar">🗑</button>
        </div>
        <textarea class="skill-contenido" rows="7" spellcheck="false" placeholder="Pega aquí el contenido del skill, las instrucciones del plugin o el documento…"></textarea>
        <div class="skill-foot"></div>`;
      const tipo = card.querySelector('.skill-tipo');
      Object.entries(TIPO_LABELS).forEach(([value, label]) => tipo.add(new Option(label, value)));
      tipo.value = skill.tipo;
      const nombre = card.querySelector('.skill-nombre');
      nombre.value = skill.nombre;
      const activo = card.querySelector('.skill-activo');
      activo.checked = skill.activo !== false;
      const contenido = card.querySelector('.skill-contenido');
      contenido.value = skill.contenido;
      const foot = card.querySelector('.skill-foot');
      const max = perfil?.limites?.contenido || 20000;
      const refreshFoot = () => {
        foot.textContent = `${skill.contenido.length.toLocaleString('es-MX')} / ${max.toLocaleString('es-MX')} caracteres`;
        foot.classList.toggle('over', skill.contenido.length > max);
      };
      refreshFoot();

      const touch = () => {
        dirty.skills = true;
        updateCounts();
      };
      tipo.addEventListener('change', () => {
        skill.tipo = tipo.value;
        touch();
      });
      nombre.addEventListener('input', () => {
        skill.nombre = nombre.value;
        touch();
      });
      activo.addEventListener('change', () => {
        skill.activo = activo.checked;
        card.classList.toggle('off', !activo.checked);
        touch();
      });
      contenido.addEventListener('input', () => {
        skill.contenido = contenido.value;
        refreshFoot();
        touch();
      });
      card.querySelector('.skill-toggle').addEventListener('click', () => {
        skill._open = card.classList.contains('collapsed');
        card.classList.toggle('collapsed');
      });
      const del = card.querySelector('.skill-delete');
      del.addEventListener('click', () => {
        if (!del.classList.contains('armed')) {
          del.classList.add('armed');
          del.textContent = '¿Eliminar?';
          setTimeout(() => {
            del.classList.remove('armed');
            del.textContent = '🗑';
          }, 2500);
          return;
        }
        skills.splice(index, 1);
        dirty.skills = true;
        renderSkills();
        updateCounts();
      });
      skillsBox.appendChild(card);
    });
  }

  function addSkill(tipo, nombre = '', contenido = '') {
    skills.push({ tipo, nombre, contenido, activo: true, _open: true });
    dirty.skills = true;
    renderSkills();
    updateCounts();
    const cards = skillsBox.querySelectorAll('.skill-card');
    const last = cards[cards.length - 1];
    last?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (!nombre) last?.querySelector('.skill-nombre').focus();
  }

  function fillRol() {
    const isCustom = perfil.tipo === 'custom';
    $('perfil-title').textContent = perfil.label;
    $('perfil-sub').textContent = `${perfil.departmentLabel} · ${isCustom ? 'Trabajador a la medida' : 'Agente base'}`;
    const avatar = $('perfil-avatar');
    avatar.textContent = perfil.label.charAt(0).toUpperCase();
    avatar.style.background = accentOf(perfil.departmentId);
    $('perfil-custom-fields').hidden = !isCustom;
    $('perfil-label').value = perfil.label;
    $('perfil-autonomous').checked = Boolean(perfil.autonomous);
    $('perfil-rol').value = perfil.rol;
    $('perfil-plantilla-field').hidden = perfil.plantilla === null || perfil.plantilla === undefined;
    $('perfil-plantilla').value = perfil.plantilla || '';
    $('perfil-autonomia-row').hidden = !perfil.soportaAutonomia;
    $('perfil-autonomia').checked = perfil.autonomia === 'autonomo';
    fillAutonomiaHint();
    fillCiclo();
    $('perfil-rol-hint').textContent = isCustom
      ? 'Contexto que le diste al crearlo.'
      : 'Se guarda en su archivo de rol (departamentos/…/agentes). Ojo: si pide un formato de salida específico, consérvalo.';
  }

  function fillAutonomiaHint() {
    $('perfil-autonomia-hint').textContent = $('perfil-autonomia').checked
      ? 'Ejecuta sus acciones sin pedirte permiso (lo delicado igual te lo pasa a ✋ Aprobaciones).'
      : '✋ Supervisado: todo lo que quiera hacer llega a ✋ Aprobaciones para que tú decidas.';
  }

  async function fillCiclo() {
    const row = $('perfil-ciclo-row');
    row.hidden = !perfil.ciclo;
    cicloDirty = false;
    if (!perfil.ciclo) return;
    const { cadaHoras, porDefecto, personalizado } = perfil.ciclo;
    $('perfil-ciclo').value = cadaHoras;
    cicloValor = cadaHoras;
    $('perfil-ciclo-default').disabled = !personalizado;
    $('perfil-ciclo-default').textContent = `Usar valor por defecto (${porDefecto} h)`;
    let texto = cadaHoras === 0 ? 'No corre solo: solo responde en el chat o con Forzar ciclo.' : '0 = no corre solo.';
    try {
      const info = (await fetchCiclos())[perfil.id];
      if (info?.proxima && cadaHoras > 0) texto += ` Próximo ciclo: ${fechaCorta(info.proxima)}`;
    } catch {
      // opcional
    }
    $('perfil-ciclo-hint').textContent = texto;
  }

  async function open(id) {
    agentId = id;
    dirty = { rol: false, skills: false, memoria: false, herramientas: false, instalados: false };
    closeArmed = false;
    showTab('rol');
    modal.classList.add('visible');
    $('perfil-title').textContent = 'Cargando…';
    try {
      const [p, mem] = await Promise.all([fetchPerfil(id), fetchMemoria(id)]);
      perfil = p;
      skills = p.skills.map((s) => ({ ...s, _open: false }));
      fillRol();
      renderSkills();
      $('perfil-memoria').value = mem.content;
      updateCounts();
      loadTools();
      asignados = { skills: new Set(p.instalados?.skills || []), plugins: new Set(p.instalados?.plugins || []) };
      loadInstalables();
    } catch (err) {
      notify(`No se pudo cargar el perfil: ${err.message}`, true);
    }
  }

  function close(force = false) {
    const pending = Object.entries(dirty).filter(([, v]) => v).map(([k]) => k);
    if (pending.length && !force && !closeArmed) {
      closeArmed = true;
      notify(`Tienes cambios sin guardar (${pending.join(', ')}). Cierra otra vez para descartarlos.`, true);
      setTimeout(() => {
        closeArmed = false;
      }, 3500);
      return;
    }
    modal.classList.remove('visible');
    agentId = null;
  }

  async function saveRol() {
    const button = $('perfil-rol-save');
    setBusy(button, true);
    try {
      const patch = { rol: $('perfil-rol').value };
      if (typeof perfil.plantilla === 'string') patch.plantilla = $('perfil-plantilla').value;
      if (perfil.soportaAutonomia) patch.autonomia = $('perfil-autonomia').checked ? 'autonomo' : 'supervisado';
      if (cicloDirty) patch.cicloHoras = cicloValor;
      if (perfil.tipo === 'custom') {
        patch.label = $('perfil-label').value;
        patch.autonomous = $('perfil-autonomous').checked;
      }
      const previousLabel = perfil.label;
      perfil = await savePerfil(agentId, patch);
      fillRol();
      dirty.rol = false;
      notify(cicloDirty ? 'Guardado ✓ — el nuevo ciclo aplica en menos de un minuto' : 'Rol guardado ✓ — aplica desde su siguiente tarea');
      cicloDirty = false;
      onSaved?.(perfil, { labelChanged: perfil.label !== previousLabel });
    } catch (err) {
      notify(err.message, true);
    } finally {
      setBusy(button, false);
    }
  }

  async function saveSkills() {
    const button = $('perfil-skills-save');
    setBusy(button, true);
    try {
      const openState = skills.map((s) => s._open);
      perfil = await savePerfil(agentId, { skills: skills.map(({ _open, ...s }) => s) });
      skills = perfil.skills.map((s, i) => ({ ...s, _open: openState[i] }));
      renderSkills();
      updateCounts();
      dirty.skills = false;
      notify('Skills y plugins guardados ✓');
      onSaved?.(perfil, { labelChanged: false });
    } catch (err) {
      notify(err.message, true);
    } finally {
      setBusy(button, false);
    }
  }

  async function saveMem() {
    const button = $('perfil-mem-save');
    setBusy(button, true);
    try {
      await saveMemoria(agentId, $('perfil-memoria').value);
      dirty.memoria = false;
      notify('Memoria guardada ✓');
    } catch (err) {
      notify(err.message, true);
    } finally {
      setBusy(button, false);
    }
  }

  async function reloadMem() {
    try {
      $('perfil-memoria').value = (await fetchMemoria(agentId)).content;
      dirty.memoria = false;
      updateCounts();
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function compressMem() {
    const button = $('perfil-mem-compress');
    if (dirty.memoria) {
      notify('Guarda o recarga la memoria antes de comprimirla.', true);
      return;
    }
    if (!compressArmed) {
      compressArmed = true;
      button.textContent = '¿Comprimir? Clic de nuevo';
      setTimeout(() => {
        compressArmed = false;
        button.textContent = '🗜️ Comprimir';
      }, 3000);
      return;
    }
    compressArmed = false;
    button.textContent = 'Comprimiendo…';
    setBusy(button, true);
    try {
      $('perfil-memoria').value = (await comprimirMemoria(agentId)).content;
      updateCounts();
      notify('Memoria comprimida ✓');
    } catch (err) {
      notify(err.message, true);
    } finally {
      button.textContent = '🗜️ Comprimir';
      setBusy(button, false);
    }
  }

  // --- Herramientas (base de datos) ---
  let mailConfigDirty = false;
  let cicloDirty = false;
  let cicloValor; // número de horas, o null para volver al valor por defecto

  function fillToolsCount() {
    const activas = Object.values(perfil?.herramientas || {}).filter(Boolean).length;
    $('perfil-tools-count').textContent = activas ? `(${activas})` : '';
  }

  const ESTADO_CORREO = { enviado: 'enviado ✓', por_aprobar: 'por aprobar', error: 'error', descartado: 'descartado' };

  function renderMailLog(items) {
    const box = $('mail-log');
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = '<div class="skill-empty">Todavía no ha enviado correos.</div>';
      return;
    }
    items
      .slice()
      .reverse()
      .forEach((item) => {
        const row = document.createElement('div');
        row.className = `bd-row mail-row estado-${item.estado}`;
        const meta = document.createElement('div');
        meta.className = 'bd-meta';
        const fecha = new Date(item.creadoEn).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
        meta.textContent = `${fecha} · ${ESTADO_CORREO[item.estado] || item.estado} · para ${item.para.join(', ')}`;
        const asunto = Object.assign(document.createElement('div'), { className: 'mail-subject', textContent: item.asunto });
        row.append(meta, asunto);
        const nota = item.error || (item.estado === 'por_aprobar' ? item.motivo : null);
        if (nota) row.appendChild(Object.assign(document.createElement('div'), { className: 'bd-error', textContent: nota }));
        box.appendChild(row);
      });
  }

  async function loadMail() {
    $('mail-activo').checked = Boolean(perfil?.herramientas?.correo);
    $('mail-test-result').textContent = '';
    mailConfigDirty = false;
    try {
      const [estado, correos] = await Promise.all([fetchCorreoEstado(), fetchCorreos({ agentId, limite: 20 })]);
      $('mail-remitente').textContent = estado.remitente ? `· ${estado.remitente}` : '';
      const badge = $('mail-estado');
      badge.textContent = estado.configurado ? 'Configurado' : 'Sin configurar';
      badge.classList.toggle('off', !estado.configurado);
      $('mail-config-help').hidden = estado.configurado;
      $('mail-probar').disabled = !estado.configurado;
      $('mail-permitidos').value = estado.permitidos.join('\n');
      $('mail-limite').value = estado.limiteDiario;
      $('mail-limite-txt').textContent = estado.limiteDiario;
      $('mail-hoy').textContent = estado.enviadosHoy;
      const cco = estado.copiaOculta || [];
      $('mail-bcc').textContent = cco.length ? cco.join(', ') : 'nadie (configura SMTP_BCC en backend/.env)';
      renderMailLog(correos);
    } catch (err) {
      notify(`No se pudo leer el estado del correo: ${err.message}`, true);
    }
  }

  function renderLog(items) {
    const box = $('bd-log');
    box.innerHTML = '';
    if (!items.length) {
      box.innerHTML = '<div class="skill-empty">Todavía no ha consultado la base de datos.</div>';
      return;
    }
    items
      .slice()
      .reverse()
      .forEach((item) => {
        const row = document.createElement('div');
        row.className = `bd-row${item.error ? ' error' : ''}`;
        const meta = document.createElement('div');
        meta.className = 'bd-meta';
        const fecha = new Date(item.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
        meta.textContent = `${fecha} · ${item.error ? (item.bloqueada ? 'bloqueada' : 'error') : `${item.filas} fila(s)`}${item.motivo ? ` · ${item.motivo}` : ''}`;
        const sql = document.createElement('code');
        sql.textContent = item.sql;
        row.append(meta, sql);
        if (item.error) row.appendChild(Object.assign(document.createElement('div'), { className: 'bd-error', textContent: item.error }));
        box.appendChild(row);
      });
  }

  async function loadTools() {
    fillToolsCount();
    $('bd-activa').checked = Boolean(perfil?.herramientas?.baseDatos);
    $('bd-test-result').textContent = '';
    try {
      const [estado, log] = await Promise.all([fetchBaseDatosEstado(), fetchConsultasBD({ agentId })]);
      $('bd-nombre').textContent = estado.baseDatos ? `· ${estado.baseDatos}` : '';
      const badge = $('bd-estado');
      badge.textContent = estado.configurada ? 'Configurada' : 'Sin configurar';
      badge.classList.toggle('off', !estado.configurada);
      $('bd-tablas').textContent = estado.tablas.join(', ');
      $('bd-bloqueadas').textContent = estado.columnasBloqueadas.join(', ');
      $('bd-root-warning').hidden = !(estado.configurada && estado.usuarioEsRoot);
      $('bd-config-help').hidden = estado.configurada;
      $('bd-probar').disabled = !estado.configurada;
      renderLog(log);
    } catch (err) {
      notify(`No se pudo leer el estado de la base de datos: ${err.message}`, true);
    }
    await loadMail();
  }

  async function saveTools() {
    const button = $('perfil-tools-save');
    setBusy(button, true);
    try {
      if (mailConfigDirty) {
        const permitidos = $('mail-permitidos').value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        await saveCorreoConfig({ permitidos, limiteDiario: Number($('mail-limite').value) });
        mailConfigDirty = false;
      }
      perfil = await savePerfil(agentId, {
        herramientas: { baseDatos: $('bd-activa').checked, correo: $('mail-activo').checked },
      });
      dirty.herramientas = false;
      fillToolsCount();
      await loadMail();
      const activas = [perfil.herramientas.baseDatos && 'base de datos', perfil.herramientas.correo && 'correo'].filter(Boolean);
      notify(activas.length ? `Herramientas guardadas ✓ — activas: ${activas.join(' y ')}` : 'Herramientas guardadas ✓ — ninguna activa');
    } catch (err) {
      notify(err.message, true);
    } finally {
      setBusy(button, false);
    }
  }

  async function testDb() {
    const button = $('bd-probar');
    setBusy(button, true);
    $('bd-test-result').textContent = 'Probando…';
    try {
      const r = await probarBaseDatos();
      $('bd-test-result').textContent = `✓ Conectó: ${r.tablas} tabla(s) visibles`;
    } catch (err) {
      $('bd-test-result').textContent = `✕ ${err.message}`;
    } finally {
      setBusy(button, false);
    }
  }

  async function loadFiles(files) {
    for (const file of files) {
      const text = await file.text();
      const tipo = /\.json$/i.test(file.name) ? 'documento' : /plugin/i.test(file.name) ? 'plugin' : 'skill';
      addSkill(tipo, guessName(file.name, text), text);
    }
  }

  // ---------- Instalados desde internet (skills de GitHub y plugins MCP) ----------

  async function loadInstalables() {
    try {
      catalogo = await fetchInstalables();
    } catch {
      catalogo = { skills: [], plugins: [] };
    }
    renderInstalables();
  }

  function instCount() {
    const n = asignados.skills.size + asignados.plugins.size;
    $('inst-count').textContent = catalogo.skills.length + catalogo.plugins.length ? `(${n} en uso)` : '';
  }

  function instRow({ tipo, item, titulo, sub, detalle, fuente }) {
    const row = document.createElement('div');
    row.className = 'inst-item';
    const set = asignados[tipo];
    row.innerHTML = `
      <label class="inst-check"><input type="checkbox" /> <span class="inst-name"></span></label>
      <div class="inst-sub"></div>
      <div class="inst-actions"></div>`;
    const check = row.querySelector('input');
    check.checked = set.has(item.id);
    check.addEventListener('change', () => {
      if (check.checked) set.add(item.id);
      else set.delete(item.id);
      dirty.instalados = true;
      instCount();
    });
    row.querySelector('.inst-name').textContent = titulo;
    row.querySelector('.inst-sub').textContent = sub;
    if (detalle) row.querySelector('.inst-sub').title = detalle;
    const actions = row.querySelector('.inst-actions');
    if (fuente) {
      const a = Object.assign(document.createElement('a'), { href: fuente, target: '_blank', rel: 'noopener', textContent: 'Ver origen', className: 'inst-link' });
      actions.appendChild(a);
    }
    return { row, actions };
  }

  function armedButton(label, onConfirm) {
    const b = Object.assign(document.createElement('button'), { className: 'btn ghost small', type: 'button', textContent: label });
    b.addEventListener('click', async () => {
      if (!b.classList.contains('armed')) {
        b.classList.add('armed');
        b.textContent = '¿Seguro? Clic de nuevo';
        setTimeout(() => {
          b.classList.remove('armed');
          b.textContent = label;
        }, 3000);
        return;
      }
      b.disabled = true;
      try {
        await onConfirm();
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }

  function renderInstalables() {
    const box = $('inst-list');
    box.innerHTML = '';
    if (!catalogo.skills.length && !catalogo.plugins.length) {
      box.innerHTML = '<div class="skill-empty">Todavía no hay nada instalado. Pega abajo la URL de un skill de GitHub o de un plugin MCP.</div>';
    }
    catalogo.skills.forEach((s) => {
      const { row, actions } = instRow({
        tipo: 'skills',
        item: s,
        titulo: `🧩 ${s.nombre}`,
        sub: `${s.descripcion || 'Sin descripción'} · ${s.archivos.length} archivo(s)`,
        detalle: s.archivos.join('\n'),
        fuente: s.fuente,
      });
      actions.appendChild(
        armedButton('Desinstalar', async () => {
          try {
            await quitarSkillInstalada(s.id);
            asignados.skills.delete(s.id);
            notify(`Skill ${s.nombre} desinstalado`);
            loadInstalables();
          } catch (err) {
            notify(err.message, true);
          }
        })
      );
      box.appendChild(row);
    });
    catalogo.plugins.forEach((p) => {
      const herramientas = (p.herramientas || []).map((h) => h.nombre);
      const { row, actions } = instRow({
        tipo: 'plugins',
        item: p,
        titulo: `🔌 ${p.nombre}`,
        sub: `${p.transporte === 'http' ? p.url : `npm: ${p.paquete}`} · ${herramientas.length} herramienta(s): ${herramientas.join(', ')}`,
        detalle: (p.herramientas || []).map((h) => `${h.nombre}: ${h.descripcion}`).join('\n'),
        fuente: p.transporte === 'npm' ? `https://www.npmjs.com/package/${p.paquete}` : null,
      });
      const probar = Object.assign(document.createElement('button'), { className: 'btn ghost small', type: 'button', textContent: 'Probar' });
      probar.addEventListener('click', async () => {
        probar.disabled = true;
        probar.textContent = 'Probando…';
        try {
          const r = await probarPlugin(p.id);
          notify(`✓ ${r.nombre} respondió con ${r.herramientas.length} herramienta(s)`);
          loadInstalables();
        } catch (err) {
          notify(`✕ ${err.message}`, true);
        } finally {
          probar.disabled = false;
          probar.textContent = 'Probar';
        }
      });
      actions.append(
        probar,
        armedButton('Quitar', async () => {
          try {
            await quitarPlugin(p.id);
            asignados.plugins.delete(p.id);
            notify(`Plugin ${p.nombre} quitado`);
            loadInstalables();
          } catch (err) {
            notify(err.message, true);
          }
        })
      );
      box.appendChild(row);
    });
    instCount();
  }

  async function doInstall(button, fn, okText) {
    button.disabled = true;
    const label = button.textContent;
    button.textContent = 'Instalando…';
    $('inst-result').textContent = 'Descargando y verificando…';
    try {
      const item = await fn();
      // Lo recién instalado queda marcado para este trabajador (falta guardar).
      (item.herramientas ? asignados.plugins : asignados.skills).add(item.id);
      dirty.instalados = true;
      $('inst-result').textContent = okText(item);
      await loadInstalables();
      return true;
    } catch (err) {
      $('inst-result').textContent = `✕ ${err.message}`;
      return false;
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  async function saveInstalados() {
    const button = $('inst-save');
    setBusy(button, true);
    try {
      perfil = await savePerfil(agentId, { instalados: { skills: [...asignados.skills], plugins: [...asignados.plugins] } });
      dirty.instalados = false;
      notify('Asignación guardada ✓ — aplica desde su siguiente tarea');
      $('inst-result').textContent = '';
      onSaved?.(perfil, { labelChanged: false });
    } catch (err) {
      notify(err.message, true);
    } finally {
      setBusy(button, false);
    }
  }

  $('inst-skill-btn').addEventListener('click', async () => {
    const input = $('inst-skill-url');
    if (!input.value.trim()) return input.focus();
    const ok = await doInstall($('inst-skill-btn'), () => instalarSkill(input.value.trim()), (s) => `✓ Skill "${s.nombre}" instalado (${s.archivos.length} archivos). Guarda para asignarlo.`);
    if (ok) input.value = '';
  });
  $('inst-plugin-btn').addEventListener('click', async () => {
    const input = $('inst-plugin-url');
    const valor = input.value.trim();
    if (!valor) return input.focus();
    const datos = /^https?:\/\//i.test(valor) ? { url: valor } : { paquete: valor };
    datos.nombre = $('inst-plugin-nombre').value.trim();
    const tokenEnv = $('inst-plugin-token').value.trim();
    if (tokenEnv) datos.tokenEnv = tokenEnv;
    const args = $('inst-plugin-args').value.trim();
    if (args) datos.args = args;
    const ok = await doInstall($('inst-plugin-btn'), () => instalarPlugin(datos), (p) => `✓ Plugin "${p.nombre}" conectado: ${p.herramientas.length} herramienta(s). Guarda para asignarlo.`);
    if (ok) {
      input.value = '';
      $('inst-plugin-nombre').value = '';
      $('inst-plugin-token').value = '';
      $('inst-plugin-args').value = '';
    }
  });
  $('inst-save').addEventListener('click', saveInstalados);

  document.querySelectorAll('.perfil-tab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
  document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addSkill(b.dataset.add)));
  $('perfil-file').addEventListener('change', (e) => {
    loadFiles([...e.target.files]);
    e.target.value = '';
  });
  ['perfil-rol', 'perfil-label', 'perfil-plantilla'].forEach((id) =>
    $(id).addEventListener('input', () => {
      dirty.rol = true;
      updateCounts();
    })
  );
  $('perfil-autonomous').addEventListener('change', () => {
    dirty.rol = true;
  });
  $('perfil-autonomia').addEventListener('change', () => {
    dirty.rol = true;
    fillAutonomiaHint();
  });
  $('perfil-ciclo').addEventListener('input', () => {
    const v = $('perfil-ciclo').value;
    cicloValor = v === '' ? null : Number(v);
    cicloDirty = true;
    dirty.rol = true;
  });
  $('perfil-ciclo-default').addEventListener('click', () => {
    cicloValor = null;
    cicloDirty = true;
    dirty.rol = true;
    $('perfil-ciclo').value = perfil.ciclo?.porDefecto ?? '';
    $('perfil-ciclo-hint').textContent = 'Volverá al valor por defecto al guardar.';
  });
  $('perfil-memoria').addEventListener('input', () => {
    dirty.memoria = true;
    updateCounts();
  });
  $('perfil-rol-save').addEventListener('click', saveRol);
  $('perfil-tools-save').addEventListener('click', saveTools);
  $('bd-probar').addEventListener('click', testDb);
  $('bd-log-reload').addEventListener('click', async () => renderLog(await fetchConsultasBD({ agentId }).catch(() => [])));
  $('bd-activa').addEventListener('change', () => {
    dirty.herramientas = true;
  });
  $('mail-activo').addEventListener('change', () => {
    dirty.herramientas = true;
  });
  ['mail-permitidos', 'mail-limite'].forEach((id) =>
    $(id).addEventListener('input', () => {
      mailConfigDirty = true;
      dirty.herramientas = true;
    })
  );
  $('mail-probar').addEventListener('click', async () => {
    const button = $('mail-probar');
    setBusy(button, true);
    $('mail-test-result').textContent = 'Probando…';
    try {
      const r = await probarCorreo();
      $('mail-test-result').textContent = `✓ Conectó como ${r.remitente}`;
    } catch (err) {
      $('mail-test-result').textContent = `✕ ${err.message}`;
    } finally {
      setBusy(button, false);
    }
  });
  $('mail-log-reload').addEventListener('click', async () => renderMailLog(await fetchCorreos({ agentId, limite: 20 }).catch(() => [])));
  $('perfil-skills-save').addEventListener('click', saveSkills);
  $('perfil-mem-save').addEventListener('click', saveMem);
  $('perfil-mem-reload').addEventListener('click', reloadMem);
  $('perfil-mem-compress').addEventListener('click', compressMem);
  $('perfil-close').addEventListener('click', () => close());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('visible')) {
      e.stopImmediatePropagation();
      close();
    }
  });

  return { open, close, isOpen: () => modal.classList.contains('visible') };
}
