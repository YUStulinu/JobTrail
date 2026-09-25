require('dotenv').config();

const express = require('express');
const path = require('path');
const multer = require('multer');

const store = require('./lib/store');
const ai = require('./lib/ai');
const { extractText, cleanText, checkCvHealth } = require('./lib/parse');
const { buildResult } = require('./lib/scoring');
const { hash, numbersNotIn } = require('./lib/text');

const app = express();
const PORT = process.env.PORT || 3005;
const HOST = process.env.HOST || '127.0.0.1';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/** Wraps async handlers so any thrown error becomes a clean JSON response. */
const route = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    if (!err.status || err.status >= 500) console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Something went wrong on the server.' });
  });

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function notFound(what) {
  const err = new Error(`${what} not found.`);
  err.status = 404;
  return err;
}

/* ------------------------------------------------------------------ *
 * Jobs
 * ------------------------------------------------------------------ */

const STATUSES = ['saved', 'applied', 'interview', 'offer', 'rejected'];
const ACTIVE = ['applied', 'interview'];

const TEXT_FIELDS = {
  company: 120, role: 160, location: 120, workMode: 20, salary: 80, seniority: 20,
  link: 1000, contact: 200, notes: 20000, description: 40000, language: 5
};
const DATE_FIELDS = ['appliedAt', 'followUpDate'];

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Keeps only known fields, trims them and caps their length. */
function pickJobFields(body) {
  const out = {};
  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    if (typeof body[key] === 'string') out[key] = body[key].trim().slice(0, max);
  }
  for (const key of DATE_FIELDS) {
    if (body[key] === '' || body[key] === null) out[key] = '';
    else if (typeof body[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body[key])) out[key] = body[key];
  }
  if (STATUSES.includes(body.status)) out.status = body.status;
  if (typeof body.order === 'number' && Number.isFinite(body.order)) out.order = body.order;
  if (typeof body.cvId === 'string') out.cvId = body.cvId;
  if (body.coverLetter && typeof body.coverLetter === 'object') {
    out.coverLetter = {
      subject: String(body.coverLetter.subject || '').slice(0, 300),
      letter: String(body.coverLetter.letter || '').slice(0, 20000),
      options: body.coverLetter.options || {},
      cvId: typeof body.coverLetter.cvId === 'string' ? body.coverLetter.cvId : undefined,
      updatedAt: new Date().toISOString()
    };
  }
  return out;
}

/**
 * Small conveniences when a card changes column: record the move in the
 * history, stamp the application date, and suggest a follow-up a week out.
 */
function applyStatusChange(job, patch) {
  if (!patch.status || patch.status === job.status) return patch;
  const history = Array.isArray(job.history) ? job.history.slice() : [];
  history.push({ status: patch.status, at: new Date().toISOString() });
  patch.history = history;

  if (patch.status === 'applied' && !job.appliedAt && !patch.appliedAt) patch.appliedAt = today();
  if (ACTIVE.includes(patch.status) && !job.followUpDate && !patch.followUpDate) patch.followUpDate = addDays(7);
  return patch;
}

app.get('/api/health', route(async (req, res) => {
  res.json({ ok: true, ai: ai.hasApiKey() });
}));

/** Everything the board needs in one request. CV text is left out to keep it light. */
app.get('/api/state', route(async (req, res) => {
  const [jobs, cvs] = await Promise.all([store.listJobs(), store.listCvs()]);
  res.json({
    jobs,
    cvs: cvs.map(({ text, ...meta }) => meta),
    ai: ai.hasApiKey()
  });
}));

app.post('/api/jobs', route(async (req, res) => {
  const fields = pickJobFields(req.body);
  if (!fields.company && !fields.role) throw badRequest('Add at least a company or a role.');

  const status = fields.status || 'saved';
  const jobs = await store.listJobs();
  const inColumn = jobs.filter((j) => j.status === status);
  const topOrder = inColumn.length ? Math.min(...inColumn.map((j) => j.order ?? 0)) - 1000 : 0;

  const job = await store.createJob({
    company: '', role: '', location: '', workMode: '', salary: '', seniority: '',
    link: '', contact: '', notes: '', description: '', language: '',
    appliedAt: '', followUpDate: '',
    ...fields,
    status,
    order: topOrder,
    history: [{ status, at: new Date().toISOString() }],
    analysis: null,
    coverLetter: null
  });

  if (status === 'applied' && !job.appliedAt) {
    await store.updateJob(job.id, { appliedAt: today(), followUpDate: job.followUpDate || addDays(7) });
  }
  res.status(201).json({ job: await store.getJob(job.id) });
}));

app.patch('/api/jobs/:id', route(async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) throw notFound('Job');
  const patch = applyStatusChange(job, pickJobFields(req.body));
  if (patch.coverLetter) {
    const cv = patch.coverLetter.cvId ? await store.getCv(patch.coverLetter.cvId) : null;
    patch.coverLetter.uncheckedNumbers = cv
      ? numbersNotIn(patch.coverLetter.letter, `${cv.text}\n${patch.coverLetter.options?.notes || ''}`)
      : [];
  }
  res.json({ job: await store.updateJob(job.id, patch) });
}));

app.delete('/api/jobs/:id', route(async (req, res) => {
  if (!(await store.deleteJob(req.params.id))) throw notFound('Job');
  res.json({ ok: true });
}));

/** Reads a pasted job ad and returns suggested field values. Saves nothing. */
app.post('/api/jobs/extract', route(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (text.length < 80) throw badRequest('Paste the full job ad first — there is not enough text to read details from.');
  res.json({ fields: await ai.extractJobDetails(text) });
}));

async function resolveCv(cvId) {
  const cv = cvId ? await store.getCv(cvId) : await store.getDefaultCv();
  if (!cv) throw badRequest('Upload your CV first (CVs tab), then run this again.');
  if (!cv.text || cv.text.trim().length < 50) throw badRequest('That CV has almost no readable text. Check it in the CVs tab.');
  return cv;
}

function requireDescription(job) {
  if (!job.description || job.description.trim().length < 80) {
    throw badRequest('Paste the full job ad into the Details tab first — the analysis needs the job description.');
  }
}

app.post('/api/jobs/:id/analyze', route(async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) throw notFound('Job');
  requireDescription(job);
  const cv = await resolveCv(req.body.cvId);

  const raw = await ai.analyzeMatch({
    cvText: cv.text,
    jobText: job.description,
    role: job.role,
    company: job.company,
    language: req.body.language || 'auto'
  });

  const analysis = {
    ...buildResult(raw, cv.text),
    cvId: cv.id,
    cvLabel: cv.label,
    cvHash: hash(cv.text),
    jobHash: hash(job.description),
    language: req.body.language || 'auto',
    createdAt: new Date().toISOString()
  };

  res.json({ job: await store.updateJob(job.id, { analysis, cvId: cv.id }) });
}));

app.post('/api/jobs/:id/cover-letter', route(async (req, res) => {
  const job = await store.getJob(req.params.id);
  if (!job) throw notFound('Job');
  requireDescription(job);
  const cv = await resolveCv(req.body.cvId);
  const options = req.body.options || {};

  // Only reuse the analysis if it was made with this same CV.
  const analysis = job.analysis && job.analysis.cvId === cv.id ? job.analysis : null;

  const { subject, letter } = await ai.writeCoverLetter({
    cvText: cv.text,
    jobText: job.description,
    role: job.role,
    company: job.company,
    options,
    analysis
  });

  const coverLetter = {
    subject, letter, options, cvId: cv.id,
    uncheckedNumbers: numbersNotIn(letter, `${cv.text}\n${options.notes || ''}`),
    updatedAt: new Date().toISOString()
  };
  res.json({ job: await store.updateJob(job.id, { coverLetter, cvId: cv.id }) });
}));

/* ------------------------------------------------------------------ *
 * CVs
 * ------------------------------------------------------------------ */

const cvMeta = ({ text, ...meta }) => meta;

app.post('/api/cvs', upload.single('file'), route(async (req, res) => {
  if (!req.file) throw badRequest('Choose a CV file to upload.');
  const text = await extractText(req.file.buffer, req.file.originalname);
  if (!text) throw badRequest('No text could be read from that file. If it is a scanned image, export a text-based PDF or DOCX.');

  const label = String(req.body.label || '').trim().slice(0, 80) ||
    req.file.originalname.replace(/\.[^.]+$/, '');

  const cv = await store.createCv({
    label,
    filename: req.file.originalname,
    text,
    health: checkCvHealth(text)
  });
  res.status(201).json({ cv: cvMeta(cv) });
}));

app.get('/api/cvs/:id', route(async (req, res) => {
  const cv = await store.getCv(req.params.id);
  if (!cv) throw notFound('CV');
  res.json({ cv });
}));

app.patch('/api/cvs/:id', route(async (req, res) => {
  const patch = {};
  if (typeof req.body.label === 'string' && req.body.label.trim()) patch.label = req.body.label.trim().slice(0, 80);
  if (req.body.isDefault === true) patch.isDefault = true;
  if (typeof req.body.text === 'string') {
    // Lets you fix text the parser got wrong; analyses then use the corrected version.
    patch.text = cleanText(req.body.text).slice(0, 60000);
    patch.health = checkCvHealth(patch.text);
  }
  const cv = await store.updateCv(req.params.id, patch);
  if (!cv) throw notFound('CV');
  res.json({ cv: cvMeta(cv) });
}));

app.delete('/api/cvs/:id', route(async (req, res) => {
  if (!(await store.deleteCv(req.params.id))) throw notFound('CV');
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */

app.get('/api/export', route(async (req, res) => {
  const data = await store.exportAll();
  res.setHeader('Content-Disposition', `attachment; filename="jobtrail-backup-${today()}.json"`);
  res.json(data);
}));

app.post('/api/import', route(async (req, res) => {
  const body = req.body;
  if (!body || body.app !== 'jobtrail') throw badRequest('That file is not a JobTrail backup.');
  res.json({ imported: await store.importAll(body) });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API route.' }));

app.listen(PORT, HOST, () => {
  console.log(`JobTrail is running at http://localhost:${PORT}`);
  if (!ai.hasApiKey()) {
    console.warn('⚠️  ANTHROPIC_API_KEY is not set — the board works, but AI features will not. See .env.example.');
  }
});
