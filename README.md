# JobTrail

A job application tracker for people actually job hunting. Track every application on a Kanban board, see exactly how your CV matches each job ad — keyword by keyword, the way an applicant tracking system (ATS) reads it — and draft a cover letter built only from your real experience.

## What it does

**Board** — five columns: Saved, Applied, Interviewing, Offer, Rejected. Drag cards between columns or reorder them. Moving a card to Applied stamps the date and sets a follow-up reminder a week out; overdue follow-ups show up on the card and in the summary line.

**Add a job in seconds** — paste the job ad and the company, role, location, work mode and salary are filled in for you.

**Match analysis** — compares your CV with the ad, requirement by requirement:
- a match score with a breakdown of required vs. nice-to-have requirements
- the keywords missing from your CV, required ones first
- for every requirement, the exact line from your CV that covers it
- honest advice for each gap
- stronger rewrites of your own CV lines, using the ad's terminology
- a profile summary tailored to the job

**Cover letter** — pick tone, length and language, add your own reasons for wanting the job, and get a letter that leans on your verified strengths. Edit it in place, copy it, or download it.

**CV checks** — upload several CV versions (e.g. frontend and full-stack). Each one is checked for what trips up ATS software: a scanned or image-based file, missing contact details, non-standard section headings. You can see — and fix — the exact text extracted from your file.

## Why you can trust the analysis

AI models sometimes claim things that aren't there. For a tool that shapes your job applications, that's not acceptable, so the AI's output is checked by code before you see it:

- **Every "you have this" claim is verified.** The AI must quote your CV as evidence. If neither the skill nor the quote can be found in your CV text, the requirement is downgraded and flagged — you're never told you have a skill you haven't written down.
- **Misses are corrected too.** If the AI says a keyword is missing but it's literally in your CV, it's marked as covered.
- **The score is computed by a fixed formula**, not written by the AI: required items weigh 3×, nice-to-haves 1×, partial coverage counts half. Same CV + same ad → same number.
- **Invented numbers are flagged.** Any figure in the tailored summary or cover letter that doesn't appear in your CV (or your notes) is highlighted for you to check.
- **Rewrites can only rework lines that exist.** A suggested rewrite whose "original" isn't in your CV is discarded.
- Matching handles Romanian diacritics (experiență = experienta) and technical names (C++, C#, .NET, Node.js, CI/CD), and won't mistake "Java" for "JavaScript".

The score estimates keyword coverage. Real ATS systems and recruiters each weigh things their own way — use it to spot gaps, not as a verdict.

## Setup

1. Install [Node.js](https://nodejs.org/) 18 or newer.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create your config file:
   ```bash
   cp .env.example .env
   ```
   (on Windows cmd: `copy .env.example .env`)
4. Put your Anthropic API key in `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   Get one at [console.anthropic.com](https://console.anthropic.com/) → API Keys. The board works without a key; only the AI features need it.
5. Start it:
   ```bash
   npm start
   ```
6. Open [http://localhost:3005](http://localhost:3005).

## A typical workflow

1. **CVs & backup** → upload your CV. Look at the checks; if the extracted text looks wrong, click *Check extracted text* and fix it.
2. **Add job** (or press `N`) → paste the ad → *Fill in details from the ad* → *Add to board*.
3. The job opens on **Match analysis** → *Analyze match*. Add the missing keywords that are true for you, and use the rewrites and summary to tailor your CV.
4. **Cover letter** → add a line or two about why you want this job → *Write cover letter* → read, edit, copy.
5. After you apply, drag the card to **Applied**. Follow-ups are tracked from there.

If you edit your CV or the job ad later, the analysis is marked out of date so you know to re-run it.

## Your data stays on your computer

- Everything is stored in `data/db.json` next to the app. Nothing is uploaded anywhere except the text sent to the Anthropic API when you run an AI feature.
- The server only listens on `127.0.0.1`, so other devices on your network can't open it.
- `data/` and `.env` are in `.gitignore`, so your CVs and API key never end up on GitHub.
- Use *Download backup* in the CVs tab now and then. *Restore from backup* merges a backup back in.

## Costs

The AI features call the Anthropic API, which is billed per use: auto-fill is a small call, a match analysis or a cover letter sends your CV plus the job ad. Results are saved, so opening a job again costs nothing — you only pay when you click Analyze or Write. Check current pricing in the Anthropic console, and consider setting a monthly spend limit there.

## Project structure

```
jobtrail/
├── server.js            # Express server and REST API
├── lib/
│   ├── ai.js            # the three Claude calls and their prompts
│   ├── scoring.js       # verifies the AI's claims and computes the score
│   ├── text.js          # diacritics-aware matching, evidence and number checks
│   ├── parse.js         # PDF / DOCX / TXT extraction and ATS file checks
│   └── store.js         # JSON storage with atomic, serialized writes
├── public/
│   ├── index.html
│   ├── style.css
│   └── js/
│       ├── main.js      # startup, views, stats, add-job dialog
│       ├── board.js     # Kanban board and drag & drop
│       ├── drawer.js    # job panel: details, analysis, cover letter
│       ├── cvs.js       # CV versions and backup
│       ├── state.js     # client-side state with subscriptions
│       ├── api.js       # REST client
│       └── util.js      # helpers
├── test/
│   └── scoring.test.js  # tests for matching and scoring
├── .env.example
└── package.json
```

No front-end framework or build step: plain ES modules, native HTML5 drag and drop, native `<dialog>` elements.

## Tests

```bash
npm test
```

Covers term matching (punctuation, word boundaries, diacritics), evidence verification, number checks, the AI-correction rules and the scoring formula.

## Limits

- Drag and drop needs a mouse or trackpad. On a phone, open a card and change its column from the menu at the top of the panel.
- Very designed CVs (multiple columns, text in graphics) may extract in a jumbled order. Check the extracted text — if it's jumbled for this app, it's jumbled for an ATS too.
- Old `.doc` files aren't supported; save as `.docx` or PDF.
- Job links are stored, not fetched: job sites block automated reading, so paste the ad's text.

## Pushing to GitHub

```bash
git init
git add .
git commit -m "JobTrail: job application tracker with CV match analysis"
git branch -M main
git remote add origin <your_repo_url>
git push -u origin main
```
