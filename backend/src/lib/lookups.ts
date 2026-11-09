/**
 * Codes the program branches on. The three lookup tables (roles, countries, user_statuses) hold these rows, but their generated ids
 * differ between environments, so behaviour is always decided on the `code`, never on an id (spec docs/spec-lookup-tables.md).
 */
export const ROLE_CODES = ["EMPLOYEE", "MANAGER", "HR_ADMIN"] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const STATUS_CODES = ["ACTIVE", "ON_PROBATION", "ON_NOTICE"] as const;
export type StatusCode = (typeof STATUS_CODES)[number];

/** Statuses a person can be created with: "on notice" makes no sense for a new person. */
export const NEW_USER_STATUS_CODES = ["ACTIVE", "ON_PROBATION"] as const satisfies readonly StatusCode[];

export interface LookupRef {
  id: string;
  code: string;
  name: string;
}
export interface CountryRef {
  id: string;
  shortcode: string;
  name: string;
}
