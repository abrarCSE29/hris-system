# Spec: AI chat draft for service requests

Status: **approved (v8).** Last change: the model is now `qwen/qwen3.8-27b` on Groq instead of Gemini. Before that (v7): the chat shows the person's earlier requests made through it, as chat bubbles; requests now record their channel (FORM or CHAT). Source: `docs/intent/ai-request-router.md` (confirmed in an interview).
Relationship to `docs/architecture-v2.md`: this builds a **narrow slice of §7.2** (the chat assistant) with a Groq-hosted model in
place of the generic LLM, and deliberately leaves out the rest of v2. Where the two differ, this spec wins for this
build (see [What differs from v2](#what-differs-from-v2)).

## Objective

An employee types **one plain message**, for example *"My laptop is firing up, need technical help"*. A Groq-hosted Qwen model
(called through LangChain with structured output) returns the fields of the service-request form: **title, description,
category, priority and department**. The employee reviews the draft, **edits any field directly**, and presses Submit,
which creates the request through the normal endpoint. The AI never submits anything.

**Users:** every signed-in person (Employee, Manager, HR Admin), from a floating chat head on every signed-in page.

**Why:** filling the form by hand is slow and people often pick the wrong category or priority. The AI does the first
pass; a person confirms it.

### Worked example

| | |
|---|---|
| Message | `My laptop is firing up, need technical help` |
| Draft title | `Laptop overheating or catching fire, needs urgent technical help` (≤ 120 characters) |
| Draft description | A clear write-up that keeps only the facts the employee gave and invents nothing |
| Category | IT Equipment |
| Priority | Urgent (possible safety risk) |
| Department | IT Operations (the category's handling department) |

### User stories

1. As an employee I type what is wrong and get a ready-to-check request card, so I don't fill the form myself.
2. As an employee I can change any field on the card, so a wrong guess costs me one click.
3. As an employee I can ignore the assistant and use the normal form; it still works when the AI is down.
4. As a person triaging, I receive requests with sensible categories and clear descriptions.

## Assumptions (correct me before approving)

1. Python **3.14** for the AI service (your choice), managed with **uv**. Checked: `langchain-groq` 1.1.3,
   `langchain-core`, FastAPI and Pydantic 2 install and import on 3.14, and a `with_structured_output(..., method="function_calling")`
   chain builds for `qwen/qwen3.8-27b`. The model SDKs may print harmless `SyntaxWarning`s on import, which the service silences
   in its own startup. The Python version is pinned in `.python-version`.
2. The AI service is **local-only for now** (`localhost:8000`). Deploying it (e.g. Render) is a later task.
3. To keep the AI service simple and the database closed to it, **the backend sends the allowed categories and
   departments in each call**. The AI service has **no database access** and none of the `ai_*` views or roles from v2 §3.4.
4. The message goes to **Groq's API**, so it leaves the company's systems (you confirmed this was fine for Google; you then chose Groq as the provider). Only the
   message text, the requester's country and department name are sent **to Groq**; never a name, email or id. The
   caller's identity is kept only in our own database (assumption 8), never sent to Groq or to the AI service.
5. **One message in, one draft out.** No conversation history, no follow-up turns, no clarifying questions.
6. A request records **how it was raised**: a new `channel` column on `service_requests` (`FORM` by default, `CHAT` when it was
   submitted from the assistant). This is what lets the chat show the person's earlier requests (see
   [Earlier requests in the chat](#earlier-requests-in-the-chat)); you chose this over a browser-only or "all my requests" list.
   There is still no draft token or transcript column. The separate developer record of chat use is its own table (assumption 8).
7. The Groq API key is added by the user in `ai-service/.env`. I will not read, print or commit it.
8. **Chat record (your requirement): every chat draft is recorded, and the web app shows the records.**
   - **The AI service stays stateless.** It writes no files and has no database. A file on a hosted AI service (Render and
     similar) lives on a disk that is wiped on every deploy or restart and is separate on each instance, so the record
     would be lost or scattered. The **backend**, which already owns the database and knows who is signed in, writes the
     record. The AI service only writes **structured log lines to stdout/stderr** (one JSON object per event, with the request
     id, outcome, latency and, on failure, the traceback; no names, no message text), which the terminal shows locally and
     the host's log viewer keeps when hosted. See [Debugging and logs](#debugging-and-logs).
   - *Who* = the signed-in user (a foreign key to `users`, so name, role, department and country come from the user record).
   - *From where* = the page the chat head was opened on, the client IP as the backend saw it, and the browser's user agent.
   - *What is kept* = when, who, from where, outcome (`OK`, `INVALID_OUTPUT`, `TIMEOUT`, `UNAVAILABLE`), model, latency, the
     category, priority and department the AI chose, its confidence, and the message **length**. **Never the message text.**
   - *Who can see it* = **developers only, by querying the database** (SQL, Supabase's table viewer or a local client). It is
     **not part of the product**: no HR Admin page, no API endpoint, no sidebar item. Records are kept indefinitely in this build (no
     deletion or retention job).
   - *AI issues are stored in the database* (your requirement, for maintainability and observability): every failed or
     degraded AI call is a `chat_drafts` row with a machine-readable `error_code`, a redacted `error_detail` (the error type
     and a trimmed traceback from the AI service, or the backend's own reason) and the request id. Stdout logs are the live
     view; **the database is the durable record**, so an issue can still be investigated after the host's logs have expired.
   - *This needs one new table* (`chat_drafts`) and a migration, which is a schema change; you asked for it, so it is in scope.
## Tech stack

| Part | Technology |
|---|---|
| AI service (`ai-service/`) | Python 3.14, FastAPI, Pydantic v2, `langchain-core`, `langchain-groq` (structured output via `with_structured_output(..., method="function_calling")`), uvicorn, pytest, uv |
| Model | **`qwen/qwen3.8-27b`** on Groq, set by `GROQ_MODEL` so it can change without code |
| Backend (`backend/`) | Next.js 16 route handlers, zod, Prisma, existing `withAuth`; a small `ai-client` using `fetch` with a timeout |
| Frontend (`frontend/`) | Chat head and draft card, built from existing shadcn components (Sheet, Card, Field, Input, Textarea, Select via `SelectField`, Badge, Button); TanStack Query; Sonner toasts |

## Commands

```bash
# AI service (new, from ai-service/)
uv sync                                              # install pinned dependencies
uv run uvicorn app.main:app --reload --port 8000     # run locally
uv run pytest                                        # tests (the model is faked; no key needed)
uv run python -m eval.run                            # optional quality check, calls the real model, needs the key

# Existing apps (unchanged)
npm run db:up                    # backend/: start Postgres
npm run dev                      # backend/ (port 4000) and frontend/ (port 3000)
npm test                         # backend/ (Vitest, needs Docker DB) and frontend/ (Vitest + jsdom)
npx tsc --noEmit                 # type-check either app
```

## Project structure

```
ai-service/
  app/
    main.py          FastAPI app, /health, /v1/draft, token check, docs off in production
    config.py        reads env: GROQ_API_KEY, GROQ_MODEL, AI_SERVICE_TOKEN, LLM_TIMEOUT_SECONDS
    schemas.py       Pydantic models: DraftRequest, Draft (the structured output), DraftResponse
    drafter.py       builds the prompt, calls the model through LangChain, validates and retries once
    prompts.py       the system prompt (category and priority guide, rules)
    security.py      constant-time X-Service-Token check
    logging.py       JSON log lines, request id on every line, traceback redaction
  eval/              ~15 labelled messages and run.py (by hand)
  tests/             pytest, with a fake chat model
  pyproject.toml, uv.lock, .python-version (3.14), .env.example, .gitignore (ignores .env)
backend/
  app/api/v1/requests/chat-draft/route.ts   POST /requests/chat-draft
  src/lib/ai-client.ts                      calls the AI service (token, timeout, error mapping)
  src/services/intake.ts                    builds the call, validates the AI's answer, maps codes to ids, writes the record
  src/services/requests.ts                  createRequest accepts optional channel and handlingDepartmentId; list filters mine and channel
  prisma/schema.prisma + migration          new table chat_drafts (below)
  tests/chat-draft.test.ts
frontend/
  components/chat/chat-head.tsx             floating button + sheet
  components/chat/request-card.tsx          the editable draft card
  components/chat/bubble.tsx                chat bubbles (their side and the assistant's)
  components/chat/past-requests.tsx         the earlier requests as bubble pairs
  lib/hooks/chat.ts                         useChatDraft mutation, useChatRequests query
  app/(app)/layout.tsx                      mounts the chat head
  tests/chat-*.test.tsx
```

## API contracts

### AI service (private, called only by the backend)

`POST /v1/draft`, headers `X-Service-Token: <shared secret>` and `X-Request-Id: <uuid made by the backend>`:

```jsonc
// request
{
  "message": "My laptop is firing up, need technical help",       // 1..1000 chars
  "requesterCountry": "MALAYSIA",
  "requesterDepartment": "Engineering",
  "categories": [                                                  // sent by the backend; the AI may only choose from these
    { "code": "IT_EQUIPMENT", "name": "IT Equipment", "description": "...", "department": "ITOPS" }
  ],
  "departments": [{ "code": "ITOPS", "name": "IT Operations" }]
}
// response 200
{
  "title": "…",                    // 1..120 chars
  "description": "…",              // 1..5000 chars
  "category": "IT_EQUIPMENT",      // one of the codes sent
  "priority": "URGENT",            // LOW | MEDIUM | HIGH | URGENT
  "department": "ITOPS",           // one of the codes sent; the category's department unless the message clearly asks elsewhere
  "confidence": 0.93,              // 0..1
  "lowConfidence": false,          // true when confidence < 0.6 (threshold from config)
  "reasoning": "…",                // ≤ 300 chars, shown to the employee
  "model": "qwen/qwen3.8-27b",
  "latencyMs": 1180,
  "attempts": 1                    // 2 when the first answer was invalid and the retry was used
}
```

Errors: `401` bad or missing token, `422` bad body, `429` `RATE_LIMITED` (Groq's quota), `502` `MODEL_ERROR`, `MODEL_AUTH` (the model API
rejected our key), `MODEL_NOT_CONFIGURED` (no key set) or `INVALID_OUTPUT` (the model's answer was invalid twice), `504` `TIMEOUT`. Every error body is `{ "error": { "code": "…", "message": "…", "type": "…", "detail": "…" }, "requestId": "<the id sent>" }`,
so the backend can store the id and the reason. `message` is a short cause; `type` is the exception class; `detail` is the
**redacted** traceback trimmed to 4,000 characters (frames and causes, **no input text**). Examples of `message`: `model returned
an unknown category code`, `rate limit reached`. A successful response also reports `attempts` (1 or 2). `GET /health` is public and returns `{ "status": "ok", "model": "…" }`;
it does not call the model. Interactive docs are disabled in production.

### Backend

`POST /api/v1/requests/chat-draft` (any signed-in user): body `{ "message": string, "page": string }` (message trimmed,
1–1,000 characters; `page` is the path the chat was opened on, up to 200 characters, starting with `/`; `.strict()`).
Loads the categories and departments, calls the AI service with the requester's country and department name, **validates** the answer (category and department codes exist, priority is an enum value, lengths fit the form), and
returns:

```jsonc
{ "title": "…", "description": "…", "categoryId": "<uuid>", "priority": "URGENT", "departmentId": "<uuid>",
  "confidence": 0.93, "lowConfidence": false, "reasoning": "…" }
```

No request is created. The backend makes a **request id** (a uuid) for the call, sends it to the AI service as `X-Request-Id`, and **whatever the outcome writes one `chat_drafts` row** (below) that stores the id. The row is written
before responding, and a failure to write it is logged on the server and never fails or delays the draft. Errors: `401` not signed in, `422` bad message, `503` `{ error: { code: "AI_UNAVAILABLE", … } }` when the
AI service is down, times out, or returns something that fails validation.

`POST /api/v1/requests` gains two **optional** fields. `channel` (`FORM` or `CHAT`, default `FORM`) says how it was raised; the chat head sends `CHAT`. `handlingDepartmentId` (uuid): When present it must be an existing
department and is used as the request's handling department; when absent the category's department is used, as today. This
is what lets the employee send a draft to a different department than the category's. (`channel` is a label for the person's own history; it
changes no permission and no routing.) It affects the request's visibility
(the department's Manager sees it) and nothing else.

## Earlier requests in the chat

The panel is a chat thread. Above the current step it shows the person's **earlier requests made through the assistant**, oldest
first, newest at the bottom, scrollable, each as a pair of bubbles:

- **Their bubble (right, black):** the request's title, as what they asked for.
- **The assistant's bubble (left, grey):** the reference (a link to the request), the department it was sent to, the **live**
  status and priority badges, and when it was raised.

Behaviour:

- Source: `GET /api/v1/requests?mine=true&channel=CHAT&pageSize=20`. `mine=true` limits the list to requests the signed-in person
  raised (a Manager or HR Admin otherwise sees more); `channel=CHAT` limits it to those raised through the assistant. Newest 20.
- The list loads when the panel opens and again each time it is opened, so statuses are current. While loading it shows a
  placeholder; if it fails it says "Couldn't load your earlier requests" and the rest of the chat still works; if there are none the
  thread starts with the greeting only.
- A request just submitted from the chat appears in the thread straight away (the list is refreshed after Submit).
- The greeting is the first assistant bubble. The current step (message box, draft card, confirmation) sits at the end of the
  thread, with the message box fixed at the bottom while composing. The thread scrolls to the newest item when it opens and when it changes.
- Only requests raised through the chat appear; requests made with the form are not part of this thread.
- This stores nothing new for the thread: it is built from the requests themselves. The message text is still never stored.

## The draft card (frontend)

- **Chat head:** a round button, bottom-right, on every page inside the signed-in layout (not the login page). It opens a
  sheet (full height on phones). Closing the sheet keeps the current draft in memory until the tab is closed; nothing is
  stored on the server.
- **Message box:** a textarea (≤ 1,000 characters, counter), a Send button disabled while empty or waiting. After 3 seconds
  of waiting it says "Waking up the assistant…".
- **Card fields, all directly editable:** Title (input, ≤ 200), Description (textarea, ≤ 5,000), Category (select),
  Priority (select), Department (select of all departments). Changing the category also sets the department to that
  category's department; the employee may then change the department by hand.
- Fields the AI filled show an **"AI suggested"** badge until the employee edits them. When `lowConfidence` is true the card
  says "I'm not sure about this, please check it." The AI's one-line reasoning is shown under the card.
- **Submit request** calls the normal create-request mutation; on success the usual toast appears ("Request SR-… submitted")
  and the sheet shows a link to the request. **Start over** clears the card.
- If the AI is unavailable, an error toast appears and the sheet points to the normal form at `/requests/new`.
- No feature of the existing form is removed; the chat head is an addition.

## Prompt and safety rules (AI service)

- **System prompt** (in `prompts.py`) contains: the category definitions as received, the priority guide from v2 §7.4
  (*Urgent*: someone cannot work at all, or there is a security or safety risk; *High*: significant impact or a deadline
  within days; *Medium*: default; *Low*: nice-to-have, no deadline), and the rules: write in English even if the message is
  not; keep every fact the employee gave (device, place, dates, error text); invent nothing; title ≤ 120 characters; use
  only the codes provided.
- The employee's message is passed as **data in a separate message**, never concatenated into the instructions, and the
  prompt says to ignore any instruction inside it. Output is limited to fixed values, so injection can at worst produce a
  poor draft that the employee sees and can edit.
- Temperature 0. Structured output with a Pydantic model; if validation fails (an unknown code, too long), retry **once**,
  then return `502`.
- A message that is not a request ("tell me a joke") still returns a draft, with category Other and `lowConfidence: true`;
  there is no separate out-of-scope reply in this build.
- **Never log the message text** or the API key. The chat log (below) holds who, from where, outcome, model and latency.

## Chat record (database, written by the backend)

One row per call to `chat-draft`, including failed ones. The AI service is not involved in storing it.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `user_id` | uuid, FK → `users` | **Who** asked. Taken from the signed-in session, never from the request body. |
| `page` | text | **From where**: the path the chat head was opened on, for example `/requests`. |
| `ip` | text, nullable | Client IP as the backend saw it (`X-Forwarded-For` when present). |
| `user_agent` | text, nullable | The browser, up to 300 characters. |
| `request_id` | uuid, unique | The id sent to the AI service. Search the AI service's logs for it to find the exact trace. |
| `outcome` | enum `OK`, `INVALID_OUTPUT`, `TIMEOUT`, `UNAVAILABLE` | |
| `error_code` | enum, nullable | Machine-readable cause, for counting and alerting later: `AI_UNREACHABLE`, `AI_TIMEOUT`, `AI_AUTH` (the service rejected our token), `AI_RATE_LIMITED`, `AI_MODEL_ERROR`, `AI_INVALID_OUTPUT` (the model's answer failed the AI service's checks twice), `AI_REJECTED_BY_BACKEND` (the answer reached us but failed the backend's checks, for example an unknown department code), `AI_BAD_RESPONSE` (not the agreed shape). Null when `OK`. |
| `error` | text, nullable | The same cause in a few words for people: `connection refused`, `timed out after 20s`, `AI service returned 401`, `returned 429 (rate limited)`, `invalid output after retry`. No personal data, no message text. |
| `error_detail` | text, nullable, ≤ 4,000 chars | The exception type and the **redacted** traceback from the AI service's error response, or the backend's own detail (for example `category code "LAPTOP" is not allowed`). Never message text. |
| `attempts` | int, nullable | How many tries the AI service needed (2 means the model's first answer was invalid and the retry was used). A rising number of 2s is an early sign the prompt or model is drifting. |
| `model` | text, nullable | As reported by the AI service. |
| `latency_ms` | int, nullable | Round trip to the AI service. |
| `category_id`, `department_id` | uuid, FK, nullable | What the AI chose (null on failure). |
| `priority` | enum, nullable | |
| `confidence` | decimal(3,2), nullable | |
| `low_confidence` | boolean | |
| `message_chars` | int | The length of the message. **The text is never stored.** |
| `created_at` | timestamp | |

Indexes: `(created_at DESC)` for the list, `(user_id, created_at DESC)` for one person, unique `(request_id)`. Row-level security is enabled with no
policies, like the other tables. The migration is hand-reviewed like the others.

**No product screen and no API for this record.** It is read by developers directly in the database. There is no endpoint to list,
change or delete rows, and nothing in the frontend reads it. Example queries for the runbook (written in T28):

```sql
-- failures in the last 24 hours, newest first
SELECT created_at, request_id, error_code, error, user_id, page
FROM chat_drafts WHERE outcome <> 'OK' AND created_at > now() - interval '24 hours' ORDER BY created_at DESC;

-- counts by cause
SELECT error_code, count(*) FROM chat_drafts WHERE outcome <> 'OK' GROUP BY error_code ORDER BY count(*) DESC;

-- one failure in full (copy the request id from the user's report or the AI service's logs)
SELECT * FROM chat_drafts WHERE request_id = '…';

-- how often the model needed its retry
SELECT date_trunc('day', created_at) AS day, count(*) FILTER (WHERE attempts = 2) AS retried, count(*) AS total
FROM chat_drafts GROUP BY 1 ORDER BY 1 DESC;
```

The AI service's `/health` endpoint (no model call) is how a developer checks it is up. The records hold personal data (names via
the user, IPs), so they are protected by the same database access as everything else; row-level security is on with no
policies. Keeping them "for the future" means this build never deletes them; a retention rule can be added later (see Open Questions).

## Debugging and logs

The AI service stays stateless, so its traces go to **stdout/stderr**: the terminal when run locally, the host's log viewer
when hosted. Nothing is written to disk.

- **One JSON object per line**, with `time`, `level`, `requestId`, `event` (`draft.start`, `draft.ok`, `draft.invalid_output`,
  `draft.timeout`, `draft.error`), `model`, `latencyMs` and, on failure, `errorType`, `errorMessage` (redacted) and `traceback`.
- **The request id ties it together.** The backend sends `X-Request-Id`; every log line and every error response carries it;
  the backend stores it on the `chat_drafts` row. To debug a failed row, take its request id from the database and search
  the AI service's logs for it.
- **Redaction.** Error output from LangChain, the Groq SDK and Pydantic can contain the text that was rejected, which may be the
  employee's message or the model's draft. The logger therefore keeps the exception **type, the stack frames and the cause**
  but **removes input values** (for Pydantic errors it uses the error list without inputs; a message that contains the
  employee's text is replaced by `[redacted]`). Message text, names and the API key never appear in a log line.
- **Local debug switch.** `DEBUG_LOG_PROMPTS=true` additionally logs the prompt and the model's raw reply, so a bad draft can be
  explained. It is `false` by default, prints a warning at startup, and must stay off in production. `LOG_LEVEL` sets the verbosity.
- **The database is the durable record.** The same redacted trace is sent back in the AI service's error response and stored by the
  backend in `error_detail`, so a failure can still be investigated after the host's logs have expired. Stdout is the live view.
- **Limits.** Hosted log viewers keep logs for a limited time, so old traces may be gone (the stored `error_detail` is the fallback); a long-term log service is out of
  scope. No third-party tracing service (for example LangSmith) is used, because it would send prompts to another company.

## Code style

TypeScript follows the existing apps (named exports, zod for input, `ApiError` codes, services in `src/services`, no
comments that restate the code). Python follows PEP 8 with type hints on every function and Pydantic models at the
boundaries:

```python
class Draft(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=5000)
    category: str
    priority: Literal["LOW", "MEDIUM", "HIGH", "URGENT"]
    department: str
    confidence: float = Field(ge=0, le=1)
    reasoning: str = Field(max_length=300)

def draft_request(req: DraftRequest, model: BaseChatModel) -> Draft:
    structured = model.with_structured_output(Draft, method="json_schema")
    for attempt in range(2):
        draft = structured.invoke(build_messages(req))
        if is_allowed(draft, req):
            return draft
    raise InvalidModelOutput()
```

## Testing strategy

| Level | What | Tool |
|---|---|---|
| AI service unit | **Stateless:** it writes no file and opens no database connection. **Logs:** one JSON line per event with the request id from `X-Request-Id`; a failing call prints a traceback; a failing call whose input contains a recognisable message never prints that message (Pydantic input values and wrapped errors are redacted); the API key never appears; `DEBUG_LOG_PROMPTS` is off by default and, when on, warns at startup; every error response carries the request id and a cause without input text. Token check (missing, wrong, right); body validation; the drafter with a **fake chat model**: valid output, unknown category code then valid on retry, invalid twice → `502`, timeout → `504`, low confidence flag at the 0.6 threshold; the prompt contains the categories and the message only as data; the prompt sent to the model contains the message, country and department name only | pytest |
| Backend integration | `chat-draft` with the AI client mocked: success maps codes to ids; **a `chat_drafts` row is written for every outcome, with the request id that was sent to the AI service and an `error_code`, a short `error` reason and a redacted `error_detail` for each failure kind (connection refused, timeout, 401, 429, model error, invalid output, rejected by the backend, bad response shape), `attempts` stored; `error_detail` never contains the message text** (OK, invalid output, timeout, unavailable) with the signed-in user's id (a `userId` sent in the body is a `422`), the page, IP and user agent, the model, latency and chosen values, the message length and **never the text**; if writing the row fails the draft is still returned; `401`, `422` (empty, too long, extra field); AI down, timeout, invalid category or department code, priority outside the enum → `503`; nothing is written to the database; `POST /requests` with and without `handlingDepartmentId`, with an unknown department → `422` | Vitest, real test DB |
| Backend (channel and history) | `POST /requests` stores `channel` (`CHAT`, default `FORM`, invalid is `422`); `GET /requests` with `mine=true` returns only the caller's own requests (also for a Manager and an HR Admin) and with `channel=CHAT` only chat ones; scope rules are unchanged; ordering and paging | Vitest, real test DB |
| Frontend | The request sends the current page path. Earlier requests: bubble pairs in order, live status badge, link to the request, loading, error and empty states, refreshed after Submit; the greeting stays first. Chat head appears in the signed-in layout only; send disabled while empty/waiting; card shows AI badges and the low-confidence note; every field editable; category change sets the department; submit sends the edited values (including `handlingDepartmentId`); AI-down shows the fallback; the sheet keeps the draft when closed and reopened | Vitest + Testing Library |
| Quality (by hand) | ~15 labelled messages (including the laptop example, a vague "it's broken", a non-English message, an injection attempt, a facilities and an HR query) | `uv run python -m eval.run`, needs the key |

Coverage target: every branch in the drafter and in `intake.ts` has a test. No test calls the real model API.

## Boundaries

- **Always:** keep the AI service stateless (no files, no database); validate every AI answer in the backend before returning it;
  let the employee see and edit every field before anything is saved; keep the existing form working; run the type-check
  and tests before committing; keep secrets in `.env` files that are git-ignored; use a separate branch.
- **Ask first:** adding a dependency beyond those listed; any further database schema change (this build adds `chat_drafts` and `service_requests.channel`, both approved); adding the message text
  to the chat record; any retention or deletion of records; sending anything but the message, country and department name to the model provider; deploying the AI service.
- **Never:** let the AI submit, assign or write anything; commit or print `GROQ_API_KEY` or `AI_SERVICE_TOKEN`; log or store
  message text (the record shows who and from where, not what was said); let the AI service write files or reach the database; turn on `DEBUG_LOG_PROMPTS` in production; call the real model API from automated tests; expose the AI service to the browser; remove or weaken the existing
  form or its tests.

## Environment

| Service | Variable | Purpose |
|---|---|---|
| ai-service | `GROQ_API_KEY` | Groq key (added by the user; never committed) |
| ai-service | `GROQ_MODEL` | Model id, default `qwen/qwen3.8-27b` |
| ai-service | `AI_SERVICE_TOKEN` | Shared secret the backend must send |
| ai-service | `LLM_TIMEOUT_SECONDS` | Default `20` |
| ai-service | `CONFIDENCE_THRESHOLD` | Default `0.6` (below it the draft is flagged) |
| ai-service | `LOG_LEVEL` | Default `INFO` |
| ai-service | `DEBUG_LOG_PROMPTS` | Default `false`. Local debugging only: also logs the prompt and the raw model reply |
| backend | `AI_SERVICE_URL` | `http://localhost:8000` |
| backend | `AI_SERVICE_TOKEN` | Must match the AI service's |

`ai-service/.env.example` lists the names only. `ai-service/.gitignore` ignores `.env`, `.venv` and caches.

## What differs from v2

| v2 §7.2 | This build |
|---|---|
| Multi-turn chat: questions, "Add details" re-draft | One message, one draft; edits are by hand |
| `QUESTION`, `DRAFT`, `OUT_OF_SCOPE` replies | Always a draft; vague or off-topic gets `lowConfidence` |
| Signed draft token, `channel`, `intake_transcript`, `AI` vs `USER` sources | Only `channel` (FORM or CHAT) is recorded on `service_requests`, to show earlier chat requests; no token, transcript or sources. Instead a new `chat_drafts` table (written by the backend) records who asked and from where, for developers to query (no product screen) |
| AI service reads `ai_*` views with a read-only database role | The backend sends the categories and departments; the AI service has no database access |
| Generic "LLM", Pydantic-validated JSON | Groq-hosted Qwen via LangChain `with_structured_output` |
| Post-submission routing, assignee recommendation, dashboard AI card | Not built |

## Success criteria

1. For the laptop example, the draft is IT Equipment / Urgent / IT Operations with a sensible title and description (checked
   in the by-hand evaluation).
2. On the 15-message evaluation set, category is correct for at least 85% (13 of 15) and no message returns a value
   outside the allowed lists.
3. Every field on the card is editable, and the submitted request has exactly the values shown on the card at that moment.
4. Nothing is written to the database by `chat-draft`; a request exists only after Submit.
5. With the AI service stopped, the chat head shows a clear message and a link to the normal form, the form still submits,
   and no existing test fails.
6. A request sent to a department other than its category's appears in that department's Manager's queue.
7. The AI service rejects calls without the right token; the key and token appear in no committed file, log or test output.
8. Every call to `chat-draft`, successful or not, adds one `chat_drafts` row with who asked and from where, and no message
   text; a failure to write a row never breaks a draft; the AI service writes no files. No page, endpoint or nav item exposes
   the record: an HR Admin has no way to see it.
9. Requests submitted from the assistant have `channel = CHAT`; the chat shows the person's own earlier chat requests, oldest first, with
   their live status, and nobody else's. Form requests are not in the thread.
10. When the AI service is down, a developer can find out from the database alone: failed rows carry an error code, a short
   reason, a redacted detail and a request id, and the example queries in the runbook return them; for a failure inside the
   service, searching its logs for that request id finds a traceback that contains no message text.
11. Backend tests, frontend tests, AI service tests and both type-checks pass; no automated test calls the model.

## Decided since the first draft

- Model: first `gemini-3.5-flash` on Google; **changed to `qwen/qwen3.8-27b` on Groq** (your request, v8). Python: 3.14 (checked, works). Sending messages to Google was confirmed fine; Groq is now the recipient. Free-tier limits and the
  "AI unavailable" message: fine.
- The chat record shows **who requested it and from where, not what was asked**. It is **kept for the future** and is **for developers only** (read in the database, no product screen). Because the system is stateless, the **backend writes it to the database**; the AI service does not write
  files.

## Open questions

1. **Retention.** Records are kept indefinitely in this build. Do you want a limit later (for example delete after 12
   months)? Nothing to decide now unless you want it built.
2. **Link a developer record to its request.** `chat_drafts` rows are not linked to the request that was later submitted. Not in this build.
3. **Where the work is tracked:** as new tasks (T23 onward) in `tasks/todo.md` once approved.
