/**
 * parse.js — turns an uploaded CV into plain text and checks how readable
 * it is for an applicant tracking system (ATS).
 *
 * The text extracted here is roughly what an ATS "sees". If extraction
 * returns almost nothing, the CV is very likely a scanned image or uses
 * text-as-graphics — and an ATS would reject it the same way.
 */
const path = require('path');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const { normalize } = require('./text');

async function extractText(buffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  let text;

  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (ext === '.docx') {
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (ext === '.txt' || ext === '.md') {
    text = buffer.toString('utf8');
  } else if (ext === '.doc') {
    throw userError('Old .doc files are not supported. Open it in Word or Google Docs and save it as .docx or PDF.');
  } else {
    throw userError('Unsupported file type. Upload a PDF, DOCX or TXT file.');
  }

  return cleanText(text);
}

function cleanText(raw) {
  return String(raw || '')
    .replace(/\r/g, '')
    .replace(/^-- \d+ of \d+ --$/gm, '')   // page markers added by pdf-parse
    .replace(/\u00a0/g, ' ')                // non-breaking spaces
    .replace(/[ \t]+/g, ' ')
    .replace(/(\w)-\n(\w)/g, '$1$2')        // words hyphenated across lines
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// English and Romanian headings an ATS commonly looks for.
const SECTION_PATTERNS = {
  experience: /\b(work experience|professional experience|experience|employment|work history|experienta profesionala|experienta)\b/,
  education: /\b(education|studies|academic|educatie|studii|formare profesionala)\b/,
  skills: /\b(skills|technical skills|competencies|technologies|competente|abilitati|aptitudini|tehnologii)\b/
};

function checkCvHealth(text) {
  const norm = normalize(text);
  const words = text.split(/\s+/).filter(Boolean).length;

  const hasEmail = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text);
  const hasPhone = /(?:\+?\d[\d\s().-]{7,}\d)/.test(text);
  const hasLinkedIn = /linkedin\.com\//i.test(text);
  const sections = Object.keys(SECTION_PATTERNS).filter((k) => SECTION_PATTERNS[k].test(norm));

  const warnings = [];
  if (words < 150) {
    warnings.push('Very little text could be read from this file. If your CV is a scanned image or uses text inside graphics, ATS software can\'t read it either — export a text-based PDF or DOCX instead.');
  }
  if (words > 1300) {
    warnings.push(`Your CV is about ${words} words, which usually means 3+ pages. Recruiters skim; 1–2 pages is the norm for most roles.`);
  }
  if (!hasEmail) warnings.push('No email address was found. Make sure it is written as plain text, not inside an image or header graphic.');
  if (!hasPhone) warnings.push('No phone number was found.');
  for (const s of ['experience', 'education', 'skills']) {
    if (!sections.includes(s)) {
      const label = { experience: 'Experience', education: 'Education', skills: 'Skills' }[s];
      warnings.push(`No standard "${label}" heading was found. ATS parsers rely on conventional section names to sort your information.`);
    }
  }

  return { words, hasEmail, hasPhone, hasLinkedIn, sections, warnings };
}

function userError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

module.exports = { extractText, cleanText, checkCvHealth };
