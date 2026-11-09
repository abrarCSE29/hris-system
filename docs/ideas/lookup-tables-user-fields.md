# Lookup tables for role, country and status

Refined in a conversation with the user (idea-refine). Source for `docs/spec-lookup-tables.md`.

## Problem Statement
How might we store a user's role, country and status as rows in their own tables, linked by foreign keys, so values can be added
without a deploy and a change is one pointer on one user row?

## What the user said
- Their worry was that changing a user's role, country or status means changing the whole table. It does not: an update rewrites one
  row. History ("who changed it, when") and as-of reports were discussed and are **not** part of this change.
- "Nothing breaks, simpler data" is the success bar.
- Chosen: separate tables for **all three**; the API returns **`{ id, ... }` objects**; countries have **id, shortcode and full name**;
  list filters take the **id** ("because that is primary"); the token keeps carrying **only the user id** (role is read from the database each request).

## Recommended Direction
Create `roles`, `countries` and `user_statuses`. `users` swaps the three enum columns for required foreign keys. Roles stay under
developer control: the code compares `role.code` to `HR_ADMIN`, `MANAGER` and `EMPLOYEE`, so no screen will ever add a role.
A hand-written migration creates and fills the tables, backfills every user, then drops the old columns and enums.

## Key Assumptions to Validate
- [x] No SQL constraint or row-level-security rule depends on the three columns (checked in the migrations).
- [ ] The backfill leaves zero users without a row in each table (run on a copy of the dev database).
- [ ] Filters by id work and an unknown id is a clean 422.
- [ ] All existing backend and frontend tests pass after the move, apart from the ones that assert the old shape.

## MVP Scope
In: the three tables and their seed rows, the migration, the schema, every backend read and write, the API shape, the frontend types
and screens, tests, docs. Out: edit screens for the lookup tables, any history.

## Not Doing (and Why)
- Change log or history table: lookup tables do not give history; decide that separately.
- Employment-period rows with dates: more joins than about 100 people need.
- A screen to edit countries and statuses: the tables make it possible later.
- A screen to add roles: permissions are written in code, so a new role would do nothing.
- Sort or soft-delete columns on the lookup tables: add them when a real need appears.

## Open Questions
- None. The spec lists the assumptions to confirm.
