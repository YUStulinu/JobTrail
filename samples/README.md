# Samples

A fictional candidate, Alex Morgan (`cv-alex-morgan.txt`, and the same CV as a PDF), and a job ad
(`job-frontend.txt`). `analysis.json` is how an AI agent might compare them, with three mistakes.
`letter.txt` is a cover letter that overstates.

```bash
node bin/jobtrail.js cv samples/cv-alex-morgan.pdf
node bin/jobtrail.js match --cv samples/cv-alex-morgan.pdf --analysis samples/analysis.json --job samples/job-frontend.txt
node bin/jobtrail.js letter --cv samples/cv-alex-morgan.pdf --letter samples/letter.txt --analysis samples/analysis.json
```

What the checks catch:
- **match.** It changes three of the agent's claims, and the score is 61 (fair).
  - "4+ years of professional experience" was claimed with the quote "4 years of experience…". The
    CV says 3 years, so the claim is downgraded.
  - Next.js was claimed with a quote that is not in the CV, so it is downgraded.
  - REST APIs was marked missing, but it is in the skills list, so it is now a match.
  - A suggested rewrite of a line that is not in the CV is dropped.
- **letter.** It flags "5 years" (the CV says 3), and Next.js and GraphQL, which the CV does not
  show.
