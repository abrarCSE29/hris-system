# Spec: lookup tables for a user's role, country and status

Status: **v3, building on the approved v2.** v3 records two things found while building (please review): the same id filters and country objects also apply to the requests and onboarding lists, and countries are listed by name. v2: the token carries only the user id (your decision). Source: `docs/ideas/lookup-tables-user-fields.md` (agreed in conversation).
Related: `docs/architecture-v1.md` (data model), `backend/prisma/schema.prisma`.

## Objective

Today `users.role`, `users.country` and `users.status` are database enums. Changing the list of values needs a migration and a deploy,
and the names shown on screen are built in the frontend. This change moves each into its own table and links `users` to it with a
foreign key. A user's change of role, country or status is then one foreign key updated on one row.

**For:** developers now (and HR later, if an edit screen is added). **Success:** the app behaves as before; the API returns the three
fields as objects; the three lists live in the database; no behaviour depends on a generated id.

**Not a goal:** history of changes, as-of reports, effective dates, any edit screen. Those were discussed and left out.

## Assumptions (correct me before approving)

1. **Table and column names.**

   | Table | Columns | Seed rows |
   |---|---|---|
   | `roles` | `id` uuid, `code` unique, `name` | `EMPLOYEE` "Employee", `MANAGER` "Manager", `HR_ADMIN` "HR Admin" |
   | `countries` | `id` uuid, `shortcode` unique (two capital letters), `name` (full name) | `BD` "Bangladesh", `MY` "Malaysia", `LK` "Sri Lanka", `CY` "Cyprus" |
   | `user_statuses` | `id` uuid, `code` unique, `name` | `ACTIVE` "Active", `ON_PROBATION` "On probation", `ON_NOTICE` "On notice" |

   `shortcode` is the ISO 3166-1 two-letter code. Roles and statuses keep `code` because the code branches on them.
2. `users` gets `role_id`, `country_id` and `status_id`, all required, each a foreign key with `ON DELETE RESTRICT`. The enum columns
   and the enums `Role`, `Country` and `UserStatus` are dropped. `status_id` has no default in the database; the app picks it.
3. **Ids are not stable between environments** (they are generated when the rows are created). Behaviour always goes through `code`
   (roles, statuses) or `shortcode` (countries); no code, test or seed hard-codes an id.
4. **API shape (your choice).** Wherever a user is returned, the three fields become objects:
   `role: { id, code, name }`, `status: { id, code, name }`, `country: { id, shortcode, name }`.
5. **Filters take the id (your choice).** Query parameters are `roleId`, `countryId`, `statusId` (the project's `…Id` naming, like
   `categoryId`). Each must be a UUID that exists; otherwise `422` with the field path, the same as `handlingDepartmentId`.
6. **Creating a user** takes `countryId` (required) and `statusId` (optional, default "On probation"); only Active or On probation
   are allowed, checked by `code`. The role is always Employee, looked up by code. Invalid ids give `422` with the field path.
7. **Reference data.** `GET /meta` returns `roles`, `countries` and `userStatuses` as lists of the objects above (so the frontend
   gets the ids it needs for filters and forms). The old `enums.roles`, `enums.countries` and `enums.userStatuses` are removed.
8. **Dashboard and department breakdown** group by the new tables. `country` fields in their responses become the country object.
   Every country, status and role is still listed, with zero, so charts never lose a bar.
9. **Row-level security** is switched on for the three new tables with no policies, like every other table (the backend's own
   database role is the only reader).
10. The three tables are **read-only for the app**: nothing creates, edits or deletes a row in them through the API.
11. **Session (your decision).** The token carries **only the user id**, exactly as today (`backend/src/lib/auth.ts`). The role is read from the
    database on every request, so a role change applies at once. `GET /auth/me` and the sign-in response return the role as `{ id, code, name }`.
    Nothing about the token changes.
12. **Also affected (found while building).** The requests list and the onboarding instances list had a `country` filter on the person's country;
    both become `countryId` with the same 422 rule. The `requester` (requests) and `employee` (onboarding) objects, and the new hires in the
    dashboard, carry `country` as `{ id, shortcode, name }`. The chat assistant is sent the country's **name** ("Bangladesh").
13. **Order.** There is no sort column, so countries are listed by name (Bangladesh, Cyprus, Malaysia, Sri Lanka), roles and statuses in
    their natural order. On the dashboard and the department table the countries therefore appear in that order, not Bangladesh, Malaysia, Sri Lanka, Cyprus.

## Commands

```
cd backend
npm run db:up                                                    # the Postgres container
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script   # drift check
npm run db:migrate && npx prisma generate
npm test                  # 659 tests today
cd ../frontend && npx tsc --noEmit && npx vitest run             # 142 tests today
```

## Project structure (what changes)

```
backend/prisma/schema.prisma                         models Role, Country, UserStatus; User foreign keys; enums removed
backend/prisma/migrations/<new>_user_lookup_tables/  hand-written: create, seed rows, backfill, NOT NULL, drop
backend/prisma/seed/*                                create the lookup rows first; users refer to them by code
backend/src/lib/{user-serializer,auth}.ts            include the three relations; role check through role.code
backend/src/services/{users,departments,dashboard,policy,onboarding,requests,intake,state-machine}.ts
backend/app/api/v1/meta/route.ts
backend/tests/*                                      helpers create users with codes; assertions use the new shape
frontend/lib/types.ts, hooks, pages and components   show name, compare on code, filters send ids
docs/architecture-v1.md, README.md                   data model and API notes
```

## The migration (the risky part)

One SQL file, in this order, inside one transaction:
1. Create the three tables with their unique constraints and a shortcode check; enable row-level security.
2. Insert the seed rows (the values listed above).
3. Add `role_id`, `country_id` and `status_id` to `users`, nullable.
4. Backfill by matching the old enum text to the new row's `code` (or `shortcode` through a fixed map: BANGLADESH→BD, MALAYSIA→MY,
   SRI_LANKA→LK, CYPRUS→CY).
5. Stop with an error if any user is still empty; then set the three columns to `NOT NULL`, add the foreign keys.
6. Replace the indexes `(department_id, status)` and `(country)` with ones on the new columns.
7. Drop the old columns, then the three enum types.

`prisma migrate dev` cannot replay the first migration here, so this one is written by hand and applied with `npm run db:migrate`,
then `npx prisma generate`. The drift check must be empty afterwards.

## Code style

Read relations in the same query, never one query per user. Compare behaviour on `code`:

```ts
// before
headOfDepartmentId: u.role === "MANAGER" ? u.departmentId : null
// after
headOfDepartmentId: u.role.code === "MANAGER" ? u.departmentId : null
```

The raw SQL in the dashboard joins `countries` and groups by `countries.shortcode`.

## Testing strategy

- Vitest against the test database, as now. Test helpers get `role`, `country` and `status` by code and create users with ids.
- **Migration test:** apply the migration to a database holding users in every old role, country and status; assert every user maps
  to the matching row and none is empty.
- **Schema test:** codes and shortcodes are unique; a shortcode that is not two capitals is rejected; a user cannot refer to a missing
  row; a lookup row in use cannot be deleted.
- **API:** the object shape on every endpoint that returns a user; each filter by id; unknown or malformed id gives `422` with the path;
  create user with and without `statusId`; the dashboard and department breakdown totals are unchanged.
- **Frontend:** types, `name` is shown, filters send ids; `npx tsc --noEmit`.
- **Unchanged behaviour:** every existing permission test passes (Employee, Manager, HR Admin).

## Boundaries

- **Always:** compare on `code` or `shortcode`; load the role from the database on every request; run the drift check.
- **Ask first:** putting anything but the user id in the token; adding any column beyond the ones above; a screen to edit a lookup table.
- **Never:** hard-code a generated id; let the API create, edit or delete a lookup row; commit the seed password.

## Success criteria

1. After the migration every user has a role, country and status, and the drift check is empty.
2. The three enums and columns are gone; `users` holds foreign keys.
3. Every endpoint that returns a user returns the three objects; `GET /meta` lists the three tables.
4. List filters take ids; unknown ids are a clean `422`.
5. All permission rules work as before; dashboard and department numbers are unchanged.
6. Backend and frontend tests and the type-check pass.

## Open questions

- `shortcode` is assumed to be ISO two-letter. Say if you want different values.
