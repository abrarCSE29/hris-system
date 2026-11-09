/** Where a request came from: the first forwarded address and the user agent, cut to a fixed length. Null when not sent. */
export interface Origin {
  ip: string | null;
  userAgent: string | null;
}

export function originOf(req: Request): Origin {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = (forwarded || req.headers.get("x-real-ip") || "").trim().slice(0, 64);
  return { ip: ip || null, userAgent: req.headers.get("user-agent")?.slice(0, 300) || null };
}
