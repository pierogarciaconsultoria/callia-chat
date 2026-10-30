# Contratos das Edge Functions (painel ↔ backend)

Todas as functions de painel recebem `POST` com JSON e o JWT do usuário (`supabase.functions.invoke(nome, { body })`).
O `workspace_id` informado é sempre revalidado contra `workspace_members` do usuário.

Resposta de sucesso: `200 { ...dados }`.
Resposta de erro: `{ "error": { "code": "forbidden", "message": "...", "details": {} }, "correlation_id": "..." }` com status HTTP correspondente
(`400 invalid_request`, `401 unauthorized`, `403 forbidden`, `404 not_found`, `409 conflict`, `422 unprocessable`, `502 upstream_unavailable`, `500 internal_error`).

Papéis: **admin** = `owner` ou `admin`; **membro** = qualquer papel.

## evolution-connect (admin)

| action | body extra | resposta |
|---|---|---|
| `create` | `workspace_id`, `name`, `make_default?` | `{ instance, qr_code }` |
| `connect` | `instance_id` | `{ instance, qr_code, pairing_code }` |
| `refresh` | `instance_id` | `{ instance }` (sincroniza estado com a Evolution) |
| `disconnect` | `instance_id` | `{ instance }` |
| `delete` | `instance_id` | `{ deleted: true }` |
| `set_default` | `instance_id` | `{ instance }` |
| `rotate_token` | `instance_id` | `{ instance }` (gera novo token e reconfigura o webhook) |

`instance` = linha de `whatsapp_instances` sem colunas sensíveis. `qr_code` é data URL (`data:image/png;base64,...`).
Enquanto `status` for `qr` ou `connecting`, o painel faz polling com `refresh` (o QR também é atualizado pelo webhook).

## send-message (membro)

Destino: `conversation_id` **ou** `workspace_id` + `to_phone` (+ `contact_name?`, `instance_id?`); pelo número, reaproveita a
conversa existente ou cria uma nova, que fica em modo humano com quem enviou. Conteúdo, um de:

| modo | body | efeito |
|---|---|---|
| texto | `text` | mensagem de texto |
| anexo | `media_path` (`<workspace>/outbound/<arquivo>` no bucket `inbox-media`, gravado pelo painel), `file_name?`, `mimetype?`, `type?`, `text?` (legenda) | imagem, vídeo, áudio ou documento; o provedor baixa por URL assinada (15 min) e `metadata.media_path` fica na mensagem |
| encaminhar | `forward_message_id`, `text?` | reenvia texto ou arquivo guardado de outra mensagem do workspace (`metadata.forwarded_from`) |
| fotos da galeria | `media_asset_ids[]` (até 5, `media_assets` do workspace), `text?` (legenda da primeira) | uma mensagem `image` por foto, na ordem pedida, pela URL pública do bucket `media`; `metadata.media_asset_id` e `album` em cada uma |

Resposta: `{ message, messages, outbound, conversation_id, created }` (`messages` traz todas as geradas; `message` é a
primeira). Grava `sender = agent` e `agent_user_id`. Responder assume a conversa: sai do modo bot e, se ela não tinha operador
(transferida pelo bot ou respondida pelo celular), quem respondeu vira o `assigned_user_id`; conversa de outro operador não
muda de dono (isso é o "Assumir mesmo assim" da inbox, RPC `claim_conversation`). Conversas com
`channel != 'whatsapp'` retornam `422 channel_not_supported`. Áudio não aceita legenda: o texto vai como segunda mensagem.

## process-message

- Chamada interna (header `x-callia-internal`): `{ message_id }` → executa o pipeline.
- Simulador do painel (admin): `{ action: "simulate", workspace_id, messages: [{ role: "customer" | "bot", text }] }`
  → `{ reply, handoff, engine, knowledge: [{ source_title, content, score }], tool_calls: [{ name, arguments, result }] }`.
  Não envia nada e não grava mensagens.

## manage-api-keys (admin)

| action | body extra | resposta |
|---|---|---|
| `create` | `workspace_id`, `name`, `expires_at?` (ISO) | `{ api_key, raw_key }` |
| `rotate` | `key_id` | `{ api_key, raw_key }` (revoga a antiga e cria nova com o mesmo nome) |
| `revoke` | `key_id` | `{ api_key }` |

`raw_key` aparece só nesta resposta. Formato: `ck_live_<32 caracteres>`.

## manage-webhooks (admin)

| action | body extra | resposta |
|---|---|---|
| `create` | `workspace_id`, `name`, `url`, `events[]`, `max_attempts?` | `{ webhook, secret }` |
| `update` | `webhook_id`, `name?`, `url?`, `events?`, `active?`, `max_attempts?` | `{ webhook }` |
| `rotate_secret` | `webhook_id` | `{ webhook, secret }` |
| `delete` | `webhook_id` | `{ deleted: true }` |
| `test` | `webhook_id` | `{ delivery }` (envia evento `webhook.test`) |
| `retry` | `delivery_id` | `{ delivery }` |

Eventos válidos: `message.received`, `message.sent`, `conversation.handoff`, `public_api.event.received`.

## team (admin)

| action | body extra | resposta |
|---|---|---|
| `invite` | `workspace_id`, `email`, `role` (`agent`/`admin`/`owner`, este só por proprietário), `full_name?` | `{ user_id, invited }` |
| `rename` | `workspace_id`, `user_id` (membro da equipe), `full_name` (2 a 80 caracteres) | `{ ok, full_name }` — grava `raw_user_meta_data.full_name` (auditoria `member.renamed`) |

Nome de exibição: `list_workspace_members` devolve `display_name` (metadados `full_name`/`name`, ou null); o painel mostra
o nome e cai no trecho do e-mail antes do `@` quando não há nome (`memberName`). O próprio usuário muda o seu em Equipe
(`auth.updateUser`); o cadastro pede o nome e o convidado informa ao definir a senha. `user_label(uuid)` é o mesmo
rótulo em SQL, usado na mensagem de sistema da transferência.

Se o e-mail já tem usuário, só vincula (`invited: false`). Se não tem, confere plano e status, manda o convite do GoTrue
(link para `/definir-senha`) e vincula em seguida (`invited: true`, auditoria `member.invited`). O vínculo passa pela
RPC `add_workspace_member` como o usuário que pediu, então valem as mesmas regras de papel e limite.

## knowledge-index (admin, exceto `search_preview` = membro)

| action | body extra | resposta |
|---|---|---|
| `create_text` | `workspace_id`, `title`, `content` | `{ source }` |
| `create_url` | `workspace_id`, `url`, `title?` | `{ source }` |
| `create_document` | `workspace_id`, `title`, `storage_path`, `mime_type` | `{ source }` |
| `update_text` | `source_id`, `title`, `content` | `{ source }` — só `kind = text`; reindexa (trechos e embeddings refeitos); fixada: máx. 12 mil caracteres |
| `reindex` | `source_id` | `{ source }` |
| `delete` | `source_id` | `{ deleted: true }` |
| `embed_pending` | `workspace_id` | `{ embedded: n }` |
| `set_pinned` | `source_id`, `pinned: boolean` | `{ source }` — fonte "fixa no agente" (`metadata.pinned`): entra sempre nas instruções da IA (máx. 12 mil caracteres) |
| `search_preview` | `workspace_id`, `query`, `limit?` | `{ mode: "hybrid" \| "keyword", results: [{ chunk_id, source_id, source_title, source_kind, content, score, keyword_rank, similarity }] }` |

Documentos: o painel envia o arquivo ao bucket privado `knowledge` em `<workspace_id>/<uuid>-<nome>` e depois chama `create_document`.
Tipos aceitos: PDF, DOCX, TXT, MD.

## manage-connectors (admin)

| action | body extra | resposta |
|---|---|---|
| `test_hbook` | `workspace_id`, `checkin` (DD/MM/AAAA), `checkout`, `adults?`, `children_ages?` (idade de cada criança) | sempre `422 unprocessable` com `details.booking_link` (o hbook não permite consulta automática; o Callia não acessa o motor) |

A configuração (`workspace_connectors`) é gravada direto pelo painel via RLS:
`{ kind: "hbook", enabled, config: { base_url, company_id, booking_link, currency, default_adults } }`.

## learnings — Aprendizados do atendimento (admin; tenant ativo e IA no plano)

Sem sessão e com `x-callia-internal` (pg_cron, diário): analisa toda empresa com agente ligado e mensagem de cliente desde a
última análise concluída (RPC `learning_due_workspaces`), até 110 s por rodada (o resto fica para a próxima). Com sessão:

| action | body extra | resposta |
|---|---|---|
| `run` | `workspace_id` | `{ run_id, conversations_analyzed, suggestions_created }` — analisa desde a última análise (primeira vez: 7 dias; teto 30); `429 rate_limited` se houve análise há menos de 30 min |
| `apply` | `workspace_id`, `suggestion_id`, `payload?` (edições do admin: faq `{ question, answer }`, policy `{ topic, title, content }`, guardrail `{ text }`) | `{ status: "applied", kind, applied }` — grava em `faqs`, `workspace_policies` (nova ou a `id` da sugestão) ou acrescenta item em `agent_configs.guardrails`; faq sem resposta → `422` |
| `dismiss` | `workspace_id`, `suggestion_id` | `{ status: "dismissed" }` — não volta por 60 dias |

`learning_suggestions` (leitura por admin via RLS): `kind` faq/policy/guardrail, `title`, `rationale`, `payload`,
`evidence[] = { conversation_id, contact, excerpts[] = { who: cliente|ia|equipe, text } }`, `occurrences`, `status`
pending/applied/dismissed, `applied_payload`. `learning_runs`: período, `status`, `conversations_analyzed`,
`suggestions_created`, `error`. Limites da análise: 40 conversas, 30 mensagens cada, ~90 mil caracteres.

## Tabelas lidas direto pelo painel (RLS)

`workspaces`, `workspace_branding`, `workspace_connectors`, `agent_configs`, `whatsapp_instances`, `conversations`, `messages`,
`faqs`, `products`, `knowledge_sources`, `api_keys`, `webhooks`, `webhook_deliveries`, `public_api_requests`, `outbound_messages`,
`agent_runs`, `inbound_events`, `audit_logs`.

Escritas diretas permitidas: `agent_configs` (update), `workspace_branding`, `workspace_connectors`, `faqs`, `products`,
`conversations` (só `mode`, `unread_count`, `assigned_user_id`, `handoff_at`), `workspaces.name`.

RPCs: `create_workspace(p_name)`, `list_workspace_members(p_workspace_id)`, `add_workspace_member(p_workspace_id, p_email, p_role)`,
`remove_workspace_member(p_workspace_id, p_user_id)`, `knowledge_search(...)`.

## Camada SaaS: direitos do tenant

`rpc get_workspace_entitlements(p_workspace_id)` (membro do workspace ou admin da plataforma) →

```json
{ "workspace_id": "…", "status": "trial|active|suspended|canceled", "effective_status": "trial|active|suspended|canceled|trial_expired",
  "active": true, "trial_ends_at": "…|null", "suspended_reason": "…|null",
  "plan": { "id": "…", "code": "trial", "name": "Avaliação" } | null,
  "limits": { "max_instances": 1, "max_members": 3, "max_monthly_messages": 500, "max_knowledge_sources": 20,
              "ai_enabled": true, "external_agent_enabled": true, "connectors_enabled": true },
  "usage": { "period_start": "…", "monthly_messages": 0, "monthly_inbound": 0, "monthly_ai_runs": 0, "monthly_ai_tokens": 0,
             "instances": 0, "members": 1, "knowledge_sources": 0 } }
```

Limite `null` = ilimitado. `plan: null` = sem plano (ilimitado). Cota mensal conta só envios automáticos (bot e API); respostas da equipe não contam.

Novos códigos de erro das functions: `tenant_inactive` (403, tenant suspenso/cancelado/trial vencido), `plan_limit_reached` (403, ex.: instâncias, fontes),
`feature_not_in_plan` (403, ex.: IA, agente externo, conectores), `quota_exceeded` (429, cota mensal de mensagens).
RPCs SQL: `add_workspace_member` pode falhar com `member_limit_reached` ou `tenant_inactive`; `create_workspace` com `self_service_disabled`.

Tenant suspenso: continua recebendo e guardando mensagens; bot, envios, API pública e criação de recursos param.

## platform-admin (somente admin da plataforma: `user_roles.role = 'platform_admin'`)

`rpc is_platform_admin()` → boolean (usado pelo painel para mostrar o console).

| action | body extra | resposta |
|---|---|---|
| `overview` | — | `{ totals: { tenants, active, trial, suspended, canceled, trial_expired, users, instances_open, monthly_messages, monthly_ai_runs, monthly_ai_tokens }, attention: [{ workspace_id, workspace_name, kind: "instance_down"\|"quota_near"\|"quota_exceeded"\|"trial_ending"\|"trial_expired"\|"agent_failures"\|"webhook_failures", detail }] }` |
| `list_tenants` | — | `{ tenants: [{ id, name, slug, status, effective_status, plan_id, plan_code, plan_name, trial_ends_at, suspended_reason, limit_overrides, notes, created_at, owner_email, instances_open, last_message_at, usage }] }` |
| `get_tenant` | `workspace_id` | `{ tenant (linha de list_tenants), entitlements, members: [{ user_id, email, role, is_support, created_at }], instances: [{ id, name, status, phone_number, is_default }], counts: { api_keys, webhooks, conversations }, audit: [audit_logs (50)] }` |
| `create_tenant` | `name`, `owner_email`, `plan_id?`, `status: "trial"\|"active"`, `trial_days?` | `{ workspace_id, owner_invited: boolean }` (dono inexistente recebe convite por e-mail) |
| `update_tenant` | `workspace_id`, `name?`, `plan_id?` (null = sem plano), `limit_overrides?` (objeto), `notes?`, `trial_ends_at?` | `{ tenant }` |
| `set_status` | `workspace_id`, `status`, `reason?` (obrigatório para suspended/canceled) | `{ tenant }` |
| `support_access` | `workspace_id`, `enable: boolean` | `{ ok: true }` (entra/sai do tenant como admin de suporte, auditado) |
| `list_plans` | — | `{ plans: [linhas de plans] }` |
| `upsert_plan` | `plan: { id?, code, name, description?, price_cents?, currency?, max_instances?, max_members?, max_monthly_messages?, max_knowledge_sources?, ai_enabled, external_agent_enabled, connectors_enabled, active, position? }` | `{ plan }` |
| `list_users` | `search?` | `{ users: [{ id, email, created_at, last_sign_in_at, invited_at, confirmed: boolean, blocked: boolean, platform_admin: boolean, workspaces: [{ id, name, role, is_support }] }] }` |
| `invite_user` | `email` | `{ user_id }` |
| `set_platform_admin` | `user_id`, `enabled` | `{ ok: true }` (não remove o último admin) |
| `set_user_blocked` | `user_id`, `blocked` | `{ ok: true }` (não bloqueia a si mesmo) |
| `audit` | `workspace_id?`, `action_prefix?`, `limit?` (≤ 500) | `{ entries: [{ …audit_logs, workspace_name, actor_email }] }` |
| `get_settings` | — | `{ settings: { allow_self_service_workspaces, self_service_plan_code, trial_days, platform_name, support_email } }` |
| `update_settings` | `settings` (parcial) | `{ settings }` |

## agent-setup — Assistente de configuração (admin; tenant ativo)

Monta persona e instruções a partir das informações que a empresa já publicou. Fontes viram `knowledge_sources`
(o agente também as consulta nas respostas); a IA gera um **rascunho** que o admin revisa e aplica por partes.

| action | body extra | resposta |
|---|---|---|
| `import_site` | `workspace_id`, `url`, `max_pages?` (padrão 20, máx. 40) | `{ source }` — `kind: "site"`, indexação em segundo plano (percorre o domínio, respeita robots.txt) |
| `import_instagram` | `workspace_id`, `profile` (URL ou @perfil), `pasted_text?` | `{ source, fetched: boolean, note: string \| null }` — lê só dados públicos; se nada vier e não houver `pasted_text`, `422 unprocessable` pedindo para colar bio/destaques |
| `generate` | `workspace_id`, `source_ids?` (padrão: todas as fontes indexadas de site/social/url/document/text), `extra_text?` | `{ draft }` (linha de `agent_setup_drafts`); exige IA no plano; leva ~20–60 s |
| `list_drafts` | `workspace_id` | `{ drafts }` (10 mais recentes) |
| `apply` | `draft_id`, `draft` (conteúdo revisado, mesmo formato), `sections` | `{ applied: { profile, guardrails, business_hours, handoff, payment_links, faqs, products } }` |
| `discard` | `draft_id` | `{ ok: true }` |

Documentos e textos usam as ações existentes de `knowledge-index` (`create_document`, `create_text`).

`sections` = `{ profile?: boolean, guardrails?: boolean, business_hours?: boolean, handoff?: boolean, payment_links?: boolean, faqs?: number[], products?: number[] }`
(`faqs`/`products` = índices do rascunho a importar; os demais substituem os campos do agente).

`draft.draft` (conteúdo):

```json
{
  "business": { "name": "", "summary": "", "segment": "", "city": "", "address": null, "phone": null, "whatsapp": null,
                "email": null, "website_url": null, "instagram": null, "tone_observed": "" },
  "agent": { "agent_name": "", "language": "pt-BR", "persona_prompt": "", "guardrails": "" },
  "business_hours": { "timezone": "America/Sao_Paulo", "weekly": { "mon": [["08:00","18:00"]], "tue": [], "...": [] } } | null,
  "handoff": { "keywords": [""], "message": "", "out_of_hours_message": null },
  "payment_links": [{ "label": "", "url": "", "description": null }],
  "faqs": [{ "question": "", "answer": "", "source": "" }],
  "products": [{ "name": "", "description": null, "price": null, "currency": "BRL", "url": null }],
  "missing_information": [{ "topic": "", "question": "" }],
  "sources_used": [{ "title": "", "kind": "" }]
}
```

`missing_information` lista o que não apareceu nas fontes (ex.: política de cancelamento) para o dono completar.
`knowledge_sources.kind` ganhou `site` (metadata `{ max_pages, pages: [{ url, title }] }`) e `social` (metadata `{ network, handle, fetched }`).

## integrations — Integrações simplificadas (admin; tenant ativo para conectar)

Uma tela com cartões por serviço. O cliente informa o mínimo; o Callia descobre o resto, testa e mostra o resultado.
Segredos (senhas) ficam cifrados em `workspace_connectors.secret_ciphertext` (coluna invisível ao painel) e nunca voltam nas respostas.

| action | body extra | resposta |
|---|---|---|
| `list` | `workspace_id` | `{ integrations: Integration[] }` |
| `connect_hospedin` | `workspace_id`, `email`, `password`, `account_id?` | `{ integration, test }` ou `422` com `error.details.needs = "account_id"` quando a conta não puder ser descoberta |
| `test` | `workspace_id`, `kind` (`hospedin` \| `hbook`), `checkin?`, `checkout?`, `adults?`, `children_ages?` | `{ test }` (padrão: próximo fim de semana, 2 adultos) |
| `sync_catalog` | `workspace_id` | `{ created, updated }` — categorias do Hospedin → catálogo (`products`) |
| `set_price_unit` | `workspace_id`, `unit: "reais" \| "cents"` | `{ integration }` (correção se o teste mostrar valores 100× errados) |
| `save_booking_link` | `workspace_id`, `booking_link` (URL) | `{ integration }` — link do motor de reservas (hbook ou outro) |
| `disconnect` | `workspace_id`, `kind` | `{ ok: true }` |

```ts
type Integration = {
  kind: "whatsapp" | "hospedin" | "hbook" | "booking_link";
  status: "connected" | "error" | "disconnected" | "pending";
  title: string;            // "WhatsApp", "Hospedin", "Link de reservas"
  summary: string | null;   // ex.: "(48) 3333-4444 conectado", "Conta morada-do-sol · 6 categorias"
  last_checked_at: string | null;
  last_error: string | null;
  details: Record<string, unknown>; // não sensível: account_id, categories [{id,title,occupants}], price_unit, booking_link, instance_id
};
type AvailabilityTest = {   // mesmo formato da consulta do agente
  provider: "hospedin" | "hbook"; checkin: string; checkout: string; nights: number; adults: number; children_ages: number[];
  currency: string; sold_out: boolean; booking_link: string | null;
  rooms: Array<{ name: string; rate: string | null; total_price: number; price_per_night: number; available_units: number | null; capacity?: number | null }>;
};
```

O status do WhatsApp vem das instâncias (`whatsapp_instances`): `connected` se houver instância `open`.

### evolution-connect — conexão por código (sem QR)

`connect` aceita `phone?` (DDD + número). Com `phone`, a resposta traz `pairing_code` (8 caracteres) para digitar em
WhatsApp → Aparelhos conectados → Conectar com número de telefone. Sem `phone`, continua devolvendo `qr_code`.
`create` também aceita `phone?` e já devolve `pairing_code`.

### Disponibilidade no agente

A ferramenta `consultar_disponibilidade` usa o provedor conectado, nesta ordem: Hospedin → hbook. O link enviado ao hóspede
vem do "Link de reservas" (ou do hbook), preenchido com datas e hóspedes.

## media — Fotos (álbuns por acomodação/área) e envio pelo agente

Álbuns = nome livre (ex.: "Apto Família", "Churrasqueira"), opcionalmente ligados a um produto do catálogo (`product_id`).
Arquivos no bucket **público** `media` em `<workspace_id>/<uuid>.<ext>` (fotos de divulgação; caminhos aleatórios).
Fontes: upload no painel, pasta do Google Drive (subpastas = álbuns) e fotos das categorias do Hospedin.

| action | body extra | resposta |
|---|---|---|
| `list` | `workspace_id` | `{ albums: Album[], assets: MediaAsset[] }` (membro) |
| `register_upload` | `workspace_id`, `storage_path`, `album`, `product_id?`, `caption?` | `{ asset }` — o painel sobe o arquivo antes (JPEG/PNG/WebP ≤ 5 MB; redimensionar no navegador para lado maior ≤ 1600 px) |
| `import_drive` | `workspace_id`, `folder_url` | `{ import }` — em segundo plano; a pasta precisa estar compartilhada como "Qualquer pessoa com o link" |
| `import_hospedin` | `workspace_id` | `{ import }` — fotos de cada categoria do Hospedin conectado |
| `import_status` | `workspace_id` | `{ imports: MediaImport[] }` (5 mais recentes) |
| `update` | `asset_id`, `album?`, `caption?`, `product_id?` (null desvincula), `position?` | `{ asset }` |
| `rename_album` | `workspace_id`, `from`, `to`, `product_id?` | `{ updated }` — renomeia/vincula todas as fotos do álbum |
| `delete` | `asset_id` | `{ deleted: true }` |

```ts
type MediaAsset = { id: string; workspace_id: string; album: string; product_id: string | null; caption: string | null;
  public_url: string; mime_type: string; size_bytes: number | null; source: "upload" | "drive" | "hospedin";
  position: number; created_at: string };
type Album = { name: string; product_id: string | null; count: number; cover_url: string | null };
type MediaImport = { id: string; source: "drive" | "hospedin"; status: "running" | "done" | "failed";
  total: number; imported: number; skipped: number; error: string | null; created_at: string; finished_at: string | null };
```

Agente: a ferramenta `enviar_fotos { album, quantidade? }` (até 5 por vez) só é oferecida quando o workspace tem fotos;
o prompt lista os álbuns disponíveis. As fotos são enviadas logo após a resposta em texto.

## Dados da empresa e pagamento (`workspace_business_info`, leitura/escrita direta pelo painel via RLS de admin)

Colunas: `legal_name`, `cnpj`, `state_registration`, `address`, `phone`, `email`, `bank_name`, `bank_code`, `agency`, `account`,
`account_type` (`corrente` | `poupanca` | `pagamento` | null), `payee_name`, `pix_key_type` (`cnpj` | `cpf` | `telefone` | `email` | `aleatoria` | null),
`pix_key`, `deposit_percent` (0–100, null = a equipe informa o sinal), `payment_instructions`, `share_payment_info` (boolean: o agente só envia
os dados de pagamento quando true). Upsert por `workspace_id` (uma linha por workspace).
Quando `share_payment_info` e `deposit_percent` estão definidos, cada opção de `calcular_valor` traz `sinal` e `sinal_formatado`.

## Tabela de preços estruturada (knowledge-index)

| action | body extra | resposta |
|---|---|---|
| `price_table_get` | `workspace_id` | `{ price_table: { id, name, currency, data, updated_at } \\| null }` (membro) |
| `price_table_save` | `workspace_id`, `name`, `currency?`, `data` | `{ price_table }` — valida e substitui a tabela ativa; `400` com `error.details.issues[{path,message}]` se inválida (admin) |
| `price_quote` | `workspace_id`, `checkin`, `checkout` (DD/MM/AAAA), `adults`, `children_ages?` | `{ quote }` — mesmo cálculo do agente (membro) |

`data` (ver `supabase/functions/_shared/pricing.ts`, `priceTableSchema`):
```ts
{ default_period: string /* id do período usado fora dos intervalos */,
  periods: [{ id: string /* ^[a-z0-9_-]{1,30}$ */, name: string, min_nights?: number | null, ranges: [["AAAA-MM-DD","AAAA-MM-DD"]] /* noites, inclusivas */ }],
  units: [{ name: string, product_ids: string[] /* produtos do catálogo */, max_guests: number,
            rates: [{ guests: number /* vale até N pessoas */, label?: string, max_adults?: number | null, child_max_age?: number | null,
                      prices: { [periodId]: number } }] }],
  notes: string[] }
```
Regras: noite em dois intervalos → vale o período cujo intervalo começa por último; noite fora de todos → `default_period`.
Cada linha de tarifa precisa de preço em todos os períodos usados (preço ausente = acomodação não cotável naquele período).
