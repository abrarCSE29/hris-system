# Intent: AI chat draft for service requests

Confirmed with the user (explicit yes) after an interview. Source for the spec that follows. Related: `docs/architecture-v2.md`
§7.2 (chat assistant), which this narrows and changes.

## Statement of intent

- **Outcome:** an employee types one plain message, for example "My laptop is firing up, need technical help". A Gemini
  Flash model, called through LangChain with structured output, returns the form fields: title, description, category,
  priority and department. The employee checks and edits any field directly, then submits through the normal request
  endpoint.
- **User:** every signed-in employee, manager and HR Admin, from a floating chat head on every signed-in page.
- **Why now:** filling in the form by hand is slow and people often pick the wrong category or priority. The AI does the
  first pass and a person confirms it.
- **Success:** a message like the example above comes back with sensible values (IT Equipment, Urgent, IT Operations).
  Every field is editable and nothing is saved until Submit. A vague message still returns a draft with a "low confidence,
  please check" note. If the AI is down, the normal form still works.
- **Constraint:** a separate Python AI service (FastAPI, LangChain, Google Gemini) that only suggests and never writes to
  the database. The backend calls it and validates the result. The Gemini API key lives only in the AI service's `.env`,
  which stays out of git. The user adds the key themselves.
- **Out of scope:** the Parallel "Decisions Fast" model (looked at and set aside: it returns typed decisions only, cannot
  write text, and searches the live web), follow-up messages and re-drafting ("Add details"), conversational replies and
  clarifying questions, recommending a person, routing after submission, the dashboard AI card, and the new request
  actions (reopen, withdraw, transfer). Template archive, the OpenAPI docs and the rest of v2 are also left out.

## Decisions made in the interview

| Question | Answer |
|---|---|
| Which model decides? | Not the OpenRouter Parallel Decisions model. Gemini Flash through LangChain with structured output. |
| Before or after submission? | Before. The draft fills the form; the employee reviews, edits and submits. |
| How are fields changed? | Direct editing only, on the draft card. No typed follow-ups to the AI. |
| Gemini model and key | A Gemini Flash model; the API key is added by the user in the AI service's `.env`. |
| Where does the chat live? | The floating chat head from v2, on every signed-in page. |
| Vague message | Still returns a draft, flagged "low confidence, please check". No clarifying question. |

## Worked example

Message: "My laptop is firing up, need technical help".
Expected draft: category IT Equipment, priority Urgent (possible safety risk), department IT Operations, with a short
title and a clear description that keeps only the facts the employee gave.
