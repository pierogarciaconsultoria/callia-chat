export type PhaseStatus = "pending" | "in_progress" | "completed" | "next";

export type ProjectPhase = {
  id: string;
  order: number;
  title: string;
  status: PhaseStatus;
  goal: string;
  scope: string[];
  deliverables: string[];
  dependsOn: string;
};

export const projectPhases: ProjectPhase[] = [
  {
    id: "phase-0",
    order: 0,
    title: "Fundacao tecnica",
    status: "completed",
    goal: "Endurecer a base do produto antes das funcionalidades operacionais.",
    scope: [
      "Revisar schema multi-tenant",
      "Proteger segredos da Evolution no backend",
      "Adicionar branding e custom_domain",
      "Ajustar idempotencia e rastreio de eventos",
      "Definir instancia padrao por workspace",
    ],
    deliverables: [
      "Migracoes complementares do banco",
      "Contratos tecnicos internos do MVP",
      "Base pronta para multiplas instancias",
    ],
    dependsOn: "Nenhuma",
  },
  {
    id: "phase-1",
    order: 1,
    title: "Estrutura do backend e adapters",
    status: "completed",
    goal: "Montar a ossatura do runtime e dos provedores externos.",
    scope: [
      "Criar adapters de WhatsApp, IA, audio e visao",
      "Padronizar validacao com Zod",
      "Estruturar auth por x-api-key",
      "Definir logs, erros e correlation_id",
    ],
    deliverables: [
      "Camada base de integracoes",
      "Helpers de auth e observabilidade",
      "Estrutura inicial de edge functions",
    ],
    dependsOn: "Fase 0",
  },
  {
    id: "phase-2",
    order: 2,
    title: "Painel do agente e configuracao do workspace",
    status: "completed",
    goal: "Permitir configurar o workspace e o comportamento do agente pela interface.",
    scope: [
      "Tela /agent",
      "CRUD de FAQ e produtos",
      "Configuracao de prompt, voz, handoff e horarios",
      "Website, branding e dominio customizado",
    ],
    deliverables: [
      "Interface funcional de configuracao",
      "Persistencia de dados reais no banco",
      "Branding basico refletido no app shell",
    ],
    dependsOn: "Fase 1",
  },
  {
    id: "phase-3",
    order: 3,
    title: "Conexao WhatsApp e gestao de instancias",
    status: "completed",
    goal: "Conectar o workspace ao canal WhatsApp com multiplas instancias.",
    scope: [
      "Tela /whatsapp",
      "Cadastro e gestao de multiplas instancias",
      "Instancia padrao por workspace",
      "QR code, status e reconexao",
    ],
    deliverables: [
      "Fluxo de conexao funcional",
      "Status por instancia",
      "Filtro operacional para o inbox",
    ],
    dependsOn: "Fase 1",
  },
  {
    id: "phase-4",
    order: 4,
    title: "Entrada de mensagens e webhook inbound",
    status: "completed",
    goal: "Receber mensagens com seguranca, consistencia e idempotencia.",
    scope: [
      "Webhook inbound da Evolution",
      "Validacao de token e instancia",
      "Normalizacao do payload",
      "Criacao e atualizacao de conversas e mensagens",
    ],
    deliverables: [
      "Pipeline de entrada persistindo dados corretamente",
      "Registro de eventos inbound",
      "Associacao correta entre workspace, instancia e conversa",
    ],
    dependsOn: "Fase 3",
  },
  {
    id: "phase-5",
    order: 5,
    title: "Pipeline de IA",
    status: "completed",
    goal: "Construir o cerebro do atendimento automatico.",
    scope: [
      "Texto, audio e imagem",
      "Contexto com historico, FAQ, produtos e site sincronizado",
      "Guardrails de escopo",
      "Handoff automatico por regras",
    ],
    deliverables: [
      "Edge function process-message",
      "Sync manual de site",
      "Resposta automatica com fallback",
    ],
    dependsOn: "Fases 2 e 4",
  },
  {
    id: "phase-6",
    order: 6,
    title: "Inbox, realtime e atendimento humano",
    status: "completed",
    goal: "Entregar a ferramenta operacional do time humano.",
    scope: [
      "Tela /inbox",
      "Lista de conversas por workspace",
      "Filtro por instancia",
      "Assumir conversa, devolver ao bot e envio manual",
    ],
    deliverables: [
      "Inbox funcional ponta a ponta",
      "Transicao entre modo bot e humano",
      "Visualizacao por workspace com filtro operacional",
    ],
    dependsOn: "Fase 4",
  },
  {
    id: "phase-7",
    order: 7,
    title: "API publica e chaves",
    status: "completed",
    goal: "Abrir o hub para integracao com sistemas externos.",
    scope: [
      "Tela /api-keys",
      "Geracao, rotacao e revogacao de chaves",
      "POST /api/messages e POST /api/events",
      "Leitura de conversas e mensagens",
    ],
    deliverables: [
      "API autenticada por x-api-key",
      "Envio proativo funcional",
      "Fallback para instancia padrao quando instance_id nao vier",
    ],
    dependsOn: "Fases 1 e 3",
  },
  {
    id: "phase-8",
    order: 8,
    title: "Webhooks de saida, logs e auditoria",
    status: "completed",
    goal: "Fechar o ciclo de integracao e governanca.",
    scope: [
      "Tela /webhooks",
      "CRUD de webhooks",
      "Assinatura HMAC e retries",
      "Tela /logs",
    ],
    deliverables: [
      "Dispatcher de webhooks",
      "Rastreio de entregas e falhas",
      "Auditoria operacional no painel",
    ],
    dependsOn: "Fase 7",
  },
  {
    id: "phase-9",
    order: 9,
    title: "Acabamento, testes e go-live",
    status: "completed",
    goal: "Estabilizar o MVP para piloto real.",
    scope: [
      "Testes de RLS e do fluxo principal",
      "Hardening de permissoes e segredos",
      "Documentacao tecnica e operacional",
      "Checklist de deploy e onboarding",
    ],
    deliverables: [
      "MVP validado para piloto",
      "Documentacao minima de operacao",
      "Checklist de producao",
    ],
    dependsOn: "Fases 2 a 8",
  },
];

export const statusMeta: Record<
  PhaseStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pendente",
    className: "border-slate-300 bg-slate-100 text-slate-700",
  },
  in_progress: {
    label: "Em andamento",
    className: "border-blue-300 bg-blue-100 text-blue-700",
  },
  completed: {
    label: "Concluida",
    className: "border-emerald-300 bg-emerald-100 text-emerald-700",
  },
  next: {
    label: "Proxima",
    className: "border-amber-300 bg-amber-100 text-amber-800",
  },
};
