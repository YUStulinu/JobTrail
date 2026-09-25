/**
 * drawer.js — the side panel for one job: details, match analysis, cover letter.
 */
import {
  $, $$, esc, toast, copyText, downloadText, formatDate, hash, withBusy
} from './util.js';
import { api } from './api.js';
import { state, getJob, upsertJob, removeJob, defaultCv } from './state.js';
import { COLUMNS, moveJob } from './board.js';

let currentId = null;
let dirty = false;
let goToCvs = () => {};

const drawer = () => $('#drawer');

export function initDrawer({ onGoToCvs }) {
  goToCvs = onGoToCvs;
  const d = drawer();

  $('#drawerStatus').innerHTML = COLUMNS.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  $('#drawerStatus').addEventListener('change', async (e) => {
    const status = e.target.value;
    const inColumn = state.jobs.filter((j) => j.status === status && j.id !== currentId);
    const top = inColumn.length ? Math.min(...inColumn.map((j) => j.order ?? 0)) - 1000 : 0;
    await moveJob(currentId, status, top);
    const job = getJob(currentId);
    renderHead(job);
    if (!dirty) {
      renderDetails(job); // the server may have filled in dates
    } else {
      // Keep unsaved edits; only bring in the dates the server set.
      const form = $('#detailsForm');
      for (const name of ['appliedAt', 'followUpDate']) {
        if (!form[name].value && job[name]) form[name].value = job[name];
      }
    }
  });

  $('#drawerClose').addEventListener('click', closeDrawer);
  d.addEventListener('cancel', (e) => { e.preventDefault(); closeDrawer(); });
  d.addEventListener('click', (e) => {
    // A click on the backdrop lands on the dialog element outside its box.
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDrawer();
  });

  $$('.drawer-tabs .tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
}

export function openJob(id, tab = 'details') {
  const job = getJob(id);
  if (!job) return;
  currentId = id;
  dirty = false;
  renderHead(job);
  renderDetails(job);
  renderMatch(job);
  renderLetter(job);
  showTab(tab);
  if (!drawer().open) drawer().showModal();
}

function closeDrawer() {
  if (dirty && !confirm('You have unsaved changes in Details. Close without saving?')) return;
  dirty = false;
  drawer().close();
  currentId = null;
}

function showTab(name) {
  $$('.drawer-tabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
  $$('.drawer-body .tab-panel').forEach((p) => p.classList.toggle('is-active', p.id === `panel-${name}`));
  $('.drawer-body').scrollTop = 0;
}

function renderHead(job) {
  $('#drawerCompany').textContent = job.company || 'Unknown company';
  $('#drawerRole').textContent = job.role || 'Untitled role';
  $('#drawerStatus').value = job.status;
  drawer().dataset.status = job.status;
}

function cvOptions(selectedId) {
  const chosen = selectedId && state.cvs.some((c) => c.id === selectedId) ? selectedId : defaultCv()?.id;
  return state.cvs
    .map((c) => `<option value="${c.id}" ${c.id === chosen ? 'selected' : ''}>${esc(c.label)}${c.isDefault ? ' (default)' : ''}</option>`)
    .join('');
}

function noCvNotice() {
  return `
    <div class="notice">
      <p>Upload your CV first — the analysis and the letter are built from it.</p>
      <button type="button" class="btn btn-primary" data-go-cvs>Upload a CV</button>
    </div>`;
}

function noDescriptionNotice() {
  return `
    <div class="notice">
      <p>Paste the full job ad into <strong>Details</strong> first. Everything here is worked out from the ad's text.</p>
      <button type="button" class="btn btn-quiet" data-go-details>Go to Details</button>
    </div>`;
}

function wireNoticeButtons(panel) {
  panel.querySelector('[data-go-cvs]')?.addEventListener('click', () => { drawer().close(); currentId = null; goToCvs(); });
  panel.querySelector('[data-go-details]')?.addEventListener('click', () => showTab('details'));
}

const hasDescription = (job) => (job.description || '').trim().length >= 80;

/** Flags figures in generated text that can't be traced back to the CV. */
function numbersWarning(numbers, source) {
  if (!numbers || !numbers.length) return '';
  const list = numbers.map((n) => `<strong>${esc(n)}</strong>`).join(', ');
  return `<p class="check-numbers">Check ${numbers.length > 1 ? 'these numbers' : 'this number'}: ${list} — ${numbers.length > 1 ? 'they don\'t' : 'it doesn\'t'} appear in ${source}. Keep ${numbers.length > 1 ? 'them' : 'it'} only if ${numbers.length > 1 ? 'they\'re' : 'it\'s'} accurate.</p>`;
}

/* ================================================================
 * DETAILS
 * ================================================================ */

function renderDetails(job) {
  const panel = $('#panel-details');
  const history = (job.history || [])
    .map((h) => `<li><span>${esc(COLUMNS.find((c) => c.id === h.status)?.label || h.status)}</span><time>${formatDate(h.at)}</time></li>`)
    .join('');

  panel.innerHTML = `
    <form id="detailsForm" class="details-form" autocomplete="off">
      <div class="grid-2">
        <label class="field"><span>Company</span><input name="company" value="${esc(job.company)}" /></label>
        <label class="field"><span>Role</span><input name="role" value="${esc(job.role)}" /></label>
        <label class="field"><span>Location</span><input name="location" value="${esc(job.location)}" /></label>
        <label class="field"><span>Work mode</span>
          <select name="workMode">
            ${[['', 'Not specified'], ['remote', 'Remote'], ['hybrid', 'Hybrid'], ['onsite', 'On-site']]
              .map(([v, l]) => `<option value="${v}" ${job.workMode === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Salary</span><input name="salary" value="${esc(job.salary)}" /></label>
        <label class="field"><span>Contact person</span><input name="contact" value="${esc(job.contact)}" placeholder="Recruiter name or email" /></label>
        <label class="field"><span>Applied on</span><input type="date" name="appliedAt" value="${esc(job.appliedAt)}" /></label>
        <label class="field"><span>Follow up on</span><input type="date" name="followUpDate" value="${esc(job.followUpDate)}" /></label>
      </div>

      <label class="field">
        <span>Link to the ad</span>
        <div class="input-row">
          <input type="url" name="link" value="${esc(job.link)}" placeholder="https://" />
          ${/^https?:\/\//i.test(job.link || '') ? `<a class="btn btn-quiet" href="${esc(job.link)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}
        </div>
      </label>

      <label class="field">
        <span>Notes</span>
        <textarea name="notes" rows="4" placeholder="Interview dates, who you spoke to, questions to ask...">${esc(job.notes)}</textarea>
      </label>

      <label class="field">
        <span>Job ad</span>
        <textarea name="description" rows="12" placeholder="Paste the full job ad. The match analysis and cover letter are built from this text.">${esc(job.description)}</textarea>
      </label>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary" id="detailsSave">Save changes</button>
        <span id="dirtyHint" class="muted" hidden>Unsaved changes</span>
      </div>
    </form>

    ${history ? `<section class="history"><h3>History</h3><ol>${history}</ol></section>` : ''}

    <section class="danger-zone">
      <button type="button" class="btn btn-danger" id="deleteJobBtn">Delete this job</button>
    </section>
  `;

  const form = $('#detailsForm');
  form.addEventListener('input', () => { dirty = true; $('#dirtyHint').hidden = false; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(form).entries());
    await withBusy($('#detailsSave'), 'Saving…', async () => {
      try {
        const { job: saved } = await api.updateJob(currentId, fields);
        upsertJob(saved);
        dirty = false;
        renderHead(saved);
        renderDetails(saved);
        renderMatch(saved);   // the job ad may have changed
        renderLetter(saved);
        toast('Changes saved');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  $('#deleteJobBtn').addEventListener('click', async () => {
    if (!confirm(`Delete "${job.role || 'this job'}" at ${job.company || 'this company'}? This can't be undone.`)) return;
    try {
      await api.deleteJob(currentId);
      removeJob(currentId);
      dirty = false;
      drawer().close();
      currentId = null;
      toast('Job deleted');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ================================================================
 * MATCH ANALYSIS
 * ================================================================ */

const STATUS_LABEL = { match: 'Covered', partial: 'Partly covered', missing: 'Missing' };
const BAND_TEXT = {
  strong: 'Strong match',
  good: 'Good match',
  fair: 'Moderate match',
  weak: 'Weak match'
};

function staleReasons(job) {
  const a = job.analysis;
  const reasons = [];
  if (a.jobHash && a.jobHash !== hash(job.description)) reasons.push('the job ad was edited');
  const cv = state.cvs.find((c) => c.id === a.cvId);
  if (!cv) reasons.push('the CV it used was deleted');
  else if (cv.updatedAt && new Date(cv.updatedAt) > new Date(a.createdAt)) reasons.push('the CV text was changed');
  return reasons;
}

function meter(reqs) {
  const order = { match: 0, partial: 1, missing: 2 };
  return [...reqs]
    .sort((a, b) => order[a.status] - order[b.status])
    .map((r) => `<span class="seg seg-${r.status}" title="${esc(r.name)}: ${STATUS_LABEL[r.status]}"></span>`)
    .join('');
}

function requirementRow(r) {
  return `
    <li class="req req-${r.status}">
      <span class="req-mark" aria-hidden="true"></span>
      <div class="req-body">
        <p class="req-name">${esc(r.name)} <span class="req-imp">${r.importance === 'required' ? 'Required' : 'Nice to have'}</span></p>
        ${r.evidence ? `<p class="req-evidence">“${esc(r.evidence)}”</p>` : ''}
        ${r.note ? `<p class="req-note">${esc(r.note)}</p>` : ''}
      </div>
      <span class="sr-only">${STATUS_LABEL[r.status]}</span>
    </li>`;
}

function renderMatch(job) {
  const panel = $('#panel-match');

  if (!state.cvs.length) { panel.innerHTML = noCvNotice(); wireNoticeButtons(panel); return; }
  if (!hasDescription(job)) { panel.innerHTML = noDescriptionNotice(); wireNoticeButtons(panel); return; }

  const a = job.analysis;
  const lang = a?.language || 'auto';
  const controls = `
    <div class="controls">
      <label class="field"><span>CV</span><select id="matchCv">${cvOptions(a?.cvId || job.cvId)}</select></label>
      <label class="field"><span>Write feedback in</span>
        <select id="matchLang">
          <option value="auto" ${lang === 'auto' ? 'selected' : ''}>Language of the ad</option>
          <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option>
          <option value="ro" ${lang === 'ro' ? 'selected' : ''}>Romanian</option>
        </select>
      </label>
      <button type="button" class="btn btn-primary" id="analyzeBtn" ${state.ai ? '' : 'disabled'}>${a ? 'Analyze again' : 'Analyze match'}</button>
    </div>`;

  if (!a) {
    panel.innerHTML = `${controls}
      <div class="intro-block">
        <p>Compares your CV with this ad, requirement by requirement: what you already cover, what's only partly there, and which keywords are missing. You also get rewrites of your own CV lines and a tailored summary.</p>
        <p class="muted">Takes about 20–40 seconds.</p>
      </div>`;
    wireAnalyze(panel);
    return;
  }

  const req = a.requirements.filter((r) => r.importance === 'required');
  const pref = a.requirements.filter((r) => r.importance === 'preferred');
  const count = (list, s) => list.filter((r) => r.status === s).length;
  const stale = staleReasons(job);
  const cvMeta = state.cvs.find((c) => c.id === a.cvId);
  const groups = ['missing', 'partial', 'match'];

  panel.innerHTML = `
    ${controls}

    ${stale.length ? `<p class="stale">This analysis is out of date because ${stale.join(' and ')}. Run it again for current results.</p>` : ''}

    <section class="score-block score-${a.band}">
      <div class="score-number"><strong>${a.score}</strong><span>%</span></div>
      <div class="score-text">
        <p class="score-band">${BAND_TEXT[a.band]}</p>
        <p>Covers ${count(req, 'match')} of ${req.length} required${count(req, 'partial') ? ` (${count(req, 'partial')} partly)` : ''}${pref.length ? ` and ${count(pref, 'match')} of ${pref.length} nice-to-have` : ''} requirements.</p>
        <div class="meter-row"><span>Required</span><div class="meter">${meter(req)}</div></div>
        ${pref.length ? `<div class="meter-row"><span>Nice to have</span><div class="meter">${meter(pref)}</div></div>` : ''}
      </div>
    </section>
    <p class="fine">Based on ${esc(a.cvLabel || 'your CV')}, ${formatDate(a.createdAt)}. The score estimates keyword coverage; real ATS software and recruiters weigh things in their own way.</p>

    ${a.keywordsToAdd.length ? `
      <section class="block">
        <div class="block-head">
          <h3>Keywords missing from your CV</h3>
          <button type="button" class="btn btn-quiet btn-small" id="copyKeywords">Copy list</button>
        </div>
        <div class="chips">${a.keywordsToAdd.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</div>
        <p class="fine">Add a keyword only where it's true for you — ideally in your skills section and in the experience line where you used it. Required ones are listed first.</p>
      </section>` : ''}

    <section class="block">
      <h3>Requirement by requirement</h3>
      ${groups.map((g) => {
        const items = a.requirements.filter((r) => r.status === g);
        if (!items.length) return '';
        return `<h4 class="req-group req-group-${g}">${STATUS_LABEL[g]} (${items.length})</h4><ul class="req-list">${items.map(requirementRow).join('')}</ul>`;
      }).join('')}
    </section>

    ${a.strengths.length ? `
      <section class="block">
        <h3>What works in your favour</h3>
        <ul class="plain-list">${a.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      </section>` : ''}

    ${a.gaps.length ? `
      <section class="block">
        <h3>Gaps and how to handle them</h3>
        <dl class="gaps">${a.gaps.map((g) => `<dt>${esc(g.requirement)}</dt><dd>${esc(g.advice)}</dd>`).join('')}</dl>
      </section>` : ''}

    ${a.tailoredSummary ? `
      <section class="block">
        <div class="block-head">
          <h3>Profile summary for this job</h3>
          <button type="button" class="btn btn-quiet btn-small" id="copySummary">Copy</button>
        </div>
        <p class="prose-box">${esc(a.tailoredSummary)}</p>
        ${numbersWarning(a.summaryUncheckedNumbers, 'your CV')}
        <p class="fine">For the top of your CV. Written only from what's already in your CV.</p>
      </section>` : ''}

    ${a.bulletSuggestions.length ? `
      <section class="block">
        <h3>Stronger versions of your CV lines</h3>
        <ol class="rewrites">
          ${a.bulletSuggestions.map((b, i) => `
            <li>
              <p class="rw-before">${esc(b.original)}</p>
              <p class="rw-after">${esc(b.improved)}</p>
              ${b.reason ? `<p class="fine">${esc(b.reason)}</p>` : ''}
              <button type="button" class="btn btn-quiet btn-small" data-copy-rewrite="${i}">Copy new version</button>
            </li>`).join('')}
        </ol>
        <p class="fine">Anything in [brackets] is a placeholder — replace it with a real figure or remove it.</p>
      </section>` : ''}

    ${a.atsTips.length ? `
      <section class="block">
        <h3>ATS tips for this CV</h3>
        <ul class="plain-list">${a.atsTips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </section>` : ''}

    ${cvMeta?.health?.warnings?.length ? `
      <section class="block">
        <h3>File checks for ${esc(cvMeta.label)}</h3>
        <ul class="plain-list warn-list">${cvMeta.health.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      </section>` : ''}
  `;

  wireAnalyze(panel);
  $('#copyKeywords')?.addEventListener('click', () => copyText(a.keywordsToAdd.join(', '), 'Keywords copied'));
  $('#copySummary')?.addEventListener('click', () => copyText(a.tailoredSummary, 'Summary copied'));
  $$('[data-copy-rewrite]', panel).forEach((btn) => btn.addEventListener('click', () => {
    copyText(a.bulletSuggestions[Number(btn.dataset.copyRewrite)].improved, 'Line copied');
  }));
}

function wireAnalyze(panel) {
  const btn = panel.querySelector('#analyzeBtn');
  if (!btn) return;
  btn.addEventListener('click', () => withBusy(btn, 'Analyzing… this takes ~30s', async () => {
    try {
      const { job } = await api.analyze(currentId, $('#matchCv').value, $('#matchLang').value);
      upsertJob(job);
      renderMatch(job);
      renderLetter(job);
      toast(`Analysis ready: ${job.analysis.score}% match`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}

/* ================================================================
 * COVER LETTER
 * ================================================================ */

function renderLetter(job) {
  const panel = $('#panel-letter');

  if (!state.cvs.length) { panel.innerHTML = noCvNotice(); wireNoticeButtons(panel); return; }
  if (!hasDescription(job)) { panel.innerHTML = noDescriptionNotice(); wireNoticeButtons(panel); return; }

  const cl = job.coverLetter;
  const o = cl?.options || {};
  const sel = (value, current, fallback) => (value === (current || fallback) ? 'selected' : '');

  panel.innerHTML = `
    <div class="controls controls-letter">
      <label class="field"><span>CV</span><select id="letterCv">${cvOptions(cl?.cvId || job.cvId)}</select></label>
      <label class="field"><span>Tone</span>
        <select id="letterTone">
          <option value="professional" ${sel('professional', o.tone, 'professional')}>Professional</option>
          <option value="warm" ${sel('warm', o.tone, 'professional')}>Warm</option>
          <option value="concise" ${sel('concise', o.tone, 'professional')}>Concise</option>
          <option value="enthusiastic" ${sel('enthusiastic', o.tone, 'professional')}>Enthusiastic</option>
        </select>
      </label>
      <label class="field"><span>Length</span>
        <select id="letterLength">
          <option value="short" ${sel('short', o.length, 'standard')}>Short</option>
          <option value="standard" ${sel('standard', o.length, 'standard')}>Standard</option>
          <option value="long" ${sel('long', o.length, 'standard')}>Long</option>
        </select>
      </label>
      <label class="field"><span>Language</span>
        <select id="letterLang">
          <option value="auto" ${sel('auto', o.language, 'auto')}>Language of the ad</option>
          <option value="en" ${sel('en', o.language, 'auto')}>English</option>
          <option value="ro" ${sel('ro', o.language, 'auto')}>Romanian</option>
        </select>
      </label>
    </div>

    <label class="field">
      <span>Addressed to <em class="opt">optional</em></span>
      <input type="text" id="letterManager" value="${esc(o.hiringManager || job.contact || '')}" placeholder="e.g. Ms. Ionescu — leave empty for a neutral greeting" />
    </label>
    <label class="field">
      <span>Your notes for the letter <em class="opt">optional, but it makes a real difference</em></span>
      <textarea id="letterNotes" rows="3" placeholder="Why this company? Anything to emphasize, or a gap to explain? The letter only uses reasons you give here — it won't invent any.">${esc(o.notes || '')}</textarea>
    </label>

    ${!job.analysis ? '<p class="fine">Tip: run the match analysis first — the letter then leans on your verified strengths for this job.</p>' : ''}

    <button type="button" class="btn btn-primary" id="letterBtn" ${state.ai ? '' : 'disabled'}>${cl ? 'Write a new version' : 'Write cover letter'}</button>

    ${cl ? `
      <section class="letter-result">
        <label class="field"><span>Email subject</span><input type="text" id="letterSubject" value="${esc(cl.subject)}" /></label>
        <label class="field">
          <span>Letter <em class="opt" id="wordCount"></em></span>
          <textarea id="letterText" class="letter-text" rows="18">${esc(cl.letter)}</textarea>
        </label>
        <div id="letterNumbers">${numbersWarning(cl.uncheckedNumbers, 'your CV or your notes')}</div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" id="letterSave">Save edits</button>
          <button type="button" class="btn btn-quiet" id="letterCopy">Copy letter</button>
          <button type="button" class="btn btn-quiet" id="letterDownload">Download .txt</button>
        </div>
        <p class="fine">Read it through before sending — check every claim is accurate and that it sounds like you.</p>
      </section>` : ''}
  `;

  const collectOptions = () => ({
    tone: $('#letterTone').value,
    length: $('#letterLength').value,
    language: $('#letterLang').value,
    hiringManager: $('#letterManager').value.trim(),
    notes: $('#letterNotes').value.trim()
  });

  $('#letterBtn').addEventListener('click', (e) => withBusy(e.currentTarget, 'Writing…', async () => {
    const text = $('#letterText');
    if (text && text.value !== cl.letter && !confirm('This replaces your edited letter. Continue?')) return;
    try {
      const { job: saved } = await api.coverLetter(currentId, $('#letterCv').value, collectOptions());
      upsertJob(saved);
      renderLetter(saved);
      toast('Cover letter ready');
    } catch (err) {
      toast(err.message, 'error');
    }
  }));

  if (!cl) return;

  const textArea = $('#letterText');
  const updateCount = () => {
    const n = textArea.value.trim().split(/\s+/).filter(Boolean).length;
    $('#wordCount').textContent = `${n} words`;
  };
  textArea.addEventListener('input', updateCount);
  updateCount();

  $('#letterSave').addEventListener('click', (e) => withBusy(e.currentTarget, 'Saving…', async () => {
    try {
      const { job: saved } = await api.updateJob(currentId, {
        coverLetter: { subject: $('#letterSubject').value, letter: textArea.value, options: collectOptions(), cvId: cl.cvId }
      });
      upsertJob(saved);
      $('#letterNumbers').innerHTML = numbersWarning(saved.coverLetter.uncheckedNumbers, 'your CV or your notes');
      toast('Letter saved');
    } catch (err) {
      toast(err.message, 'error');
    }
  }));

  $('#letterCopy').addEventListener('click', () => copyText(textArea.value, 'Letter copied'));
  $('#letterDownload').addEventListener('click', () => {
    const name = `Cover letter - ${job.company || 'company'} - ${job.role || 'role'}.txt`;
    const subject = $('#letterSubject').value.trim();
    downloadText(name, (subject ? `Subject: ${subject}\n\n` : '') + textArea.value);
  });
}
