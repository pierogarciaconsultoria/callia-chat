-- A migration da devolução automática criou agent_configs.auto_return_minutes sem conceder UPDATE da coluna ao
-- painel. Como a tela do agente salva todas as colunas de uma vez, qualquer "Salvar" (persona, regras, horário)
-- falhava com "permission denied for table agent_configs" para dono e admin. O admin edita a coluna; a RLS continua
-- restringindo ao próprio workspace.
grant update (auto_return_minutes) on public.agent_configs to authenticated;
