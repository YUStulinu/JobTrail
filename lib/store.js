/**
 * store.js — JSON-file persistence for jobs and CVs.
 *
 * All data lives in data/db.json. Writes are queued one after another and
 * written to a temp file first, then renamed into place, so a crash or two
 * overlapping saves can never leave a half-written, corrupted file.
 */
const fs = require('fs/promises');
const path = require('path');

// JOBTRAIL_DATA_DIR lets tests (or a deployment) keep the data elsewhere.
const DATA_DIR = process.env.JOBTRAIL_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = null;
let writeChain = Promise.resolve();

async function load() {
  if (db) return db;
  try {
    db = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Never silently overwrite a file we couldn't read — keep a copy.
      const backup = DB_FILE + '.corrupt-' + Date.now();
      await fs.copyFile(DB_FILE, backup).catch(() => {});
      console.error(`Could not read ${DB_FILE}; a copy was kept at ${backup}.`);
    }
    db = {};
  }
  db.jobs = Array.isArray(db.jobs) ? db.jobs : [];
  db.cvs = Array.isArray(db.cvs) ? db.cvs : [];
  return db;
}

function save() {
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
      await fs.rename(tmp, DB_FILE);
    })
    .catch((err) => console.error('Failed to save data:', err.message));
  return writeChain;
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const now = () => new Date().toISOString();

/* ---------------- Jobs ---------------- */

async function listJobs() {
  return (await load()).jobs;
}

async function getJob(id) {
  return (await load()).jobs.find((j) => j.id === id) || null;
}

async function createJob(fields) {
  const data = await load();
  const job = { id: newId('job'), createdAt: now(), updatedAt: now(), ...fields };
  data.jobs.push(job);
  await save();
  return job;
}

async function updateJob(id, patch) {
  const job = await getJob(id);
  if (!job) return null;
  Object.assign(job, patch, { id: job.id, updatedAt: now() });
  await save();
  return job;
}

async function deleteJob(id) {
  const data = await load();
  const before = data.jobs.length;
  data.jobs = data.jobs.filter((j) => j.id !== id);
  await save();
  return data.jobs.length < before;
}

/* ---------------- CVs ---------------- */

async function listCvs() {
  return (await load()).cvs;
}

async function getCv(id) {
  return (await load()).cvs.find((c) => c.id === id) || null;
}

async function getDefaultCv() {
  const cvs = await listCvs();
  return cvs.find((c) => c.isDefault) || cvs[0] || null;
}

async function createCv(fields) {
  const data = await load();
  const cv = {
    id: newId('cv'),
    createdAt: now(),
    updatedAt: now(),
    isDefault: data.cvs.length === 0, // the first CV becomes the default
    ...fields
  };
  data.cvs.push(cv);
  await save();
  return cv;
}

async function updateCv(id, patch) {
  const data = await load();
  const cv = data.cvs.find((c) => c.id === id);
  if (!cv) return null;
  if (patch.isDefault) data.cvs.forEach((c) => { c.isDefault = false; });
  Object.assign(cv, patch, { id: cv.id, updatedAt: now() });
  await save();
  return cv;
}

async function deleteCv(id) {
  const data = await load();
  const target = data.cvs.find((c) => c.id === id);
  if (!target) return false;
  data.cvs = data.cvs.filter((c) => c.id !== id);
  if (target.isDefault && data.cvs.length) data.cvs[0].isDefault = true;
  await save();
  return true;
}

/* ---------------- Backup ---------------- */

async function exportAll() {
  const data = await load();
  return { app: 'jobtrail', version: 1, exportedAt: now(), jobs: data.jobs, cvs: data.cvs };
}

/** Merges a backup into the current data: records with the same id are replaced. */
async function importAll(payload) {
  const data = await load();
  const counts = { jobs: 0, cvs: 0 };

  for (const key of ['jobs', 'cvs']) {
    const incoming = Array.isArray(payload[key]) ? payload[key] : [];
    for (const rec of incoming) {
      if (!rec || typeof rec.id !== 'string') continue;
      const idx = data[key].findIndex((x) => x.id === rec.id);
      if (idx >= 0) data[key][idx] = rec;
      else data[key].push(rec);
      counts[key] += 1;
    }
  }

  // Exactly one default CV after a merge.
  const defaults = data.cvs.filter((c) => c.isDefault);
  if (defaults.length !== 1 && data.cvs.length) {
    data.cvs.forEach((c, i) => { c.isDefault = defaults.length ? c === defaults[0] : i === 0; });
  }

  await save();
  return counts;
}

module.exports = {
  listJobs, getJob, createJob, updateJob, deleteJob,
  listCvs, getCv, getDefaultCv, createCv, updateCv, deleteCv,
  exportAll, importAll
};
