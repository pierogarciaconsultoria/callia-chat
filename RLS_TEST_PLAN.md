# Plano de testes de RLS

Automatizado em [supabase/tests/rls_smoke.sql](supabase/tests/rls_smoke.sql) (`npm run test:sql`). Três usuários:
**Ana** (owner do workspace A), **Bia** (owner do workspace B) e **Caio** (agent em A).

| # | Cenário | Esperado | Coberto |
|---|---|---|---|
| 1 | Ana lista workspaces | só A | ✔ |
| 2 | Ana lê mensagens de A | vê | ✔ |
| 3 | Bia lê conversas/mensagens de A | 0 linhas | ✔ |
| 4 | Bia busca na base de A via `knowledge_search` | 0 resultados | ✔ |
| 5 | Bia altera `agent_configs` de A | 0 linhas afetadas | ✔ |
| 6 | Caio (agent) vê e assume conversa de A | permitido | ✔ |
| 7 | Caio cria FAQ | negado | ✔ |
| 8 | Caio lê `api_keys` / `audit_logs` | 0 linhas | ✔ |
| 9 | `authenticated` executa `record_message` | negado | ✔ |
| 10 | Leitura de `api_keys.key_hash` | negado (privilégio por coluna) | ✔ |
| 11 | Mensagem com mesmo `external_id` duas vezes | 2ª marcada como duplicada; `unread_count` = 1 | ✔ |
| 12 | Busca "cafe da manha" encontra "café da manhã" | 1 resultado | ✔ |

## Verificação manual antes do go-live
- Upload em `knowledge/<outro-workspace>/arquivo.pdf` deve falhar no painel.
- Pelo painel, `select secret_ciphertext from webhooks` e `select webhook_token_hash from whatsapp_instances` devem falhar com erro de permissão (por isso o painel sempre lista colunas explícitas nessas tabelas e em `api_keys`).
- Realtime: um usuário de B conectado não recebe eventos de conversas de A.
