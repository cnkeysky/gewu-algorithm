# GEWU Authoring Workbench

This Vite + TypeScript client is the local authoring surface for GEWU template
drafts. It currently implements the draft profile editor and client-side
navigation for new drafts, saved drafts, and review history.

Run it from this directory with:

```sh
npm install
npm run dev
```

The current submit action prepares and validates the profile in the browser.
The local authoring API will connect generation, deterministic validation, and
role review in the next slice. It must never receive provider credentials from
the browser.
