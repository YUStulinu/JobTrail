#!/usr/bin/env node
/**
 * jobtrail — JobTrail's checks on the command line, for an AI agent (or anyone). The agent reads
 * the CV and the job ad; the code checks every claim before the candidate sees it. No API key.
 *
 *   jobtrail cv CV_FILE [--text-out FILE]          what an ATS reads from a PDF/DOCX/TXT CV, and its problems
 *   jobtrail schema                                the analysis format to fill in
 *   jobtrail match --cv CV_FILE --analysis FILE [--job JOB_FILE]
 *                                                  claims checked against the CV, score by a fixed formula
 *   jobtrail letter --cv CV_FILE --letter FILE [--notes FILE] [--analysis FILE]
 *                                                  numbers and skills in a cover letter that the CV does not show
 *
 * Every answer is JSON on standard output. FILE may be "-" for standard input.
 */
const fs = require('fs');
const path = require('path');
const { extractText, checkCvHealth } = require('../lib/parse');
const { checkMatch, checkLetter, SCHEMA } = require('../lib/check');

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function emit(v) {
  process.stdout.write(JSON.stringify(v, null, 1) + '\n');
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const v = argv[i + 1];
      if (v === undefined || (v.startsWith('--') && v !== '-')) fail(`${argv[i]} needs a value`);
      out[argv[i].slice(2)] = v;
      i++;
    } else out._.push(argv[i]);
  }
  return out;
}

function readFile(p) {
  try {
    return p === '-' ? fs.readFileSync(0) : fs.readFileSync(p);
  } catch (e) {
    fail(`cannot read ${p}: ${e.code || e.message}`);
  }
}

/** A CV as text: PDF, DOCX, TXT or MD, extracted the way the app does it. */
async function cvText(p) {
  try {
    return await extractText(readFile(p), p === '-' ? 'cv.txt' : p);
  } catch (e) {
    fail(e.message);
  }
}

function readJson(p) {
  try {
    return JSON.parse(readFile(p).toString('utf8').replace(/^﻿/, ''));
  } catch (e) {
    fail(`${p} is not valid JSON: ${e.message} (see: jobtrail schema)`);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  switch (cmd) {
    case 'cv': {
      if (a._.length !== 1) fail('usage: jobtrail cv CV_FILE [--text-out FILE]');
      const text = await cvText(a._[0]);
      if (a['text-out']) fs.writeFileSync(a['text-out'], text, 'utf8');
      emit({ file: path.basename(a._[0]), ...checkCvHealth(text), text });
      break;
    }
    case 'schema':
      emit(SCHEMA);
      break;
    case 'match': {
      if (!a.cv || !a.analysis) fail('usage: jobtrail match --cv CV_FILE --analysis FILE [--job JOB_FILE]');
      const analysis = readJson(a.analysis);
      if (!Array.isArray(analysis.requirements) || !analysis.requirements.length) fail('the analysis has no requirements (see: jobtrail schema)');
      const job = a.job ? readFile(a.job).toString('utf8') : '';
      emit(checkMatch(analysis, await cvText(a.cv), job));
      break;
    }
    case 'letter': {
      if (!a.cv || !a.letter) fail('usage: jobtrail letter --cv CV_FILE --letter FILE [--notes FILE] [--analysis FILE]');
      const letter = readFile(a.letter).toString('utf8');
      const notes = a.notes ? readFile(a.notes).toString('utf8') : '';
      const analysis = a.analysis ? readJson(a.analysis) : null;
      emit(checkLetter(letter, await cvText(a.cv), notes, analysis));
      break;
    }
    default:
      fail('usage: jobtrail cv|schema|match|letter ... (see the comment at the top of bin/jobtrail.js)');
  }
}

main();
