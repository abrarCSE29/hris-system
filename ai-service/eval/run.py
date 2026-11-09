"""
Quality check against the real model. Run by hand (it needs GROQ_API_KEY and uses your quota):

    uv run python -m eval.run [--pause SECONDS]

Prints each message with the model's answer and whether it matched, then the category accuracy. Exits with 1 if category
accuracy is below 85%. This is a developer tool: it prints the evaluation messages, which are made-up examples.
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.config import get_settings
from app.drafter import DraftFailure, build_model, draft_request
from app.schemas import DraftRequest
from eval.categories import CATEGORIES, DEPARTMENTS

TARGET = 0.85
RATE_LIMIT_WAITS = (30, 60, 60)  # seconds to wait before each retry when the free tier says "slow down"


async def draft_with_patience(req, model, settings):
    """The free tier allows only a few requests a minute, so a rate limit here means "wait and try again", not "failed"."""
    for wait in (*RATE_LIMIT_WAITS, None):
        try:
            return await draft_request(req, model, settings)
        except DraftFailure as failure:
            if failure.code != "RATE_LIMITED" or wait is None:
                raise
            print(f"    rate limited; waiting {wait}s", flush=True)
            await asyncio.sleep(wait)


async def main(pause: float) -> int:
    settings = get_settings()
    if not settings.groq_api_key:
        print("GROQ_API_KEY is not set (put it in ai-service/.env).")
        return 2
    cases = json.loads((Path(__file__).parent / "cases.json").read_text())
    model = build_model(settings)
    category_ok = priority_ok = priority_total = flag_ok = flag_total = 0

    print(f"model {settings.groq_model}, {len(cases)} cases\n")
    for i, case in enumerate(cases, 1):
        req = DraftRequest.model_validate(
            {"message": case["message"], "requesterCountry": "MALAYSIA", "requesterDepartment": "Engineering",
             "categories": CATEGORIES, "departments": DEPARTMENTS}
        )
        try:
            if i > 1:
                await asyncio.sleep(pause)
            r = await draft_with_patience(req, model, settings)
        except DraftFailure as f:
            print(f"{i:>2}. FAILED {f.code}: {f.message}\n    {case['message']}")
            continue
        ok = r.category in case["category"]
        category_ok += ok
        notes = []
        if "priority" in case:
            priority_total += 1
            priority_ok += r.priority == case["priority"]
            notes.append(f"priority {r.priority} (want {case['priority']})")
        if "priorityNot" in case:
            priority_total += 1
            priority_ok += r.priority != case["priorityNot"]
            notes.append(f"priority {r.priority} (must not be {case['priorityNot']})")
        if case.get("expectLowConfidence"):
            flag_total += 1
            flag_ok += r.low_confidence
            notes.append(f"lowConfidence={r.low_confidence} (want True)")
        print(f"{i:>2}. {'ok ' if ok else 'BAD'} {r.category:<16} {r.department:<7} conf {r.confidence:.2f} attempts {r.attempts} {r.latency_ms} ms")
        print(f"    {case['message']}")
        print(f"    -> {r.title}")
        if notes:
            print("    " + "; ".join(notes))

    accuracy = category_ok / len(cases)
    print(f"\ncategory accuracy {category_ok}/{len(cases)} = {accuracy:.0%} (target {TARGET:.0%})")
    print(f"priority {priority_ok}/{priority_total}, low-confidence flagged {flag_ok}/{flag_total} (informational)")
    return 0 if accuracy >= TARGET else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pause", type=float, default=13, help="seconds between calls (the free tier allows only a few a minute)")
    sys.exit(asyncio.run(main(parser.parse_args().pause)))
