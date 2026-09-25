/** util.js — small DOM, formatting and browser helpers used everywhere. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MAX_TOASTS = 3;

export function toast(message, kind = 'info') {
  const box = document.getElementById('toasts');
  // Modal dialogs live in the browser's "top layer", above any z-index.
  // Re-showing the container as a popover puts it back on top of them.
  if (box.showPopover) {
    try { box.hidePopover(); } catch { /* not shown yet */ }
    try { box.showPopover(); } catch { /* unsupported */ }
  }
  while (box.children.length >= MAX_TOASTS) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  box.appendChild(el);
  const life = kind === 'error' ? 6000 : 3000;
  setTimeout(() => el.classList.add('is-leaving'), life);
  setTimeout(() => el.remove(), life + 400);
}

export async function copyText(text, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers that block the async clipboard API.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label);
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Whole days from `from` to `to` (YYYY-MM-DD strings). */
export function daysBetween(from, to) {
  const [a, b] = [from, to].map((s) => {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86400000);
}

export function formatDate(value) {
  if (!value) return '';
  const d = new Date(String(value).length === 10 ? value + 'T12:00:00' : value);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function daysAgoText(dateStr) {
  const n = daysBetween(dateStr, todayISO());
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 7) return `${n} days ago`;
  const w = Math.round(n / 7);
  return w === 1 ? '1 week ago' : `${w} weeks ago`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Same hash as the server (lib/text.js), to spot edits since the last analysis. */
export function hash(str) {
  let h = 5381;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Puts a button into a busy state for the duration of an async task. */
export async function withBusy(button, busyLabel, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  button.classList.add('is-busy');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
    button.classList.remove('is-busy');
  }
}
