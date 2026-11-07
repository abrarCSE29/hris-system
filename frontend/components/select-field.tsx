"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  label: string;
}

interface Props {
  id?: string;
  /** "" means nothing chosen. */
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
  className?: string;
}

/**
 * The shadcn Select, wrapped for the app's convention that a form value is a string and "" means "not chosen"
 * (Base UI uses null for that). `options` is also given to Base UI as `items`, so the trigger shows the
 * option's label, not its raw value.
 */
export function SelectField({ id, value, onValueChange, options, placeholder, required, disabled, invalid, className, ...rest }: Props) {
  return (
    <Select
      value={value === "" ? null : value}
      onValueChange={(v) => onValueChange((v as string | null) ?? "")}
      items={options}
      required={required}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={rest["aria-label"]} aria-invalid={invalid || undefined} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
