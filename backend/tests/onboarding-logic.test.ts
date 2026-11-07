import { describe, expect, it } from "vitest";
import {
  addDays, displayStatus, findDependencyProblems, isBlocked, isOverdue, offsetForLabel, summarize, todayInDhaka,
  type TaskFacts,
} from "@/services/onboarding-logic";

describe("todayInDhaka", () => {
  it("uses the Dhaka calendar date (UTC+6), not the UTC date", () => {
    // 20:00 UTC on 7 Nov is already 02:00 on 8 Nov in Dhaka.
    expect(todayInDhaka(new Date("2026-11-07T20:00:00Z"))).toBe("2026-11-08");
    expect(todayInDhaka(new Date("2026-11-07T17:59:59Z"))).toBe("2026-11-07");
    expect(todayInDhaka(new Date("2026-11-07T18:00:00Z"))).toBe("2026-11-08");
  });
});

describe("addDays", () => {
  it("adds calendar days across month and year ends", () => {
    expect(addDays("2026-11-08", 0)).toBe("2026-11-08");
    expect(addDays("2026-11-28", 4)).toBe("2026-12-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-27", 2)).toBe("2028-02-29");
  });
});

describe("offsetForLabel", () => {
  it.each([
    ["Day 1", 0], ["Day 30", 29], ["day 2", 1], ["Week 1", 4], ["Week 2", 9], ["  Week 4 ", 19],
  ])("%s → %i", (label, offset) => expect(offsetForLabel(label)).toBe(offset));

  it.each(["Day 0", "Week 0", "Month 1", "Before day one", "Day", "Day 1.5", ""])("%j is a custom label", (label) =>
    expect(offsetForLabel(label)).toBeNull(),
  );
});

describe("findDependencyProblems", () => {
  const t = (key: string, dependsOnKey?: string) => ({ key, dependsOnKey });

  it("accepts independent tasks and straight chains", () => {
    expect(findDependencyProblems([t("a"), t("b"), t("c")])).toEqual([]);
    expect(findDependencyProblems([t("a"), t("b", "a"), t("c", "b")])).toEqual([]);
    expect(findDependencyProblems([t("c", "b"), t("b", "a"), t("a")])).toEqual([]); // order doesn't matter
  });

  it("accepts several tasks depending on the same task", () => {
    expect(findDependencyProblems([t("a"), t("b", "a"), t("c", "a")])).toEqual([]);
  });

  it("rejects a task depending on itself", () => {
    expect(findDependencyProblems([t("a", "a")])).toEqual([expect.objectContaining({ index: 0, message: expect.stringMatching(/itself/) })]);
  });

  it("rejects an unknown dependency key", () => {
    expect(findDependencyProblems([t("a", "zzz")])).toEqual([expect.objectContaining({ index: 0, field: "dependsOnKey", message: expect.stringMatching(/Unknown/) })]);
  });

  it("rejects duplicate keys", () => {
    expect(findDependencyProblems([t("a"), t("a")])).toEqual([expect.objectContaining({ index: 1, field: "key" })]);
  });

  it("rejects a two-task cycle (A→B→A), reporting each task once", () => {
    const problems = findDependencyProblems([t("a", "b"), t("b", "a")]);
    expect(problems.every((p) => /cycle/.test(p.message))).toBe(true);
    expect(problems.map((p) => p.index).sort()).toEqual([0, 1].filter((i) => problems.some((p) => p.index === i)));
    expect(problems.length).toBeGreaterThanOrEqual(1);
    expect(problems.length).toBeLessThanOrEqual(2);
  });

  it("rejects longer cycles and a tail leading into a cycle", () => {
    expect(findDependencyProblems([t("a", "c"), t("b", "a"), t("c", "b")]).length).toBeGreaterThan(0);
    const withTail = findDependencyProblems([t("x", "a"), t("a", "b"), t("b", "a")]);
    expect(withTail.length).toBeGreaterThan(0);
    expect(withTail.some((p) => p.index === 0)).toBe(true); // the tail task leads into the cycle too
  });
});

describe("calculated status", () => {
  const facts = (over: Partial<TaskFacts> = {}): TaskFacts => ({ status: "NOT_STARTED", dependsOnStatus: null, dueDate: "2026-11-10", ...over });

  it("a task with no dependency is never blocked", () => {
    expect(isBlocked(facts())).toBe(false);
  });

  it("is blocked while its dependency is not completed, and unblocked once it is", () => {
    expect(isBlocked(facts({ dependsOnStatus: "NOT_STARTED" }))).toBe(true);
    expect(isBlocked(facts({ dependsOnStatus: "IN_PROGRESS" }))).toBe(true);
    expect(isBlocked(facts({ dependsOnStatus: "COMPLETED" }))).toBe(false);
  });

  it("a completed task is never blocked", () => {
    expect(isBlocked(facts({ status: "COMPLETED", dependsOnStatus: "NOT_STARTED" }))).toBe(false);
  });

  it("is overdue only when unfinished and due before today", () => {
    expect(isOverdue(facts({ dueDate: "2026-11-07" }), "2026-11-08")).toBe(true);
    expect(isOverdue(facts({ dueDate: "2026-11-08" }), "2026-11-08")).toBe(false); // due today
    expect(isOverdue(facts({ dueDate: "2026-11-09" }), "2026-11-08")).toBe(false);
    expect(isOverdue(facts({ dueDate: "2026-01-01", status: "COMPLETED" }), "2026-11-08")).toBe(false);
  });

  it("displays Completed → Blocked → In Progress / Not Started", () => {
    expect(displayStatus(facts({ status: "COMPLETED", dependsOnStatus: "NOT_STARTED" }))).toBe("COMPLETED");
    expect(displayStatus(facts({ dependsOnStatus: "NOT_STARTED" }))).toBe("BLOCKED");
    expect(displayStatus(facts({ status: "IN_PROGRESS" }))).toBe("IN_PROGRESS");
    expect(displayStatus(facts())).toBe("NOT_STARTED");
  });

  it("a chain A→B→C blocks both B and C until their own dependency is done", () => {
    const [a, b, c] = ["IN_PROGRESS", "NOT_STARTED", "NOT_STARTED"] as const;
    expect(displayStatus({ status: b, dependsOnStatus: a })).toBe("BLOCKED");
    expect(displayStatus({ status: c, dependsOnStatus: b })).toBe("BLOCKED");
    expect(displayStatus({ status: b, dependsOnStatus: "COMPLETED" })).toBe("NOT_STARTED");
    expect(displayStatus({ status: c, dependsOnStatus: "COMPLETED" })).toBe("NOT_STARTED");
  });
});

describe("summarize", () => {
  it("counts by displayed status and reports overdue separately", () => {
    const today = "2026-11-08";
    const s = summarize(
      [
        { status: "COMPLETED", dependsOnStatus: null, dueDate: "2026-11-01" },
        { status: "COMPLETED", dependsOnStatus: "COMPLETED", dueDate: "2026-11-02" },
        { status: "IN_PROGRESS", dependsOnStatus: "COMPLETED", dueDate: "2026-11-05" }, // overdue
        { status: "NOT_STARTED", dependsOnStatus: "IN_PROGRESS", dueDate: "2026-11-06" }, // blocked + overdue
        { status: "NOT_STARTED", dependsOnStatus: null, dueDate: "2026-11-20" },
      ],
      today,
    );
    expect(s).toEqual({ total: 5, completed: 2, inProgress: 1, notStarted: 1, blocked: 1, overdue: 2, percentComplete: 40 });
  });

  it("handles an empty checklist", () => {
    expect(summarize([], "2026-11-08")).toMatchObject({ total: 0, percentComplete: 0 });
  });
});
