// Tests for CV text cleanup, the ATS readability check, the text helpers and the JSON store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobtrail-'));
process.env.JOBTRAIL_DATA_DIR = dataDir;

const { extractText, cleanText, checkCvHealth } = require('../lib/parse');
const { tokens, hash } = require('../lib/text');
const store = require('../lib/store');

test('PDF text is cleaned: page markers, hyphenation, spacing and blank lines', () => {
  const raw = 'Senior   Devel-\nopment Lead\r\n-- 1 of 2 --\n\n\n\nPython, Go  \n  Done';
  assert.equal(cleanText(raw), 'Senior Development Lead\n\nPython, Go\nDone');
  assert.equal(cleanText(null), '');
});

test('a readable CV with contact data and standard headings has no warnings', () => {
  const body = 'Built and shipped services. '.repeat(40);
  const cv = `Ana Pop\nana.pop@example.com\n+40 712 345 678\nlinkedin.com/in/anapop\n` +
    `Work Experience\n${body}\nEducation\nUniversity of Craiova\nSkills\nJava, SQL`;
  const h = checkCvHealth(cv);
  assert.deepEqual(h.warnings, []);
  assert.deepEqual(h.sections, ['experience', 'education', 'skills']);
  assert.ok(h.hasEmail && h.hasPhone && h.hasLinkedIn);
});

test('Romanian headings count, and short or contact-less CVs are flagged', () => {
  const ro = checkCvHealth('Experiență profesională\nEducație\nCompetențe');
  assert.deepEqual(ro.sections, ['experience', 'education', 'skills']);
  assert.ok(ro.warnings.some((w) => w.startsWith('Very little text')));
  assert.ok(ro.warnings.includes('No phone number was found.'));
  assert.ok(ro.warnings.some((w) => w.startsWith('No email address')));
  const long = checkCvHealth('experience education skills a@b.co 0712345678 ' + 'word '.repeat(1400));
  assert.ok(long.warnings.some((w) => /3\+ pages/.test(w)));
});

test('text files are read; .doc and unknown types are refused with a 400', async () => {
  assert.equal(await extractText(Buffer.from('Hello\r\n\n\n\nWorld'), 'cv.TXT'), 'Hello\n\nWorld');
  await assert.rejects(extractText(Buffer.from('x'), 'cv.doc'), { status: 400, message: /\.doc files/ });
  await assert.rejects(extractText(Buffer.from('x'), 'cv.rtf'), { status: 400 });
});

test('tokens keep technical names and drop short words; hashes are stable', () => {
  assert.deepEqual(tokens('C++ and Node.js on ASP.NET, by me'), ['c++', 'and', 'node.js', 'asp.net']);
  assert.equal(hash('abc'), hash('abc'));
  assert.notEqual(hash('abc'), hash('abd'));
  assert.equal(hash(undefined), hash(''));
});

test('the first CV is the default, and deleting it promotes the next one', async () => {
  const a = await store.createCv({ label: 'General', text: 'cv a' });
  const b = await store.createCv({ label: 'Backend', text: 'cv b' });
  assert.equal(a.isDefault, true);
  assert.equal(b.isDefault, false);
  await store.updateCv(b.id, { isDefault: true });
  assert.equal((await store.getDefaultCv()).id, b.id);
  assert.equal((await store.getCv(a.id)).isDefault, false);
  assert.equal(await store.deleteCv(b.id), true);
  assert.equal((await store.getDefaultCv()).id, a.id);
  assert.equal(await store.deleteCv('missing'), false);
});

test('jobs are created, updated without changing their id, and deleted; data reaches disk', async () => {
  const job = await store.createJob({ company: 'Acme', status: 'saved' });
  const updated = await store.updateJob(job.id, { status: 'applied', id: 'hijack' });
  assert.equal(updated.id, job.id);
  assert.equal(updated.status, 'applied');
  assert.equal(await store.updateJob('missing', {}), null);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  assert.equal(onDisk.jobs.find((j) => j.id === job.id).status, 'applied');
  assert.equal(await store.deleteJob(job.id), true);
  assert.equal(await store.deleteJob(job.id), false);
});

test('importing a backup replaces records by id, skips junk and keeps exactly one default CV', async () => {
  const before = await store.exportAll();
  assert.equal(before.app, 'jobtrail');
  const existing = before.cvs[0];
  const counts = await store.importAll({
    jobs: [{ id: 'job_x', company: 'Imported' }, null, { company: 'no id' }],
    cvs: [{ ...existing, label: 'Renamed' }, { id: 'cv_y', label: 'Other', isDefault: true }],
  });
  assert.deepEqual(counts, { jobs: 1, cvs: 2 });
  assert.equal((await store.getCv(existing.id)).label, 'Renamed');
  assert.equal((await store.getJob('job_x')).company, 'Imported');
  const cvs = await store.listCvs();
  assert.equal(cvs.filter((c) => c.isDefault).length, 1);
});
