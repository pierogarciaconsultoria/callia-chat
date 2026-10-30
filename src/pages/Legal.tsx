// Páginas públicas /termos e /privacidade. O conteúdo fica em src/lib/legal.ts.
import { Link } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { LEGAL_COMPANY, LEGAL_DOCUMENTS, LEGAL_VERSION, type LegalDocument } from "@/lib/legal";

export default function Legal({ document: slug }: { document: LegalDocument["slug"] }) {
  const doc = LEGAL_DOCUMENTS[slug];
  const other = slug === "termos" ? LEGAL_DOCUMENTS.privacidade : LEGAL_DOCUMENTS.termos;
  const updated = new Date(`${LEGAL_VERSION}T12:00:00`).toLocaleDateString("pt-BR");
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <article className="mx-auto max-w-3xl">
        <Link to="/" className="mb-6 flex items-center gap-2 text-sm font-medium text-slate-600 hover:underline dark:text-slate-300">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-brand-fg"><MessageCircle className="h-4 w-4" /></span>
          {LEGAL_COMPANY.product}
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{doc.title}</h1>
        <p className="mt-1 text-sm text-slate-500">Versão {LEGAL_VERSION}, atualizada em {updated}.</p>
        <p className="mt-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{doc.intro}</p>
        {doc.sections.map((s) => (
          <section key={s.title} className="mt-8">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{s.title}</h2>
            {s.paragraphs.map((p, i) => (
              <p key={i} className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{p}</p>
            ))}
            {s.items && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {s.items.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            )}
          </section>
        ))}
        <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800">
          <p>{LEGAL_COMPANY.name} · CNPJ {LEGAL_COMPANY.cnpj} · <a href={`mailto:${LEGAL_COMPANY.email}`} className="hover:underline">{LEGAL_COMPANY.email}</a></p>
          <p className="mt-2 flex flex-wrap gap-4">
            <Link to={`/${other.slug}`} className="hover:underline">{other.title}</Link>
            <Link to="/" className="hover:underline">Voltar ao site</Link>
          </p>
        </footer>
      </article>
    </div>
  );
}
