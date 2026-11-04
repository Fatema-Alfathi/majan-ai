# Siraj — autonomous tender agent (Majan AI)

Siraj works for a small Omani construction contractor. Every time the tender list syncs (every 6 hours), it:

1. **Reads the company profile** — Tender Board grade, work classifications, governorates.
2. **Shortlists open tenders** it hasn't assessed before.
3. **Opens each promising tender's page** to check scope, grade and dates.
4. **Decides** — a 0–100 fit score and one of pursue / watch / skip, with reasons and risks.
5. **Acts** — drafts an Arabic WhatsApp alert for the owner covering the tenders worth bidding on, and remembers what it assessed so the next run only looks at new tenders.

The owner always sends the alert; Siraj never sends messages on its own.

## How it runs

- **Claude mode** (when `ANTHROPIC_API_KEY` is set): Claude drives the loop with tool use and chooses which tools to call and in what order. Code: `agent.mjs`.
- **Demo mode** (no key): fixed rules stand in for the model and call the same tools, so the prototype works offline from a key.

## Try it

```bash
npm install
npm start          # site on http://127.0.0.1:4173, agent page at /agent.html
npm run agent      # one agent run from the command line (add -- --fresh to forget past runs)
```

Outputs: `docs/agent-run.json` (the latest run, shown on the agent page) and `data/agent-memory.json` (what Siraj already assessed).
