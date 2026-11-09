"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/lib/hooks/auth";
import { homeForRole } from "@/lib/nav";

/** "/" sends each role to its landing page. */
export default function Home() {
  const router = useRouter();
  const me = useMe();
  useEffect(() => {
    if (me.data) router.replace(homeForRole(me.data.user.role.code));
  }, [me.data, router]);
  return null;
}
