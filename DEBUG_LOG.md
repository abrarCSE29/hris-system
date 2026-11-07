# Debug log

Problems met while building v1: what was seen, the real cause, the fix, and how to avoid it next time.
Ordered roughly as they happened. Entries marked **real bug** were defects in my code; the others were environment,
tooling or test-setup issues.

---

## 1. `prisma@latest` is a release candidate: **tooling**
- **Seen:** `npm view prisma version` returned `8.0.0-rc.33`.
- **Cause:** the `latest` dist-tag pointed at a pre-release.
- **Fix:** pinned the stable `7.10.1` (the `prev` tag). Prisma 7 needs `prisma.config.ts` and a driver adapter
  (`@prisma/adapter-pg`), which the schema work was built around.
- **Lesson:** check dist-tags before trusting "latest".

## 2. shadcn CLI generated imports from an unknown npm package called `cn`: **tooling / supply chain**
- **Seen:** generated components contained `import { cn } from "cn"` and `package.json` gained a `cn` dependency.
- **Cause:** the CLI's output, not the standard `clsx` + `tailwind-merge` helper.
- **Fix:** wrote `lib/utils.ts` with `clsx` + `tailwind-merge`, rewrote the imports, uninstalled `cn`.
- **Lesson:** read what a code generator adds; replace third-party packages for trivial helpers.

## 3. Would Prisma drop the hand-written partial indexes? **checked, not a bug**
- **Worry:** Prisma's schema can't express partial indexes, CHECK constraints or RLS, so a later generated migration
  might drop them.
- **Check:** `prisma migrate diff` against the migrated database.
- **Result:** the indexes and constraints are left alone. The only difference was cosmetic: the `reference` default
  (`SR-1001…`) is normalised by Postgres, so the `dbgenerated(...)` text in the schema was adjusted to match.
- **Kept as a rule:** review every generated migration (see README). A test asserts the four partial indexes exist.

## 4. `TRUNCATE … RESTART IDENTITY` did not reset the `SR-` numbers: **test setup**
- **Seen:** a test expected `SR-1001` and got `SR-1005`.
- **Cause:** `service_request_ref_seq` is a standalone sequence, not owned by a column, so `RESTART IDENTITY` ignores it.
- **Fix:** reset it explicitly (`ALTER SEQUENCE … RESTART WITH 1001`) in `resetDb` and in the seed's `clearAll`.

## 5. Emails with spaces or capitals were rejected when creating a user: **real bug**
- **Seen:** `POST /users` with `"  Test.Person@HRIS.test "` returned 422.
- **Cause:** the schema was `z.email().trim().toLowerCase()`: validation ran *before* the clean-up.
- **Fix:** `z.string().trim().toLowerCase().pipe(z.email())`: normalise first, then validate. Login already did this.
- **Found by:** the first create-user test. Lesson: test with messy input, not just tidy input.

## 6. Creating a user with an onboarding checklist hung until the test timed out: **real bug**
- **Seen:** six tests timing out after 5 s; nothing in the logs.
- **Cause:** inside `prisma.$transaction`, `nextEmployeeCode()` queried through the *global* client. The pool is
  deliberately limited to one connection (right for serverless), and the transaction already held it, so the
  query waited forever for a connection that would never be released. A **deadlock**, and it would have occurred
  in production too.
- **Fix:** pass the transaction client into every helper called inside a transaction. The helper now requires it.
- **Lesson:** with `max: 1`, anything inside a transaction must use the transaction client.

## 7. Dev server returned 500: `scopeRequests is not a function`: **tooling**
- **Seen:** `GET /requests` → 500 while the tests passed.
- **Cause:** the dev server had loaded `policy.ts` before the function was added and held stale module state.
- **Fix:** restart the dev server. Tests (a fresh process) were right all along.
- **Lesson:** when the tests pass but the dev server fails on a function that exists, restart it first.

## 8. `next build` while `next dev` was running broke the dev server: **tooling**
- **Cause:** both write to `.next/` in the same folder.
- **Fix:** stop dev, delete `.next`, start again. README warns about it.

## 9. Several tests failed because the *test* was wrong: **test fixtures, not bugs**
In each case the code was right and the expectation was wrong. Recorded because the temptation is to "fix" the code.
- An IT colleague who is neither head nor assignee **cannot see** an unassigned request, so they correctly get 404, not 409.
- The "other manager" picked for a test was the *Head of IT*, who is rightly an owner of IT tasks.
- A test actor was placed in the IT department by copy-paste, so was rightly allowed to act on IT tasks.
- A department head sees a request through *two* paths (their queue and their direct report); the expected list was wrong.
- A test reused an email created by an earlier test (409).
- **Lesson:** when a permission test fails, check the fixture's departments and reporting lines before touching the policy.

## 10. Seeded new hires were all in Engineering: **seed quality**
- **Seen:** every new hire used the Engineering template, so the Standard template was never exercised and all hires
  shared one manager group.
- **Cause:** the seed picked "the first eligible employee per country", and Engineering is listed first.
- **Fix:** each hire has a preferred department; the seed now covers 5 departments and 5 managers.

## 11. Default joining date was "yesterday" in Dhaka: **real bug (caught before release)**
- **Cause:** the new-hire form defaulted to `new Date().toISOString().slice(0, 10)`, which is the **UTC** date. After
  midnight in Dhaka (UTC+6) that is the previous day, so Day 1 tasks would show as overdue immediately.
- **Fix:** use the viewer's local date (`toLocaleDateString("en-CA")`).
- **Found by:** a walkthrough that showed `overdue: 4` for a hire starting "today".

## 12. `next build` failed on a fresh deployment without `DATABASE_URL`: **real bug (deployment)**
- **Seen:** `Failed to collect page data … DATABASE_URL is not set`.
- **Cause:** the database client was created when the module was imported, and Next imports route modules during build.
- **Fix:** the client is now created on first use (a lazy proxy). A request without the variable fails with a clear
  error instead of the build failing.
- **Found by:** building with `DATABASE_URL=` set empty, to imitate a brand-new Vercel project.

## 13. My own scripts, not the app: **checking my work**
- A `grep` for `"total":` matched a *task* count inside the first checklist (10) instead of the list total (7), which
  briefly looked like a data bug. The database had the right 7.
- A regex to find a task id failed silently, producing an empty id and an HTTP 308 on `//transitions`. The id is now
  read from the database.
- **Lesson:** when a smoke test disagrees with the tests, check the smoke test.

## 14. Moving to stock shadcn components: what the CLI changed behind my back: **tooling**
- **Seen:** after `shadcn add select table field …` (with `--overwrite`), 18 components imported from the unknown
  `cn` package again, `package.json` had `cn` back, and `recharts` had moved from `^3.10.1` to `^3.8.0`.
- **Fix:** re-pointed imports to `@/lib/utils`, uninstalled `cn`, reinstalled `recharts@3.10.1`. `globals.css` was
  left untouched (diffed against a backup first). (A one-line radius edit to `progress.tsx` made for the 2px rule
  was later reverted when that rule was dropped.)
- **Lesson:** back up the theme file and `package.json` before running the CLI, and diff afterwards.

## 15. Testing UI I can't see: **approach, not a bug**
- With no browser available, the Base UI Select, Sidebar, Input Group and form flows were verified with real
  component tests (jsdom + Testing Library): open the dropdown, choose an option, submit, check the payload.
  Two things jsdom lacks (`ResizeObserver`, `matchMedia`) are stubbed in the tests.
- **Still unverified:** how it looks and feels in a real browser.

---

## Not resolved / not verified

- **Never viewed in a browser.** The Chrome extension was not connected for the whole build, so no page was seen or
  clicked. API behaviour was checked over HTTP through the real stack, and the front-end logic by unit tests, but
  layout, responsive breakpoints, chart rendering and keyboard use are unchecked.
- **Not deployed.** Vercel / Supabase behaviour is unverified: cookie through the rewrite on a real domain, TLS
  to the Supabase pooler, row-level security with the real role, transaction-mode pooling.
- **A request to disable TLS certificate verification for the database was blocked** by the environment's safety
  check, and I did not work around it. If the hosted database rejects the certificate, handle it deliberately
  (see README, "Things to check on the first deploy").
