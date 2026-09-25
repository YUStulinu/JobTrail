/**
 * state.js — the single source of truth on the client. Views subscribe and
 * re-render whenever something changes, so no view has to know about the others.
 */

export const state = { jobs: [], cvs: [], ai: false, filter: '' };

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  listeners.forEach((fn) => fn(state));
}

export function setAll({ jobs, cvs, ai }) {
  state.jobs = jobs || [];
  state.cvs = cvs || [];
  state.ai = Boolean(ai);
  emit();
}

export function getJob(id) {
  return state.jobs.find((j) => j.id === id) || null;
}

export function upsertJob(job) {
  const i = state.jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) state.jobs[i] = job;
  else state.jobs.push(job);
  emit();
}

export function removeJob(id) {
  state.jobs = state.jobs.filter((j) => j.id !== id);
  emit();
}

export function upsertCv(cv) {
  if (cv.isDefault) state.cvs.forEach((c) => { c.isDefault = false; });
  const i = state.cvs.findIndex((c) => c.id === cv.id);
  if (i >= 0) state.cvs[i] = cv;
  else state.cvs.push(cv);
  emit();
}

export function removeCv(id) {
  const wasDefault = state.cvs.find((c) => c.id === id)?.isDefault;
  state.cvs = state.cvs.filter((c) => c.id !== id);
  if (wasDefault && state.cvs.length) state.cvs[0].isDefault = true;
  emit();
}

export function defaultCv() {
  return state.cvs.find((c) => c.isDefault) || state.cvs[0] || null;
}

export function setFilter(text) {
  state.filter = text;
  emit();
}
