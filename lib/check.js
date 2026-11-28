/**
 * check.js — what the command line (bin/jobtrail.js) checks, for an AI agent that reads the job
 * ad and the CV itself and needs its claims verified by code before the candidate sees them.
 *
 *   match  — the agent's requirement list, checked against the CV (scoring.js) and the job ad
 *   letter — a cover letter's numbers and skill claims, checked against the CV and the notes
 */
const { normalize, containsTerm, snippetAppearsIn, numbersNotIn } = require('./text');
const { buildResult, verifyRequirements } = require('./scoring');

/** The analysis checked against the CV, with what the checks changed, and the job ad's wording. */
function checkMatch(analysis, cvText, jobText) {
  const result = buildResult(analysis || {}, cvText);
  const raw = new Map();
  for (const r of (analysis && analysis.requirements) || []) {
    if (r && r.name) raw.set(normalize(r.name), r);
  }
  const changes = [];
  for (const r of result.requirements) {
    const before = raw.get(normalize(r.name));
    if (before && before.status !== r.status) {
      changes.push({ requirement: r.name, claimed: before.status || 'missing', now: r.status, why: r.note });
    } else if (r.note) {
      changes.push({ requirement: r.name, claimed: before ? before.status : r.status, now: r.status, why: r.note });
    }
  }
  const droppedRewrites = ((analysis && analysis.bulletSuggestions) || []).filter(
    (s) => s && s.original && !result.bulletSuggestions.some((b) => b.original === String(s.original).trim())
  ).map((s) => ({ original: String(s.original), why: 'This line is not in the CV.' }));

  // ATS software matches the posting's literal keywords: a requirement should be worded as in the ad.
  let notInAd = [];
  if (jobText) {
    const normJob = normalize(jobText);
    notInAd = result.requirements
      .filter((r) => ![r.name, ...r.aliases].some((t) => containsTerm(normJob, t) || snippetAppearsIn(normJob, t)))
      .map((r) => r.name);
  }
  return { ...result, checks: { changes, droppedRewrites, notInAd } };
}

/**
 * A cover letter checked against what the candidate really has: every number must come from the
 * CV or the notes, and a requirement the analysis found missing must not be claimed.
 */
function checkLetter(letter, cvText, notes, analysis) {
  const source = `${cvText}\n${notes || ''}`;
  const numbers = numbersNotIn(letter, source);
  const normLetter = normalize(letter);
  let claimedMissing = [];
  if (analysis && Array.isArray(analysis.requirements)) {
    // Re-verify, so a "match" the CV does not support counts as missing here too.
    const reqs = verifyRequirements(analysis.requirements, cvText);
    claimedMissing = reqs
      .filter((r) => r.status === 'missing' || (r.status === 'partial' && r.note))
      .filter((r) => [r.name, ...r.aliases].some((t) => containsTerm(normLetter, t)))
      .filter((r) => !containsTerm(normalize(notes || ''), r.name))
      .map((r) => ({ requirement: r.name, status: r.status, why: r.status === 'missing'
        ? 'The letter names it, but the CV does not show it.'
        : 'The letter names it, but the CV does not confirm it.' }));
  }
  const words = letter.split(/\s+/).filter(Boolean).length;
  return {
    words,
    numbersNotInCv: numbers,
    skillsNotInCv: claimedMissing,
    ok: numbers.length === 0 && claimedMissing.length === 0
  };
}

/** The format the agent writes, with the rules the original prompt gave the model. */
const SCHEMA = {
  analysis: {
    requirements: [{
      name: "the requirement in the job ad's own wording (ATS software matches literal keywords)",
      category: 'hard_skill | tool | qualification | domain | soft_skill',
      importance: 'required | preferred',
      status: 'match | partial | missing',
      evidence: 'a VERBATIM quote from the CV, at most 12 words; empty if missing',
      aliases: ['other spellings an ATS might see']
    }],
    strengths: ['why the candidate fits, each grounded in the CV'],
    gaps: [{ requirement: 'a missing or partial requirement', advice: 'honest, practical advice' }],
    bulletSuggestions: [{ original: 'a line copied exactly from the CV', improved: 'the rewrite', reason: 'why' }],
    tailoredSummary: '2-3 sentences, CV style, only facts from the CV',
    atsTips: ['at most 5, specific to this CV and this job']
  },
  rules: [
    'List 10 to 25 distinct requirements; split compound items ("React and Vue" is two).',
    'required: stated as required or central to the role; preferred: nice-to-have, plus, bonus.',
    'match: the CV explicitly shows it. partial: something closely related (MySQL for PostgreSQL; 2 years when 3 are asked). missing: nothing relevant.',
    'If you cannot quote the CV word for word, the status is not match.',
    'Never state or imply a skill, employer, number or achievement the CV does not show.',
    'A rewrite may only use numbers already in its original line; use a placeholder like [X%] otherwise.'
  ]
};

module.exports = { checkMatch, checkLetter, SCHEMA };
