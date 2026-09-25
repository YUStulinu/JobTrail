/**
 * text.js — normalization and matching helpers shared by parsing and scoring.
 *
 * Matching must survive the ways the same word gets written differently:
 * diacritics (experiență vs experienta), case, dashes, and technical names
 * with punctuation (C++, C#, Node.js, .NET, CI/CD).
 */

function normalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')      // strip diacritics: ș → s, ă → a
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')     // unicode dashes → hyphen
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `term` appears in the (already normalized) text as a whole term.
 * Boundaries are only enforced on sides where the term starts/ends with a
 * letter or digit, so "C++" and ".NET" still match inside "ASP.NET" etc.,
 * while "Java" does not match inside "JavaScript".
 */
function containsTerm(normText, term) {
  const t = normalize(term);
  if (t.length < 2) return false; // single letters ("R", "C") are too noisy to check literally
  const lead = /^[a-z0-9]/.test(t) ? '(?:^|[^a-z0-9])' : '';
  const tail = /[a-z0-9]$/.test(t) ? '(?:$|[^a-z0-9])' : '';
  return new RegExp(lead + escapeRegExp(t) + tail).test(normText);
}

function tokens(str) {
  return normalize(str).split(/[^a-z0-9+#.]+/).filter((w) => w.length >= 3);
}

/**
 * True when a quoted snippet really comes from the text: either an exact
 * (normalized) substring, or at least 80% of its meaningful words present.
 * The fuzzy path tolerates small differences like line breaks inside a
 * quote without letting invented evidence through.
 */
function snippetAppearsIn(normText, snippet) {
  const n = normalize(snippet);
  if (n.length >= 4 && normText.includes(n)) return true;
  const words = tokens(snippet);
  if (words.length < 2) return false;
  const hits = words.filter((w) => normText.includes(w)).length;
  return hits / words.length >= 0.8;
}

/** Short, stable hash, used to detect when a CV or job ad has changed. */
function hash(str) {
  let h = 5381;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Numbers in `text` that never appear in `source` — a cheap guard against
 * invented figures ("4+ years", "saved 30%") in generated text. Digits that
 * are part of a word, like the 2 in "B2" or "Web3", are ignored.
 */
function numbersNotIn(text, source) {
  const found = normalize(text).match(/(?<![a-z0-9])\d+(?:[.,]\d+)?(?![a-z0-9])/g) || [];
  const src = normalize(source);
  return [...new Set(found)].filter((n) => {
    const pattern = n.replace(/[.,]/g, '[.,]');
    return !new RegExp(`(?<![0-9])${pattern}(?![0-9])`).test(src);
  });
}

module.exports = { normalize, containsTerm, snippetAppearsIn, tokens, hash, numbersNotIn };
