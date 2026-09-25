/**
 * scoring.js — turns the AI's requirement list into a trustworthy result.
 *
 * The AI reads the job ad and says, for each requirement, whether the CV
 * covers it and quotes the evidence. We don't take that on faith:
 *
 *   1. If the AI says "missing" but the term is literally in the CV, it
 *      overlooked it — we mark it as a match.
 *   2. If the AI says "match" but neither the term nor the quoted evidence
 *      can be found in the CV, the claim is unverified — we downgrade it to
 *      "partial" and flag it, rather than tell you you have a skill you
 *      may not have written down.
 *   3. The score itself is computed here, by a fixed formula, so the same
 *      inputs always produce the same number.
 */
const { normalize, containsTerm, snippetAppearsIn, numbersNotIn } = require('./text');

const WEIGHTS = { required: 3, preferred: 1 };
const CREDIT = { match: 1, partial: 0.5, missing: 0 };
const CATEGORIES = ['hard_skill', 'tool', 'qualification', 'domain', 'soft_skill'];

function cleanRequirement(r) {
  const status = ['match', 'partial', 'missing'].includes(r?.status) ? r.status : 'missing';
  return {
    name: String(r?.name || '').trim(),
    category: CATEGORIES.includes(r?.category) ? r.category : 'hard_skill',
    importance: r?.importance === 'preferred' ? 'preferred' : 'required',
    status,
    evidence: status === 'missing' ? '' : String(r?.evidence || '').trim(),
    aliases: Array.isArray(r?.aliases) ? r.aliases.map(String).filter(Boolean).slice(0, 6) : [],
    note: ''
  };
}

function verifyRequirements(rawRequirements, cvText) {
  const normCv = normalize(cvText);
  const seen = new Set();
  const out = [];

  for (const raw of rawRequirements || []) {
    const req = cleanRequirement(raw);
    if (!req.name) continue;

    const key = normalize(req.name);
    if (seen.has(key)) continue; // drop duplicates the model sometimes emits
    seen.add(key);

    const literalTerm = [req.name, ...req.aliases].find((t) => containsTerm(normCv, t));
    const evidenceOk = req.evidence ? snippetAppearsIn(normCv, req.evidence) : false;

    if (req.status === 'missing' && literalTerm) {
      req.status = 'match';
      req.evidence = literalTerm;
      req.note = 'Found in your CV (the AI missed it).';
    } else if (req.status === 'match' && !literalTerm && !evidenceOk) {
      req.status = 'partial';
      req.note = 'Could not confirm this in your CV text — check that it is actually written there.';
    } else if (req.status === 'partial' && !literalTerm && !evidenceOk) {
      req.note = 'Related experience claimed, but the quoted evidence was not found in your CV.';
    }

    if (req.evidence && !evidenceOk && req.evidence !== literalTerm) {
      req.evidence = literalTerm || ''; // never display a quote that isn't really in the CV
    }

    out.push(req);
  }

  return out;
}

function computeScore(requirements) {
  let earned = 0;
  let possible = 0;
  const byImportance = {
    required: { total: 0, match: 0, partial: 0, missing: 0 },
    preferred: { total: 0, match: 0, partial: 0, missing: 0 }
  };

  for (const r of requirements) {
    const w = WEIGHTS[r.importance];
    possible += w;
    earned += w * CREDIT[r.status];
    byImportance[r.importance].total += 1;
    byImportance[r.importance][r.status] += 1;
  }

  const score = possible ? Math.round((earned / possible) * 100) : 0;
  let band;
  if (score >= 80) band = 'strong';
  else if (score >= 65) band = 'good';
  else if (score >= 45) band = 'fair';
  else band = 'weak';

  return { score, band, byImportance };
}

/** Keeps only rewrite suggestions whose "original" line really exists in the CV. */
function verifyBulletSuggestions(suggestions, cvText) {
  const normCv = normalize(cvText);
  return (suggestions || [])
    .filter((s) => s && s.original && s.improved)
    .filter((s) => snippetAppearsIn(normCv, s.original))
    .map((s) => ({
      original: String(s.original).trim(),
      improved: String(s.improved).trim(),
      reason: String(s.reason || '').trim()
    }))
    .slice(0, 6);
}

function buildResult(ai, cvText) {
  const requirements = verifyRequirements(ai.requirements, cvText);
  const { score, band, byImportance } = computeScore(requirements);

  const missing = requirements.filter((r) => r.status === 'missing');
  const keywordsToAdd = [
    ...missing.filter((r) => r.importance === 'required'),
    ...missing.filter((r) => r.importance === 'preferred')
  ].map((r) => r.name);

  return {
    score,
    band,
    byImportance,
    requirements,
    keywordsToAdd,
    strengths: (ai.strengths || []).map(String).slice(0, 6),
    gaps: (ai.gaps || [])
      .filter((g) => g && g.requirement)
      .map((g) => ({ requirement: String(g.requirement), advice: String(g.advice || '') }))
      .slice(0, 8),
    bulletSuggestions: verifyBulletSuggestions(ai.bulletSuggestions, cvText),
    tailoredSummary: String(ai.tailoredSummary || '').trim(),
    summaryUncheckedNumbers: numbersNotIn(ai.tailoredSummary || '', cvText),
    atsTips: (ai.atsTips || []).map(String).slice(0, 5)
  };
}

module.exports = { verifyRequirements, computeScore, verifyBulletSuggestions, buildResult };
