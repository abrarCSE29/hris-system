"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { useUsers } from "@/lib/hooks/users";
import type { User } from "@/lib/types";

interface Props {
  selected: User | null;
  onSelect: (user: User | null) => void;
}

/** Search-and-pick for one employee. Searches name, email and employee code. */
export function EmployeePicker({ selected, onSelect }: Props) {
  const [term, setTerm] = useState("");
  const search = useDebounced(term.trim());
  const users = useUsers({ search, pageSize: 6 });

  if (selected) {
    return (
      <Card size="sm">
        <CardContent className="flex items-center justify-between gap-3 text-sm">
          <div>
            <div className="font-medium">{selected.fullName}</div>
            <div className="text-xs text-muted-foreground">
              {selected.email} · {selected.department.name}
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onSelect(null)}>
            Change
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <InputGroup>
        <InputGroupAddon>
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupInput aria-label="Search employees" placeholder="Search name, email or code" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" />
      </InputGroup>
      <Card size="sm" className="gap-0 py-0">
        <ul className="divide-y" aria-label="Matching employees">
          {users.data?.data.map((u) => (
            <li key={u.id}>
              <button type="button" className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none" onClick={() => onSelect(u)}>
                <span className="font-medium">{u.fullName}</span>
                <span className="text-xs text-muted-foreground">
                  {u.email} · {u.department.name}
                </span>
              </button>
            </li>
          ))}
          {users.data && users.data.data.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">No one found.</li>}
          {users.isPending && <li className="px-3 py-4 text-sm text-muted-foreground">Loading…</li>}
        </ul>
      </Card>
    </div>
  );
}
