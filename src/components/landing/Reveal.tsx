// Entra com fade e leve deslocamento quando aparece na tela (IntersectionObserver). Sem o observer, ou com
// "reduzir movimento", aparece direto.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "@/lib/motion";

export function Reveal({ children, className, delay = 0, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "li" | "section" }) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined" || prefersReducedMotion());
  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    // O que já está na tela aparece de imediato (sem esperar o observer), e nada fica invisível por mais de 2,5 s.
    if (el.getBoundingClientRect().top < window.innerHeight * 1.1) {
      setShown(true);
      return;
    }
    const safety = window.setTimeout(() => setShown(true), 2500);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(safety);
    };
  }, [shown]);
  const style: CSSProperties | undefined = delay ? { transitionDelay: `${delay}ms` } : undefined;
  // deno-lint-ignore no-explicit-any
  const Component = Tag as any;
  return (
    <Component ref={ref} className={cn("reveal", shown && "reveal-in", className)} style={style}>
      {children}
    </Component>
  );
}
