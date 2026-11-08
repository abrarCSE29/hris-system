import { cn } from "@/lib/utils";

/** One side of the conversation: the person's words on the right (black), the assistant's on the left (grey). */
export function ChatBubble({ from, className, children }: { from: "you" | "assistant"; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex", from === "you" ? "justify-end" : "justify-start")}>
      <div
        data-from={from}
        className={cn(
          "max-w-[90%] rounded-xl px-3 py-2 text-sm",
          from === "you" ? "bg-foreground text-background" : "bg-muted text-foreground",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
