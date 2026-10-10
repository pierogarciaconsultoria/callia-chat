import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12 text-white">
      <div className="max-w-2xl text-center">
        <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-slate-300">PRUMO</p>
        <h1 className="text-4xl font-bold tracking-tight md:text-6xl">Gestão de obras em um só lugar</h1>
        <p className="mt-6 text-lg text-slate-300">
          A aplicação está inicializada e pronta para receber sua autenticação e configuração.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link to="/login" className="rounded-md bg-white px-5 py-3 font-medium text-slate-950">
            Entrar
          </Link>
          <Link to="/signup" className="rounded-md border border-slate-700 px-5 py-3 font-medium text-white">
            Criar conta
          </Link>
        </div>
      </div>
    </main>
  );
}
