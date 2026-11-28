/**
 * Tests for the command line's checks (lib/check.js), on the samples: an agent's analysis with an
 * invented claim, a changed number and a missed keyword, and a cover letter that overstates.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkMatch, checkLetter } = require('../lib/check');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'samples', f), 'utf8');
const cv = read('cv-alex-morgan.txt');
const job = read('job-frontend.txt');
const analysis = JSON.parse(read('analysis.json'));

test('match: invented claims and changed numbers are downgraded, missed keywords found', () => {
  const r = checkMatch(analysis, cv, job);
  const changed = Object.fromEntries(r.checks.changes.map((c) => [c.requirement, `${c.claimed}->${c.now}`]));
  assert.equal(changed['4+ years of professional experience'], 'match->partial', '"4 years" quoted, the CV says 3');
  assert.equal(changed['Next.js'], 'match->partial', 'invented evidence');
  assert.equal(changed['REST APIs'], 'missing->match', 'it is in the CV');
  assert.deepEqual(r.checks.droppedRewrites.map((d) => d.original), ['Led the migration of the payments page to Next.js.']);
  assert.deepEqual(r.checks.notInAd, []);
  assert.equal(r.score, 61);
});

test('match: a requirement not worded as in the ad is flagged', () => {
  const r = checkMatch({ requirements: [{ name: 'Kubernetes', importance: 'required', status: 'missing' }, { name: 'React', status: 'match', evidence: 'React' }] }, cv, job);
  assert.deepEqual(r.checks.notInAd, ['Kubernetes']);
});

test('letter: numbers and skills the CV does not show are flagged, the notes count', () => {
  const letter = read('letter.txt');
  const r = checkLetter(letter, cv, '', analysis);
  assert.deepEqual(r.numbersNotInCv, ['5']);
  assert.deepEqual(r.skillsNotInCv.map((s) => s.requirement).sort(), ['GraphQL', 'Next.js']);
  assert.equal(r.ok, false);
  const withNotes = checkLetter(letter, cv, 'I have used GraphQL in side projects for 5 years.', analysis);
  assert.deepEqual(withNotes.numbersNotInCv, []);
  assert.deepEqual(withNotes.skillsNotInCv.map((s) => s.requirement), ['Next.js']);
});

test('the command line reads a PDF CV the way an ATS would', () => {
  const bin = path.join(__dirname, '..', 'bin', 'jobtrail.js');
  const out = JSON.parse(execFileSync(process.execPath, [bin, 'cv', path.join(__dirname, '..', 'samples', 'cv-alex-morgan.pdf')]).toString());
  assert.equal(out.hasEmail && out.hasPhone, true);
  assert.deepEqual(out.sections.sort(), ['education', 'experience', 'skills']);
  assert.match(out.text, /React and TypeScript dashboard used by 40 internal teams/);
  assert.deepEqual(out.warnings, []);
});
