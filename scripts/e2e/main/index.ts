// Router mínimo do edge-runtime para o teste ponta a ponta (sem verificação de JWT, como NO_VERIFY_JWT).
Deno.serve(async (req: Request) => {
  const name = new URL(req.url).pathname.split("/")[1];
  if (!name) return new Response(JSON.stringify({ msg: "missing function name" }), { status: 400 });
  const envVars = Object.entries(Deno.env.toObject());
  try {
    // deno-lint-ignore no-explicit-any
    const worker = await (globalThis as any).EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${name}`,
      memoryLimitMb: 256,
      workerTimeoutMs: 120_000,
      noModuleCache: false,
      envVars,
    });
    return await worker.fetch(req);
  } catch (e) {
    return new Response(JSON.stringify({ msg: String(e) }), { status: 500 });
  }
});
