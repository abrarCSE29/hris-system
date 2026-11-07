"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

/**
 * A password field built from the shadcn Input Group, with a show/hide button as its trailing addon.
 * The button is keyboard-focusable and announces its state ("Show password" / "Hide password").
 */
function PasswordInput({ className, ...props }: Omit<React.ComponentProps<typeof InputGroupInput>, "type">) {
  const [visible, setVisible] = React.useState(false);
  return (
    <InputGroup className={className}>
      <InputGroupInput {...props} type={visible ? "text" : "password"} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

export { PasswordInput };
