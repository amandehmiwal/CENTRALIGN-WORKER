# Centra Worker — an inspectable autonomous task worker

Centra Worker is a focused prototype for the CentrAlign AI internship problem. It answers natural-language questions from one explicitly approved folder and can autonomously complete a safe business workflow: locate a vendor invoice, extract structured fields, write them into a simulated internal ledger, recover from a transient tool failure, and verify the final state.

## Why this is a useful slice

Rather than claiming to operate arbitrary websites, this prototype demonstrates the core control loop against a constrained environment where the result is genuinely observable:

`goal → plan → tool action → observation → memory → recovery / approval → verification → evidence`

```text
Operator task
    │
    ▼
Worker loop ──► constrained tool adapter ──► simulated inbox / ledger
    │                    │                         │
    └── trace + memory ◄─┴── observations ◄────────┘
    │
    ├── transient failure → bounded, idempotent retry
    ├── policy threshold  → human approval gate
    └── independent read  → completion evidence
```

The worker searches only the selected workspace folder, returns file excerpts as evidence, and uses two typed ledger tools: `create_ledger_entry` and `verify_ledger`. Tool writes are idempotent by invoice ID. The Company X workflow intentionally encounters a transient timeout on its first ledger write; the worker classifies it, retries once, then verifies the independently observed ledger state. High-value CloudFleet entries stop at a policy-driven human approval gate before side effects occur.

## What the prototype demonstrates

- **Natural-language file tasks:** Searches an explicitly allowed folder and grounds each answer in source-file excerpts.
- **Computer-use simulation:** A stateful mock vendor portal and finance system can be searched, opened, submitted to, and independently verified using browser-style tools.
- **Dynamic plans:** Every run displays a step-by-step plan chosen from the task's source and side-effect requirements.
- **Durable audit trail:** Completed and paused runs are stored locally in `data/runs.json`; **Run history** exposes them in the UI.
- **Checkpoints and resume:** A checkpoint is saved after each event. Approval-paused runs can be resumed safely from the saved task using the run API.
- **Policy as code:** `policies.json` declares the approval threshold, retry bound, workspace read-only rule, and external-action restriction.
- **Evaluation suite:** The UI's **Evaluate suite** runs five repeatable acceptance scenarios and reports pass/fail results.

## Run it

Requirements: Node.js 18+ (no npm dependencies).

### 1. Choose the folder the worker may read

The included `workspace/` folder contains safe demo files. To use **your** folder, start the app with its absolute path. The app will read only this path and its subfolders; it does not get permission to scan the rest of your computer.

```bash
CENTRA_WORKSPACE_DIR="/absolute/path/to/your/folder" npm start
```

On Windows PowerShell:

```powershell
$env:CENTRA_WORKSPACE_DIR = "C:\Users\you\Documents\approved-folder"
npm start
```

Supported formats are `.txt`, `.md`, `.csv`, `.json`, `.html`, `.xml`, `.log`, `.pdf`, `.docx`, and `.xlsx`. PDF text extraction uses the local `pdftotext` command if installed; DOCX/XLSX use the local `unzip` command. If these tools are unavailable, the worker safely skips unreadable content rather than claiming it read it. Image OCR is intentionally out of scope for this no-dependency prototype.

### 2. Start and use the app

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000). Ask a direct question such as “What does the operations handbook say about payment approval?” or run the default Company X task for the full recovery-and-verification flow. Reset clears only the simulated ledger; it never edits your files.

```bash
npm test
```

## Deploy for a demo

This app has server-side APIs, so deploy it as a **Node web service**, not GitHub Pages. A `render.yaml` Blueprint is included for Render.

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint**, connect the repository, and select the generated `render.yaml`.
3. Deploy. Render will run `npm ci --ignore-scripts` and `npm start` and use `/api/state` as its health check.

The Render Free web-service tier is fine for an interview demo, but it spins down after 15 minutes with no traffic and has an ephemeral filesystem. Therefore, the deployment is demo-only: run history and checkpoints reset after a restart. The live task workflow and evaluation suite remain functional.

## Architecture

| Layer | Responsibility |
| --- | --- |
| `public/` | Single-page operator console that exposes run traces and evidence |
| `server.js` | Dependency-free HTTP API and static app server |
| `workspace-search.js` | Recursive, read-only search constrained to the approved folder, ranking, excerpts, and invoice field extraction |
| `worker.js` | Task interpretation, action loop, structured memory, policy check, retry, and verification |
| `mock-browser.js` | Stateful simulated portal / finance application and computer-use style browser tools |
| `persistence.js` | Local run history, audit storage, checkpoints, and resume support |
| `policies.json` | Human-readable policy-as-code configuration |
| `workspace/` | Safe demo source files; replace via `CENTRA_WORKSPACE_DIR` for your own approved folder |
| Ledger adapter in `worker.js` | Simulated internal ledger and the only location permitted to cause a side effect |

Each run returns a structured trace, not a stream of hidden model reasoning: goal, plan, tool calls, observations, failures, recovery decisions, approvals, verification, and evidence artifacts. This makes behavior auditable and is more useful operationally than presenting chain-of-thought.

## Design decisions

- **Constrained tools over unbounded automation.** The agent can affect only a small, typed, simulated business environment. That lets us prove execution and verification without credentials or brittle website access.
- **Outcome verification is a separate operation.** A successful write response is not treated as success; the worker re-reads ledger state and compares invoice ID, amount, and due date.
- **Retries are selective and safe.** Only a typed transient failure is retried, once. Idempotency prevents a retry from duplicating a record.
- **Human authority is explicit.** The policy threshold blocks the write and exposes an approval action; the original task does not silently override policy.
- **Narrative task input, deterministic safety boundary.** The lightweight intent recognizer is deliberately transparent for the demo. In production it would be replaced by an LLM planner that emits a validated structured plan, while tool schemas, policy evaluation, idempotency, and verification remain deterministic.

## Demo walkthrough (about 90 seconds)

1. Start the server and show the approved workspace's file count and zero ledger entries.
2. Ask the handbook question and point out the file excerpt returned as evidence.
3. Run the default task. Point out the generated plan, workspace search, extraction, remembered invoice, timeout, safe retry, receipt, and verification event.
4. Show that the ledger now has one entry and that the evidence receipt matches the source file.
5. Run the **Browser task** example; its trace shows browser search, opening the portal record, form submission, and verification.
6. Reset, run the CloudFleet example, and show it halts for approval before changing the ledger.
7. Use the **Approve & continue** button to complete the write and verify it.
8. Click **Evaluate suite** to show five repeatable acceptance scenarios passing, then **Run history** to show persisted audit records.

## Assumptions and limitations

- The search is lexical and evidence-first; it does not yet use an LLM. This keeps the demo deterministic but means it cannot synthesize nuanced answers across arbitrary documents.
- PDFs, DOCX, XLSX, images, OCR, authentication, and a production database are not yet supported. No external systems are accessed.
- The approval action re-runs the task with explicit approval. A production system would persist a signed plan and approval token with a scoped expiry.
- The UI runs a request synchronously for clarity. A production system would put runs on a durable queue, stream events, persist a checkpoint after each tool call, and resume safely.

## If I had more time

I would add LLM-backed plan generation constrained by JSON Schema, a Playwright browser adapter with screenshots as evidence, durable run/event storage, per-tool permissions and secret isolation, policy-as-code, an evaluation suite of adversarial workflows, and a replay debugger. The worker's key invariant would remain: **do not report completion until independently verified.**

## Pre-built components and services

This submission intentionally uses only Node.js standard library APIs—no models, external APIs, frameworks, credentials, or external services. The narrow deterministic environment makes the autonomous behavior, error handling, and verification reproducible in an interview.
