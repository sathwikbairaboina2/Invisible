# Corpus

Markdown files here are chunked, embedded, and searched at question time to
ground answers in your own material.

**Nothing in this directory is committed** except this README. It holds a
résumé and prepared interview answers; that does not belong in a git history.

## What to put here

One file per topic works best:

- `resume.md` — roles, dates, responsibilities, numbers
- `projects/<name>.md` — what it did, your part, the hard bit, the outcome
- `stories.md` — prepared STAR answers, one per `##` section
- `company-<name>.md` — what they build, why you want in, questions to ask

## How to write it

Chunks are split on markdown headings, so **write one idea per `##` section**.
A section that is one coherent STAR story retrieves cleanly; a section covering
four jobs retrieves as mush.

Sections longer than ~1200 characters are split again on paragraph boundaries,
with the heading repeated so the fragment keeps its context. Shorter, focused
sections beat long ones.

Numbers and proper nouns are what make an answer specific. "Cut p99 from 800 ms
to 90 ms by batching the writes" retrieves and reads far better than "improved
performance significantly".

## Re-ingesting

```bash
npm run ingest
```

Rebuilds the collection from scratch. Safe to re-run after any edit; deleted
files disappear from the index because the collection is recreated rather than
merged.
