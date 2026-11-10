# HRIS: Service Requests & Employee Onboarding

Live app: <https://hris-system-livid.vercel.app/login>

## What you need

**Docker** with Docker Compose. Nothing else is needed to run the system.

## Install and run

```bash
git clone https://github.com/abrarCSE29/hris-system.git
cd hris-system
docker compose up --build
```

The first start takes a few minutes while everything is built. When the messages settle down, open
<http://localhost:3000>.

The first start also adds demo data (100 people, 80 requests, 7 new hires being onboarded). It is only added when the system
has no people yet, so starting it again never erases anything.

## Sign in

Every demo account uses the password `Password123!`.

| Email | Role |
|---|---|
| `hr.admin@hris.test` | HR Admin |
| `manager@hris.test` | Manager (Engineering) |
| `it.manager@hris.test` | Manager (IT Operations) |
| `new.hire@hris.test` | Employee, being onboarded |
| `it.support@hris.test` | Employee (IT Operations) |

## Stop, restart and reset

| What you want | Command |
|---|---|
| Start it again | `docker compose up` |
| Start it in the background | `docker compose up -d` |
| Stop it (your data is kept) | `docker compose down` |
| Erase all data and start fresh | `docker compose down -v`, then start it again |

## The AI assistant (optional)

The chat button (bottom right) fills in a request from one sentence. It needs a free key from [Groq](https://console.groq.com/).
Without a key everything else works, and the chat says the assistant is not available.

1. Copy `.env.example` to `.env`.
2. Put your key after `GROQ_API_KEY=`.
3. Run `docker compose up -d` again.

## Settings (optional)

Everything works without changes. To change a setting, copy `.env.example` to `.env` and edit it.

| Setting | What it does |
|---|---|
| `GROQ_API_KEY` | Your key for the assistant |
| `SEED_PASSWORD` | The password of the demo accounts. Only used the first time, when the demo data is added |
| `FRONTEND_PORT` | The port for the website, if 3000 is already used on your computer |
| `DB_PORT` | The port for the database, if 5433 is already used |
| `JWT_SECRET`, `AI_SERVICE_TOKEN` | Private codes the parts of the system use to trust each other. Change them if other people can reach your computer |

## If something goes wrong

- **A port is already in use:** set `FRONTEND_PORT` (or `DB_PORT`) in `.env` to a free number and start it again.
- **Old data is still there:** the demo data is not added again. Run `docker compose down -v` and start it again.
- **The page does not open:** wait until the messages stop (the first start is slow), then reload. `docker compose logs backend` shows what the data part is doing.

## Run without Docker for the website (for development)

You need Node.js 20.19 or newer with npm, and Docker for the database. For the optional assistant you also need
[uv](https://docs.astral.sh/uv/).

```bash
# 1. The database only
docker compose up -d --wait db

# 2. The backend (http://localhost:4000)
cd backend
cp .env.example .env
npm install
npm run db:migrate
npm run db:seed        # adds the demo data; this ERASES existing data
npm run dev

# 3. The website (http://localhost:3000), in a second terminal
cd frontend
cp .env.example .env
npm install
npm run dev

# 4. The assistant (optional), in a third terminal
cd ai-service
cp .env.example .env   # fill in GROQ_API_KEY and AI_SERVICE_TOKEN
uv sync
uv run uvicorn app.main:app --port 8000
```

For the assistant, `AI_SERVICE_TOKEN` in `ai-service/.env` and `backend/.env` must be the same text, and `AI_SERVICE_URL` in
`backend/.env` must be `http://localhost:8000`. Restart the backend after changing its `.env`.
