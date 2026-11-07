"use client";

import { SelectField, type Option } from "@/components/select-field";
import { cn } from "@/lib/utils";

/** Stands in for "no filter" inside the list, because the Select can't hold an empty value as an item. */
const ALL = "__all__";

interface Props {
  /** Shown when nothing is picked, and as the first option that clears the filter. */
  label: string;
  /** "" means no filter. */
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  className?: string;
}

/** A compact filter dropdown whose first option, named after `label`, clears the filter. */
export function FilterSelect({ label, value, onChange, options, className }: Props) {
  return (
    <SelectField
      aria-label={label}
      value={value === "" ? ALL : value}
      onValueChange={(v) => onChange(v === ALL ? "" : v)}
      options={[{ value: ALL, label }, ...options]}
      className={cn("w-auto min-w-40", className)}
    />
  );
}
