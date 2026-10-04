import { cn } from "@/lib/utils";

/** Logotipo em texto ("HUBBLE"), herdando a cor do contexto. */
export function HubbleLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-xl font-extrabold leading-none tracking-[0.22em]",
        className,
      )}
      aria-label="Hubble"
    >
      HUBBLE
    </span>
  );
}
