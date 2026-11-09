import { NextResponse } from "next/server";
import { withRequest } from "@/lib/with-request";

// Polled by the host, so no log line; it still carries a request id.
export const GET = withRequest(() => NextResponse.json({ status: "ok" }), { silent: true });
