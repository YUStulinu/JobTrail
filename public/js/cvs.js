/**
 * cvs.js — the "CVs & backup" view: upload CV versions, see what an ATS
 * can read from each file, fix the extracted text, and restore backups.
 */
import { $, $$, esc, toast, formatDate, withBusy } from './util.js';
import { api } from './api.js';
import { state, subscribe, upsertCv, removeCv, setAll } from './state.js';

let editingCvId = null;

export function initCvs() {
  subscribe(renderCvList);

  const fileInput = $('#cvFile');
  const dropzone = $('#cvDropzone');

  const showChosen = () => {
    const f = fileInput.files?.[0];
    $('#cvDropTitle').textContent = f ? f.name : 'Choose a CV file';
    if (f && !$('#cvLabel').value.trim()) $('#cvLabel').value = f.name.replace(/\.[^.]+$/, '');
  };
  fileInput.addEventListener('change', showChosen);

  ['dragover', 'dragenter'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); dropzone.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); dropzone.classList.remove('is-over');
  }));
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files?.length) {
      fileInput.files = e.dataTransfer.files;
      showChosen();
    }
  });

  $('#cvUploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files?.[0];
    if (!file) { toast('Choose a PDF, DOCX or TXT file first.', 'error'); return; }

    const form = new FormData();
    form.append('file', file);
    form.append('label', $('#cvLabel').value.trim());

    await withBusy($('#cvUploadBtn'), 'Reading your CV…', async () => {
      try {
        const { cv } = await api.uploadCv(form);
        upsertCv(cv);
        fileInput.value = '';
        $('#cvLabel').value = '';
        $('#cvDropTitle').textContent = 'Choose a CV file';
        toast(cv.health.warnings.length
          ? `CV uploaded — ${cv.health.warnings.length} thing${cv.health.warnings.length > 1 ? 's' : ''} to check below`
          : 'CV uploaded, and it reads cleanly');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  // Extracted-text editor
  const dialog = $('#textDialog');
  $$('[data-close]', dialog).forEach((b) => b.addEventListener('click', () => dialog.close()));
  $('#cvTextSave').addEventListener('click', (e) => withBusy(e.currentTarget, 'Saving…', async () => {
    try {
      const { cv } = await api.updateCv(editingCvId, { text: $('#cvTextArea').value });
      upsertCv(cv);
      dialog.close();
      toast('CV text saved. Re-run analyses that used this CV to pick up the change.');
    } catch (err) {
      toast(err.message, 'error');
    }
  }));

  // Backup restore
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!confirm(`Restore ${data.jobs?.length || 0} jobs and ${data.cvs?.length || 0} CVs from this backup? Matching entries will be replaced.`)) return;
      const { imported } = await api.importBackup(data);
      setAll(await api.state());
      toast(`Restored ${imported.jobs} jobs and ${imported.cvs} CVs`);
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file isn\'t valid JSON.' : err.message, 'error');
    }
  });
}

function check(ok, label) {
  return `<li class="${ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok ? '✓' : '✕'}</span> ${label}</li>`;
}

function renderCvList() {
  const list = $('#cvList');
  if (!state.cvs.length) {
    list.innerHTML = '<p class="empty-note">No CVs yet. Upload one above to unlock match analysis and cover letters.</p>';
    return;
  }

  list.innerHTML = state.cvs.map((cv) => {
    const h = cv.health || { warnings: [], sections: [] };
    const has = (s) => (h.sections || []).includes(s);
    return `
      <article class="cv-card ${cv.isDefault ? 'is-default' : ''}" data-id="${cv.id}">
        <div class="cv-head">
          <div>
            <h3>${esc(cv.label)} ${cv.isDefault ? '<span class="tag">Default</span>' : ''}</h3>
            <p class="muted">${esc(cv.filename || '')}, ${h.words ?? '?'} words, added ${formatDate(cv.createdAt)}</p>
          </div>
          <div class="cv-actions">
            <button type="button" class="btn btn-quiet btn-small" data-act="text">Check extracted text</button>
            ${cv.isDefault ? '' : '<button type="button" class="btn btn-quiet btn-small" data-act="default">Make default</button>'}
            <button type="button" class="btn btn-quiet btn-small" data-act="rename">Rename</button>
            <button type="button" class="btn btn-danger btn-small" data-act="delete">Delete</button>
          </div>
        </div>
        <ul class="checks">
          ${check(h.hasEmail, 'Email')}
          ${check(h.hasPhone, 'Phone')}
          ${check(h.hasLinkedIn, 'LinkedIn')}
          ${check(has('experience'), 'Experience section')}
          ${check(has('education'), 'Education section')}
          ${check(has('skills'), 'Skills section')}
        </ul>
        ${h.warnings?.length
          ? `<ul class="plain-list warn-list">${h.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
          : '<p class="all-good">An ATS should be able to read this file without problems.</p>'}
      </article>`;
  }).join('');

  $$('.cv-card', list).forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => cvAction(btn.dataset.act, id)));
  });
}

async function cvAction(action, id) {
  const cv = state.cvs.find((c) => c.id === id);
  if (!cv) return;
  try {
    if (action === 'text') {
      const { cv: full } = await api.getCv(id);
      editingCvId = id;
      $('#textTitle').textContent = `Text read from ${full.label}`;
      $('#cvTextArea').value = full.text;
      $('#textDialog').showModal();
    } else if (action === 'default') {
      upsertCv((await api.updateCv(id, { isDefault: true })).cv);
      toast(`${cv.label} is now your default CV`);
    } else if (action === 'rename') {
      const label = prompt('New name for this CV:', cv.label);
      if (!label || !label.trim()) return;
      upsertCv((await api.updateCv(id, { label: label.trim() })).cv);
    } else if (action === 'delete') {
      if (!confirm(`Delete "${cv.label}"? Analyses already made with it are kept.`)) return;
      await api.deleteCv(id);
      removeCv(id);
      toast('CV deleted');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}
