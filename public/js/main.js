/**
 * main.js — starts the app: loads data, switches views, keeps the stats
 * line current, and runs the "Add job" dialog.
 */
import { $, $$, esc, toast, todayISO, debounce, withBusy } from './util.js';
import { api } from './api.js';
import { state, subscribe, setAll, setFilter, upsertJob } from './state.js';
import { initBoard } from './board.js';
import { initDrawer, openJob } from './drawer.js';
import { initCvs } from './cvs.js';

/* ---------------- Views ---------------- */

function showView(name) {
  $$('.view-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
  $('#searchInput').hidden = name !== 'board';
}

$$('.view-btn').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$('.wordmark').addEventListener('click', (e) => { e.preventDefault(); showView('board'); });

/* ---------------- Stats line ---------------- */

const everReached = (job, statuses) =>
  statuses.includes(job.status) || (job.history || []).some((h) => statuses.includes(h.status));

function renderStats() {
  const jobs = state.jobs;
  const el = $('#statsLine');
  if (!jobs.length) {
    el.innerHTML = state.cvs.length
      ? 'Your board is empty. Paste a job ad with <strong>Add job</strong> to start.'
      : 'Start by uploading your CV under <strong>CVs &amp; backup</strong>, then add the jobs you\'re looking at.';
    return;
  }

  const inProgress = jobs.filter((j) => ['applied', 'interview'].includes(j.status)).length;
  const offers = jobs.filter((j) => j.status === 'offer').length;
  const applied = jobs.filter((j) => everReached(j, ['applied', 'interview', 'offer', 'rejected'])).length;
  const interviewed = jobs.filter((j) => everReached(j, ['interview', 'offer'])).length;
  const due = jobs.filter((j) => ['applied', 'interview'].includes(j.status) && j.followUpDate && j.followUpDate <= todayISO()).length;

  const parts = [`${jobs.length} job${jobs.length > 1 ? 's' : ''} tracked, ${inProgress} in progress`];
  if (offers) parts[0] += `, ${offers} offer${offers > 1 ? 's' : ''}`;
  if (applied >= 3) parts.push(`${interviewed} of ${applied} applications reached an interview (${Math.round((interviewed / applied) * 100)}%)`);
  if (due) parts.push(`<strong>${due} follow-up${due > 1 ? 's' : ''} due</strong>`);
  el.innerHTML = parts.join('. ') + '.';
}

/* ---------------- Search ---------------- */

$('#searchInput').addEventListener('input', debounce((e) => setFilter(e.target.value), 150));

/* ---------------- Add job dialog ---------------- */

const addDialog = $('#addDialog');
const addFields = ['Company', 'Role', 'Location', 'WorkMode', 'Salary', 'Link'];

function openAddDialog() {
  $('#addForm').reset();
  delete addDialog.dataset.language;
  delete addDialog.dataset.seniority;
  $('#addError').hidden = true;
  $('#autofillStatus').textContent = '';
  $('#autofillBtn').disabled = !state.ai;
  if (!state.ai) $('#autofillStatus').textContent = 'Needs an API key — fill the fields by hand.';
  addDialog.showModal();
  $('#addDescription').focus();
}

$('#addJobBtn').addEventListener('click', openAddDialog);
$$('[data-close]', addDialog).forEach((b) => b.addEventListener('click', () => addDialog.close()));

$('#autofillBtn').addEventListener('click', (e) => withBusy(e.currentTarget, 'Reading the ad…', async () => {
  const text = $('#addDescription').value.trim();
  if (text.length < 80) {
    $('#autofillStatus').textContent = 'Paste the full ad first.';
    return;
  }
  try {
    const { fields } = await api.extract(text);
    let filled = 0;
    for (const name of ['company', 'role', 'location', 'workMode', 'salary']) {
      const input = $(`#add${name[0].toUpperCase()}${name.slice(1)}`);
      if (fields[name] && !input.value.trim()) { input.value = fields[name]; filled++; }
    }
    $('#autofillStatus').textContent = filled
      ? `Filled in ${filled} field${filled > 1 ? 's' : ''} — check them before adding.`
      : 'Nothing new to fill in.';
    $('#addDialog').dataset.language = fields.language || '';
    $('#addDialog').dataset.seniority = fields.seniority || '';
  } catch (err) {
    $('#autofillStatus').textContent = err.message;
  }
}));

$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    description: $('#addDescription').value,
    status: $('#addStatus').value,
    language: addDialog.dataset.language || '',
    seniority: addDialog.dataset.seniority || ''
  };
  for (const f of addFields) body[f[0].toLowerCase() + f.slice(1)] = $(`#add${f}`).value;

  if (!body.company.trim() && !body.role.trim()) {
    $('#addError').textContent = 'Add at least a company or a role — or use "Fill in details from the ad".';
    $('#addError').hidden = false;
    return;
  }

  await withBusy($('#addSubmit'), 'Adding…', async () => {
    try {
      const { job } = await api.createJob(body);
      upsertJob(job);
      addDialog.close();
      delete addDialog.dataset.language;
      delete addDialog.dataset.seniority;
      toast(`Added ${job.role || job.company}`);
      // Straight to the analysis when everything it needs is there.
      const ready = state.cvs.length && (job.description || '').length >= 80;
      openJob(job.id, ready ? 'match' : 'details');
    } catch (err) {
      $('#addError').textContent = err.message;
      $('#addError').hidden = false;
    }
  });
});

/* ---------------- Keyboard shortcut ---------------- */

document.addEventListener('keydown', (e) => {
  if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches('input, textarea, select') || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  openAddDialog();
});

/* ---------------- Start ---------------- */

initBoard({ onOpenJob: (id) => openJob(id) });
initDrawer({ onGoToCvs: () => showView('cvs') });
initCvs();

subscribe(renderStats);
subscribe(() => { $('#aiBanner').hidden = state.ai; });

(async function start() {
  try {
    setAll(await api.state());
    if (!state.cvs.length && !state.jobs.length) showView('cvs');
  } catch (err) {
    $('#statsLine').innerHTML = `<span class="error">${esc(err.message)}</span>`;
    toast(err.message, 'error');
  }
})();
