/**
 * board.js — the Kanban board.
 *
 * Drag and drop uses the browser's native HTML5 API: no library. A card's
 * position within a column is stored as a number (`order`); dropping a card
 * between two others gives it the midpoint of their orders, so only the
 * moved card ever needs saving.
 */
import { $, esc, toast, todayISO, daysBetween, daysAgoText } from './util.js';
import { api } from './api.js';
import { state, getJob, upsertJob, subscribe } from './state.js';

export const COLUMNS = [
  { id: 'saved', label: 'Saved', empty: 'Jobs you\'re considering. Add one with "Add job".' },
  { id: 'applied', label: 'Applied', empty: 'Drag a card here once you\'ve sent the application.' },
  { id: 'interview', label: 'Interviewing', empty: 'Move a card here when an interview is scheduled.' },
  { id: 'offer', label: 'Offer', empty: 'Offers land here.' },
  { id: 'rejected', label: 'Rejected', empty: 'Closed applications stay here for reference.' }
];

const ACTIVE = ['applied', 'interview'];
let openJobHandler = () => {};
let draggingId = null;

export function initBoard({ onOpenJob }) {
  openJobHandler = onOpenJob;
  subscribe(renderBoard);
}

function matchesFilter(job) {
  const q = state.filter.trim().toLowerCase();
  if (!q) return true;
  return [job.company, job.role, job.location, job.notes, job.salary]
    .some((v) => String(v || '').toLowerCase().includes(q));
}

function renderBoard() {
  const board = $('#board');
  board.innerHTML = '';

  for (const col of COLUMNS) {
    const jobs = state.jobs
      .filter((j) => j.status === col.id && matchesFilter(j))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const column = document.createElement('section');
    column.className = `column col-${col.id}`;
    column.dataset.status = col.id;
    column.setAttribute('aria-label', `${col.label}, ${jobs.length} jobs`);
    column.innerHTML = `
      <header class="column-head">
        <h2>${col.label}</h2>
        <span class="count">${jobs.length}</span>
      </header>
      <div class="column-list"></div>
    `;

    const list = column.querySelector('.column-list');
    if (!jobs.length) {
      list.innerHTML = `<p class="column-empty">${state.filter ? 'No matches.' : esc(col.empty)}</p>`;
    }
    jobs.forEach((job) => list.appendChild(card(job)));

    wireDropTarget(column, list);
    board.appendChild(column);
  }
}

function followUpBadge(job) {
  if (!ACTIVE.includes(job.status) || !job.followUpDate) return '';
  const d = daysBetween(todayISO(), job.followUpDate);
  if (d < 0) return `<span class="badge badge-due">Follow-up overdue</span>`;
  if (d === 0) return `<span class="badge badge-due">Follow up today</span>`;
  if (d <= 3) return `<span class="badge badge-soon">Follow up in ${d} day${d > 1 ? 's' : ''}</span>`;
  return '';
}

function card(job) {
  const el = document.createElement('article');
  el.className = 'card';
  el.draggable = true;
  el.tabIndex = 0;
  el.dataset.id = job.id;

  const place = [job.location, job.workMode && { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' }[job.workMode]]
    .filter(Boolean).join(', ');

  const score = job.analysis
    ? `<span class="badge score score-${job.analysis.band}" title="Match with ${esc(job.analysis.cvLabel || 'your CV')}">${job.analysis.score}% match</span>`
    : '';

  const applied = job.appliedAt && job.status !== 'saved'
    ? `<span class="card-when">Applied ${daysAgoText(job.appliedAt)}</span>`
    : '';

  el.innerHTML = `
    <p class="card-company">${esc(job.company || 'Unknown company')}</p>
    <h3 class="card-role">${esc(job.role || 'Untitled role')}</h3>
    ${place ? `<p class="card-place">${esc(place)}</p>` : ''}
    <div class="card-foot">${score}${followUpBadge(job)}${applied}</div>
  `;

  el.addEventListener('click', () => openJobHandler(job.id));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openJobHandler(job.id); }
  });

  el.addEventListener('dragstart', (e) => {
    draggingId = job.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', job.id);
    requestAnimationFrame(() => el.classList.add('is-dragging'));
  });
  el.addEventListener('dragend', () => {
    draggingId = null;
    el.classList.remove('is-dragging');
    document.querySelectorAll('.drop-marker').forEach((m) => m.remove());
    document.querySelectorAll('.column.is-over').forEach((c) => c.classList.remove('is-over'));
  });

  return el;
}

/** The card the dragged one should be inserted before, given the pointer's Y position. */
function cardAfterPointer(list, y) {
  const cards = [...list.querySelectorAll('.card:not(.is-dragging)')];
  return cards.find((c) => {
    const box = c.getBoundingClientRect();
    return y < box.top + box.height / 2;
  }) || null;
}

function wireDropTarget(column, list) {
  column.addEventListener('dragover', (e) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    column.classList.add('is-over');

    let marker = list.querySelector('.drop-marker');
    if (!marker) {
      document.querySelectorAll('.drop-marker').forEach((m) => m.remove());
      marker = document.createElement('div');
      marker.className = 'drop-marker';
    }
    const before = cardAfterPointer(list, e.clientY);
    if (before) list.insertBefore(marker, before);
    else list.appendChild(marker);
  });

  column.addEventListener('dragleave', (e) => {
    if (!column.contains(e.relatedTarget)) {
      column.classList.remove('is-over');
      list.querySelector('.drop-marker')?.remove();
    }
  });

  column.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || draggingId;
    const marker = list.querySelector('.drop-marker');
    column.classList.remove('is-over');
    if (!id || !marker) return;

    const neighbour = (node, dir) => {
      let n = node[dir];
      while (n && !(n.classList?.contains('card') && n.dataset.id !== id)) n = n[dir];
      return n ? getJob(n.dataset.id) : null;
    };
    const prev = neighbour(marker, 'previousElementSibling');
    const next = neighbour(marker, 'nextElementSibling');
    marker.remove();

    let order;
    if (prev && next) order = ((prev.order ?? 0) + (next.order ?? 0)) / 2;
    else if (prev) order = (prev.order ?? 0) + 1000;
    else if (next) order = (next.order ?? 0) - 1000;
    else order = 0;

    moveJob(id, column.dataset.status, order);
  });
}

/** Moves a job immediately on screen, then saves; puts it back if saving fails. */
export async function moveJob(id, status, order) {
  const job = getJob(id);
  if (!job) return;
  if (job.status === status && order === undefined) return;

  const before = { ...job };
  const patch = { status };
  if (order !== undefined) patch.order = order;
  upsertJob({ ...job, ...patch });

  try {
    const { job: saved } = await api.updateJob(id, patch);
    upsertJob(saved);
    if (status !== before.status) {
      const label = COLUMNS.find((c) => c.id === status)?.label;
      toast(`Moved to ${label}`);
    }
  } catch (err) {
    upsertJob(before);
    toast(err.message, 'error');
  }
}
