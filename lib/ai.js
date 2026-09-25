/**
 * ai.js — every call to Claude lives here.
 *
 *   extractJobDetails  — reads a pasted job ad and fills in company, role, ...
 *   analyzeMatch       — compares a CV with a job ad, requirement by requirement
 *   writeCoverLetter   — drafts a cover letter grounded only in the CV
 *
 * One rule runs through all three prompts: the model may rephrase and
 * emphasize what is in the CV, but it must never invent experience.
 * An application built on invented claims falls apart in the interview.
 */

const API_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages';
const MAX_CV_CHARS = 24000;
const MAX_JOB_CHARS = 16000;

function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function aiError(message, status = 502, details) {
  const err = new Error(message);
  err.status = status;
  if (details) err.details = details;
  return err;
}

function clip(text, max) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max) + '\n[...truncated]' : s;
}

function languageInstruction(language, fallbackSource) {
  if (language === 'en') return 'Write all free-text fields in English.';
  if (language === 'ro') return 'Write all free-text fields in Romanian, with correct diacritics (ă, â, î, ș, ț).';
  return `Write all free-text fields in the same language as the ${fallbackSource}.`;
}

/** Pulls the JSON object out of a model reply, tolerating stray prose or code fences. */
function parseJson(raw) {
  const cleaned = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callClaude({ system, user, maxTokens }) {
  if (!hasApiKey()) {
    throw aiError('Missing ANTHROPIC_API_KEY. Add it to your .env file (see .env.example) and restart the server.', 500);
  }

  const body = JSON.stringify({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }]
  });

  // One retry on rate limits / overload, which are usually momentary.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body
    });

    if (res.ok) {
      const data = await res.json();
      if (data.stop_reason === 'max_tokens') {
        throw aiError('The AI response was cut off before it finished. Try again, or shorten the job ad.');
      }
      const block = (data.content || []).find((c) => c.type === 'text');
      return block ? block.text : '';
    }

    const details = await res.text();
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    console.error('Anthropic API error:', res.status, details.slice(0, 500));
    if (res.status === 401) throw aiError('Your Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.', 502, details);
    if (res.status === 429) throw aiError('Rate limit reached. Wait a minute and try again.', 429, details);
    throw aiError('The AI service returned an error. Try again in a moment.', 502, details);
  }
  throw aiError('The AI service is busy. Try again in a moment.');
}

/** Calls Claude and parses JSON; if the reply isn't valid JSON, asks once more. */
async function callForJson(opts) {
  let raw = await callClaude(opts);
  try {
    return parseJson(raw);
  } catch {
    raw = await callClaude({
      ...opts,
      user: opts.user + '\n\nIMPORTANT: your previous reply was not valid JSON. Reply with ONLY the JSON object.'
    });
    try {
      return parseJson(raw);
    } catch {
      throw aiError('The AI reply could not be read. Please try again.', 502, raw.slice(0, 1000));
    }
  }
}

/* ================================================================ */

async function extractJobDetails(jobText) {
  const system = `You extract structured details from a job advertisement.
Reply with ONLY a JSON object, no prose, in exactly this shape:
{
  "company": "company name, or empty string if not stated",
  "role": "job title as written in the ad",
  "location": "city/country as written, or empty string",
  "workMode": "remote" | "hybrid" | "onsite" | "",
  "salary": "salary or range exactly as written, or empty string",
  "seniority": "intern" | "junior" | "mid" | "senior" | "lead" | "",
  "language": "ISO 639-1 code of the language the ad is written in, e.g. en, ro"
}
Only use information stated in the ad. Use an empty string when something isn't stated — never guess a company name or salary.`;

  const out = await callForJson({
    system,
    user: `Job advertisement:\n\n${clip(jobText, MAX_JOB_CHARS)}`,
    maxTokens: 600
  });

  const pick = (v, allowed) => (allowed.includes(v) ? v : '');
  return {
    company: String(out.company || '').trim(),
    role: String(out.role || '').trim(),
    location: String(out.location || '').trim(),
    workMode: pick(out.workMode, ['remote', 'hybrid', 'onsite']),
    salary: String(out.salary || '').trim(),
    seniority: pick(out.seniority, ['intern', 'junior', 'mid', 'senior', 'lead']),
    language: String(out.language || '').trim().slice(0, 5)
  };
}

/* ================================================================ */

async function analyzeMatch({ cvText, jobText, role, company, language }) {
  const system = `You are an experienced technical recruiter who also knows how applicant tracking systems (ATS) filter CVs. You compare one candidate's CV against one job advertisement and report precisely what matches and what is missing.

Reply with ONLY a JSON object, no prose, in exactly this shape:
{
  "requirements": [
    {
      "name": "the requirement, using the job ad's own wording",
      "category": "hard_skill" | "tool" | "qualification" | "domain" | "soft_skill",
      "importance": "required" | "preferred",
      "status": "match" | "partial" | "missing",
      "evidence": "short VERBATIM quote from the CV proving it, max 12 words; empty string if missing",
      "aliases": ["other spellings or abbreviations an ATS might see"]
    }
  ],
  "strengths": ["why this candidate fits, each point grounded in something specific from the CV"],
  "gaps": [ { "requirement": "a missing or partial requirement", "advice": "honest, practical advice" } ],
  "bulletSuggestions": [ { "original": "an exact line copied from the CV", "improved": "the rewritten line", "reason": "what changed and why" } ],
  "tailoredSummary": "a 2-3 sentence professional summary for the top of the CV, tailored to this job",
  "atsTips": ["specific, actionable tips about how this CV is written or structured"]
}

How to build "requirements":
- List 10 to 25 distinct requirements: technical skills, tools and technologies, qualifications (degree, certifications, years of experience, spoken languages, driving licence...), domain knowledge, and the soft skills the ad clearly emphasizes.
- Use the ad's exact wording for "name" — ATS software matches on the literal keywords from the posting.
- Split compound items: "React and Vue" becomes two requirements.
- Skip generic filler such as "passionate", "team player" or "fast learner" unless the ad makes it central to the role.
- "required": stated as required, must-have or mandatory, or clearly central to the role. "preferred": nice-to-have, plus, bonus, advantage.
- "match": the CV explicitly shows it. "partial": the CV shows something closely related or transferable (e.g. MySQL when PostgreSQL is asked; 2 years when 3 are asked). "missing": the CV shows nothing relevant.
- "evidence" must be copied word for word from the CV so it can be checked automatically. If you cannot quote it, the status is not "match".

Strict honesty rules — these matter more than anything else:
- Never state or imply the candidate has a skill, tool, qualification, employer, number or achievement that the CV does not show.
- "bulletSuggestions": up to 5. "original" must be copied exactly from the CV. "improved" may reword it to use the job ad's terminology and put the most relevant part first. It may only include numbers that already appear in the original; if a metric would help but isn't there, write a placeholder such as [X%] and say in "reason" that the candidate should fill in a real figure or remove it. Never add a skill that the original line doesn't mention.
- "gaps": cover the most important missing or partial requirements. Say whether related experience could honestly be highlighted, how to address the gap in a cover letter or interview, or what to learn. Never suggest adding something to the CV that the candidate hasn't done.
- "tailoredSummary": CV style (no "I"), only facts present in the CV, using the job's terminology where it truthfully applies.
- "atsTips": at most 5, specific to this CV and this job (e.g. a required keyword appears only in a sentence, not in the skills list). No generic advice.

${languageInstruction(language, 'job advertisement')} Keep requirement "name" values in the job ad's original wording regardless.`;

  const user = `JOB: ${role || 'Unknown role'}${company ? ` at ${company}` : ''}

=== JOB ADVERTISEMENT ===
${clip(jobText, MAX_JOB_CHARS)}

=== CANDIDATE CV ===
${clip(cvText, MAX_CV_CHARS)}`;

  return callForJson({ system, user, maxTokens: 7000 });
}

/* ================================================================ */

const LENGTHS = {
  short: 'about 150-200 words, 3 short paragraphs',
  standard: 'about 250-320 words, 4 paragraphs',
  long: 'about 350-420 words, 4-5 paragraphs'
};

const TONES = {
  professional: 'professional and confident, clear and direct',
  warm: 'warm and personable while staying professional',
  concise: 'crisp and to the point, no pleasantries beyond what is polite',
  enthusiastic: 'energetic and genuinely enthusiastic, without exaggeration'
};

async function writeCoverLetter({ cvText, jobText, role, company, options = {}, analysis }) {
  const length = LENGTHS[options.length] || LENGTHS.standard;
  const tone = TONES[options.tone] || TONES.professional;
  const hiringManager = String(options.hiringManager || '').trim();
  const notes = String(options.notes || '').trim();

  // Hand over the verified matches so the letter leans on real evidence.
  let matchContext = '';
  if (analysis && Array.isArray(analysis.requirements)) {
    const strong = analysis.requirements
      .filter((r) => r.status === 'match' && r.importance === 'required')
      .slice(0, 8)
      .map((r) => `- ${r.name}${r.evidence ? ` (CV: "${r.evidence}")` : ''}`);
    if (strong.length) matchContext = `\n\n=== VERIFIED MATCHES (strongest selling points) ===\n${strong.join('\n')}`;
  }

  const system = `You write cover letters for job applications. The letter must sound like a real person wrote it for this one job — specific, confident and honest.

Reply with ONLY a JSON object, no prose, in exactly this shape:
{ "subject": "a short email subject line for sending this application", "letter": "the full letter; separate paragraphs with a blank line" }

Rules:
- Use only facts from the CV and the candidate's own notes. Never invent employers, projects, numbers, degrees, skills or reasons for wanting the job.
- Motivation for this specific company may only come from the candidate's notes. If there are no notes, focus on the role and the fit, and do not make up admiration for the company.
- Open with something specific to this role or what the candidate brings. Do not open with "I am writing to apply" or similar stock phrases.
- Choose the 2-3 strongest matches between the CV and the ad, and back each one with a concrete example from the CV.
- Mention a gap only if the candidate's notes ask you to; frame it honestly and briefly.
- Avoid clichés: "passionate", "dynamic", "team player", "I believe I would be a great fit", "hit the ground running", "look no further".
- Length: ${length}. Tone: ${tone}.
- Greeting: ${hiringManager ? `address it to ${hiringManager}` : 'use a neutral greeting appropriate to the language (e.g. "Dear Hiring Team," or "Bună ziua,")'}.
- Close with a short, confident call to action, then sign off with the candidate's full name exactly as written in the CV. If no name is in the CV, sign off with [Your name].
- ${languageInstruction(options.language, 'job advertisement')}`;

  const user = `ROLE: ${role || 'the advertised position'}${company ? ` at ${company}` : ''}

=== JOB ADVERTISEMENT ===
${clip(jobText, MAX_JOB_CHARS)}

=== CANDIDATE CV ===
${clip(cvText, MAX_CV_CHARS)}${matchContext}

=== CANDIDATE'S NOTES ===
${notes || '(none)'}`;

  const out = await callForJson({ system, user, maxTokens: 2500 });
  const letter = String(out.letter || '').trim();
  if (!letter) throw aiError('The AI returned an empty letter. Please try again.');
  return { subject: String(out.subject || '').trim(), letter };
}

module.exports = { hasApiKey, extractJobDetails, analyzeMatch, writeCoverLetter, parseJson };
