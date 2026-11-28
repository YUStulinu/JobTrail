/**
 * Tests for the parts of the match analysis that must be trustworthy:
 * term matching, evidence checks, and the deterministic score.
 * Run with: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, containsTerm, snippetAppearsIn, numbersNotIn } = require('../lib/text');
const { buildResult, computeScore } = require('../lib/scoring');

test('matches technical terms with punctuation, and respects word boundaries', () => {
  const cv = normalize('Experience with C++, C# and ASP.NET. JavaScript and Node.js. CI/CD pipelines.');
  assert.equal(containsTerm(cv, 'C++'), true);
  assert.equal(containsTerm(cv, 'C#'), true);
  assert.equal(containsTerm(cv, '.NET'), true);
  assert.equal(containsTerm(cv, 'Node.js'), true);
  assert.equal(containsTerm(cv, 'CI/CD'), true);
  assert.equal(containsTerm(cv, 'Java'), false, '"Java" must not match inside "JavaScript"');
  assert.equal(containsTerm(cv, 'Python'), false);
});

test('ignores Romanian diacritics when matching', () => {
  const cv = normalize('Experiență profesională. Engleză avansată. Competențe: SQL');
  assert.equal(containsTerm(cv, 'experienta'), true);
  assert.equal(containsTerm(cv, 'Engleza'), true);
  assert.equal(containsTerm(cv, 'Competente'), true);
});

test('accepts real quotes from the CV and rejects invented ones', () => {
  const cv = normalize('Built a React dashboard used by 40 internal teams.');
  assert.equal(snippetAppearsIn(cv, 'React dashboard used by 40 internal teams'), true);
  assert.equal(snippetAppearsIn(cv, 'Led a team of 12 engineers at Google'), false);
});

test('a quote with a changed number is not a quote', () => {
  const cv = normalize('3 years of experience with React and Redux in production.');
  assert.equal(snippetAppearsIn(cv, '3 years of experience with React and Redux'), true);
  assert.equal(snippetAppearsIn(cv, '5 years of experience with React and Redux'), false, 'same words, invented number');
  assert.equal(snippetAppearsIn(cv, 'experience with React, Redux in production 3 years'), true, 'reordered, same number');
});

test('flags numbers that do not appear in the CV', () => {
  const cv = 'Dashboard used by 40 teams, cut time by 30%. English (C1). 2022–2024.';
  assert.deepEqual(numbersNotIn('4+ years; 40 teams; 30% faster', cv), ['4']);
  assert.deepEqual(numbersNotIn('English B2, Web3 projects', cv), [], 'digits inside words are ignored');
  assert.deepEqual(numbersNotIn('2.5 years', 'about 2,5 years'), [], 'decimal separators are interchangeable');
});

test('corrects the AI in both directions and scores deterministically', () => {
  const cvText = 'Frontend Developer. Built dashboards in React and TypeScript. Tests with Jest. Databases: MySQL.';
  const ai = {
    requirements: [
      { name: 'React', importance: 'required', status: 'match', evidence: 'dashboards in React and TypeScript' },
      { name: 'TypeScript', importance: 'required', status: 'missing' },
      { name: 'Kubernetes', importance: 'required', status: 'match', evidence: 'Deployed services on Kubernetes' },
      { name: 'PostgreSQL', importance: 'preferred', status: 'partial', evidence: 'Databases: MySQL' },
      { name: 'GraphQL', importance: 'preferred', status: 'missing' },
      { name: 'react', importance: 'required', status: 'match', evidence: 'React' }
    ],
    bulletSuggestions: [
      { original: 'Built dashboards in React and TypeScript.', improved: 'Built React/TypeScript dashboards.', reason: '' },
      { original: 'Managed a budget of 2M EUR', improved: '...', reason: '' }
    ],
    tailoredSummary: 'Frontend developer with 5 years of React.'
  };

  const r = buildResult(ai, cvText);
  const status = Object.fromEntries(r.requirements.map((x) => [x.name, x.status]));

  assert.equal(r.requirements.length, 5, 'duplicate requirement removed');
  assert.equal(status.TypeScript, 'match', 'AI missed it; the CV has it');
  assert.equal(status.Kubernetes, 'partial', 'AI claimed it with invented evidence');
  assert.equal(r.requirements.find((x) => x.name === 'Kubernetes').evidence, '', 'invented quote is never shown');
  assert.equal(r.bulletSuggestions.length, 1, 'rewrite of a line not in the CV is dropped');
  assert.deepEqual(r.summaryUncheckedNumbers, ['5']);
  assert.deepEqual(r.keywordsToAdd, ['GraphQL']);
  // required (weight 3): 1 + 1 + 0.5 = 2.5 of 3 → 7.5 / 9; preferred (weight 1): 0.5 of 2 → 8 / 11
  assert.equal(r.score, 73);
  assert.deepEqual(buildResult(ai, cvText).score, r.score, 'same input, same score');
});

test('score bands', () => {
  const reqs = (m, n) => [
    ...Array(m).fill({ importance: 'required', status: 'match' }),
    ...Array(n - m).fill({ importance: 'required', status: 'missing' })
  ];
  assert.equal(computeScore(reqs(8, 10)).band, 'strong');
  assert.equal(computeScore(reqs(7, 10)).band, 'good');
  assert.equal(computeScore(reqs(5, 10)).band, 'fair');
  assert.equal(computeScore(reqs(3, 10)).band, 'weak');
});
