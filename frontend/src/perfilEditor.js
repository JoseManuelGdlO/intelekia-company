import { fetchPerfil, savePerfil, fetchMemoria, saveMemoria, comprimirMemoria } from './api.js';

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
  let dirty = { rol: false, skills: false, memoria: false };
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
    $('perfil-rol-hint').textContent = isCustom
      ? 'Contexto que le diste al crearlo.'
      : 'Se guarda en su archivo de rol (departamentos/…/agentes). Ojo: si pide un formato de salida específico, consérvalo.';
  }

  async function open(id) {
    agentId = id;
    dirty = { rol: false, skills: false, memoria: false };
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
      if (perfil.tipo === 'custom') {
        patch.label = $('perfil-label').value;
        patch.autonomous = $('perfil-autonomous').checked;
      }
      const previousLabel = perfil.label;
      perfil = await savePerfil(agentId, patch);
      fillRol();
      dirty.rol = false;
      notify('Rol guardado ✓ — aplica desde su siguiente tarea');
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

  async function loadFiles(files) {
    for (const file of files) {
      const text = await file.text();
      const tipo = /\.json$/i.test(file.name) ? 'documento' : /plugin/i.test(file.name) ? 'plugin' : 'skill';
      addSkill(tipo, guessName(file.name, text), text);
    }
  }

  document.querySelectorAll('.perfil-tab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
  document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addSkill(b.dataset.add)));
  $('perfil-file').addEventListener('change', (e) => {
    loadFiles([...e.target.files]);
    e.target.value = '';
  });
  ['perfil-rol', 'perfil-label'].forEach((id) =>
    $(id).addEventListener('input', () => {
      dirty.rol = true;
      updateCounts();
    })
  );
  $('perfil-autonomous').addEventListener('change', () => {
    dirty.rol = true;
  });
  $('perfil-memoria').addEventListener('input', () => {
    dirty.memoria = true;
    updateCounts();
  });
  $('perfil-rol-save').addEventListener('click', saveRol);
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
