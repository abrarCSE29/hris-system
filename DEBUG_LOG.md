# DEBUG LOG
---

## BUG 01: Web application crashed when testing locally
- **Symptom:** the web application crashed while testing locally.
- **Investigation:** looked at the browser console and saw a 500 error. Then looked at the frontend server logs, which showed it could not connect to the backend. Then looked at the backend logs to confirm.
- **Root cause:** the database was down.
- **Fix:** started the Docker database. Added a notification toast that shows an internal server error.
- **Prevention:** noted it for the developer and deployment checklists.

## BUG 02: Vertical timeline out of alignment on the service request status page
- **Symptom:** on the service request status page, the vertical timeline component was out of alignment.
- **Investigation:** the timeline had been built by hand from standalone shadcn components.
- **Root cause:** no shadcn component provides a vertical timeline directly.
- **Fix:** searched for a vertical timeline component, chose `timeline19` for shadcn, and instructed the coding agent to use that component.

## BUG 03: HR Admin could not assign people to tasks
- **Symptom:** an HR Admin could not assign people to onboarding tasks.
- **Investigation and root cause:** traced the API to its function and found the `HR_ADMIN` role code was missing from it.
- **Fix:** added the role code to that function.
- **Prevention:** wrote test cases for it.

## BUG 04: AI service unreachable
- **Symptom:** the AI service was unreachable.
- **Investigation:** inspected the API endpoint.
- **Root cause:** the endpoint returned a permanent redirect because of a trailing slash in the AI service URL.
- **Fix:** updated `.env` and restarted the server.

## BUG 05: Managers redirected to the template creation page
- **Symptom:** managers were being redirected to the template creation page.
- **Investigation:** inspected the API endpoint and looked at which roles it gave access to.
- **Root cause:** the route's role wrapper allowed the Manager role. A manager could therefore open the page but could not see anything, and creating a template was refused.
- **Fix:** removed the Manager role from that route.
- **Prevention:** added a test case.

## BUG 06: Supabase database would not seed
- **Symptom:** the Supabase database was not seeding.
- **Investigation:** checked the logs, which showed "table not found".
- **Root cause:** the database had not been migrated first.
- **Fix:** migrated the database, then seeded it.
- **Note:** use the direct database URL for seeding, not the pooler connection.

## BUG 07: Gemini responses failed
- **Symptom:** the Gemini response failed.
- **Investigation:** checked the logs.
- **Root cause:** Gemini models have a requests-per-minute (RPM) limit and a requests-per-day (RPD) limit. The daily limit of 20 requests was reached.
- **Fix:** switched to the Groq API.
