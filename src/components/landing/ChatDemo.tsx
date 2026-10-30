// Conversa de exemplo (ilustrativa) do hero: as mensagens aparecem uma a uma, com "digitando" antes de cada resposta
// do agente, em ciclo. Com "reduzir movimento" (ou em testes) mostra tudo de uma vez. Nada aqui é dado real.
import { useEffect, useState, type ReactNode } from "react";
import { Check, CheckCheck, Mic, ReceiptText, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "@/lib/motion";

interface Step { side: "in" | "out"; text: ReactNode; wait: number }

const STEPS: Step[] = [
  { side: "in", wait: 600, text: "Oi! Tem vaga para 2 adultos e uma criança de 4 anos, de 10 a 15 de janeiro?" },
  { side: "out", wait: 1600, text: <>Olá! Tem sim 😊 Para vocês três, de 10 a 15/01, a opção é o <strong>Apartamento Família</strong>: 5 diárias, total <strong>R$ 3.000,00</strong>. Quer ver as fotos ou tem alguma dúvida?</> },
  { side: "in", wait: 1400, text: <span className="flex items-center gap-2"><Mic className="h-4 w-4 text-slate-500" aria-hidden /> Áudio 0:06 · <em className="text-slate-500">"manda as fotos e o link"</em></span> },
  { side: "out", wait: 1500, text: <>Seguem 4 fotos do Apartamento Família 👇 E aqui está o link para reservar com as suas datas já preenchidas.</> },
  { side: "in", wait: 1500, text: <span className="flex items-center gap-2"><ReceiptText className="h-4 w-4 text-emerald-600" aria-hidden /> comprovante_pix.pdf</span> },
  { side: "out", wait: 1500, text: <>Recebi o seu comprovante, obrigado! Já passei para a equipe conferir, e eles confirmam com você por aqui.</> },
];
const TYPING_MS = 1100;
const HOLD_MS = 5000;

export function ChatDemo() {
  // shown = quantas mensagens já apareceram; typing = o agente está "digitando" a próxima.
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? STEPS.length : 0));
  const [typing, setTyping] = useState(false);
  const animated = shown < STEPS.length || !prefersReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let timer: number;
    const schedule = (fn: () => void, ms: number) => { timer = window.setTimeout(fn, ms); };
    if (shown >= STEPS.length) {
      schedule(() => { setShown(0); setTyping(false); }, HOLD_MS);
      return () => window.clearTimeout(timer);
    }
    const next = STEPS[shown];
    if (next.side === "out") {
      schedule(() => {
        setTyping(true);
        schedule(() => { setTyping(false); setShown((n) => n + 1); }, TYPING_MS);
      }, next.wait);
    } else {
      schedule(() => setShown((n) => n + 1), next.wait);
    }
    return () => window.clearTimeout(timer);
  }, [shown]);

  const done = shown >= STEPS.length;
  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-brand/30 via-brand-accent/20 to-transparent blur-2xl" aria-hidden />
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-brand/10 dark:border-slate-800 dark:bg-slate-900" aria-label="Exemplo de conversa com o agente">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-fg">
            IA
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
              <span className="landing-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400" aria-hidden />
              <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Agente da sua empresa</p>
            <p className="text-xs text-emerald-600">{typing ? "digitando…" : "online · responde em segundos"}</p>
          </div>
          <span className="rounded-full bg-brand-accent/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">Exemplo</span>
        </div>
        <div className="min-h-[380px] space-y-2.5 bg-[radial-gradient(circle_at_top,rgba(15,118,110,0.06),transparent_60%)] p-4">
          {STEPS.slice(0, shown).map((s, i) => (
            <div key={i} className={cn("flex", s.side === "out" ? "justify-end" : "justify-start", animated && "landing-pop")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm", s.side === "out" ? "rounded-br-sm bg-brand text-brand-fg" : "rounded-bl-sm bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100")}>
                {s.text}
                {s.side === "out" && <span className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70"><CheckCheck className="h-3 w-3" aria-hidden /> enviado</span>}
              </div>
            </div>
          ))}
          {typing && (
            <div className="flex justify-end landing-pop" aria-label="Agente digitando">
              <div className="flex items-center gap-1 rounded-2xl rounded-br-sm bg-brand/80 px-3.5 py-2.5">
                <span className="landing-dot h-1.5 w-1.5 rounded-full bg-white" /><span className="landing-dot h-1.5 w-1.5 rounded-full bg-white" /><span className="landing-dot h-1.5 w-1.5 rounded-full bg-white" />
              </div>
            </div>
          )}
          {done && (
            <p className={cn("flex items-center justify-center gap-1.5 pt-2 text-center text-[11px] text-slate-500", animated && "landing-pop")}>
              <Users className="h-3 w-3" aria-hidden /> Transferida para a equipe · aparece na inbox com o comprovante <Check className="h-3 w-3 text-emerald-600" aria-hidden />
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
