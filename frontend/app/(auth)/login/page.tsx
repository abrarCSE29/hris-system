"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useLogin, useMe } from "@/lib/hooks/auth";
import { homeForRole } from "@/lib/nav";

export default function LoginPage() {
  const router = useRouter();
  const me = useMe();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Already signed in (valid session): skip the form.
  useEffect(() => {
    if (me.data) router.replace(homeForRole(me.data.user.role.code));
  }, [me.data, router]);

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-black p-12 text-white lg:flex">
        <div className="text-lg font-semibold tracking-tight">
          HRIS<span className="text-primary">.</span>
        </div>
        <div className="max-w-md space-y-4">
          <p className="text-xs font-medium uppercase tracking-widest text-primary">Requests · Onboarding</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">One place for requests and new-joiner onboarding.</h1>
          <p className="text-white/70">Bangladesh, Malaysia, Sri Lanka and Cyprus, on a single shared set of people, teams and workflows.</p>
        </div>
        <div className="text-xs text-white/50">Internal use only</div>
      </section>

      <section className="flex items-center justify-center bg-muted/40 px-6 py-12">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle role="heading" aria-level={2} className="text-2xl font-semibold tracking-tight">
              Sign in
            </CardTitle>
            <CardDescription>Use your work email and password.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                login.mutate({ email, password });
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Button type="submit" className="w-full" disabled={login.isPending}>
                  {login.isPending ? "Signing in…" : "Sign in"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
