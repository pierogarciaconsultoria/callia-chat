// Aceite dos Termos de Uso e da Política de Privacidade (definir senha de convidado).
import { Link } from "react-router-dom";

export function TermsCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand" />
      <span>
        Li e aceito os <Link to="/termos" target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">Termos de Uso</Link> e a{" "}
        <Link to="/privacidade" target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">Política de Privacidade</Link>.
      </span>
    </label>
  );
}
