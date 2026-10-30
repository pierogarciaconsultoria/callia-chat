// Termos de Uso e Política de Privacidade exibidos em /termos e /privacidade e aceitos no cadastro.
// A versão fica gravada nos metadados do usuário (terms_version) junto com a data do aceite.
export const LEGAL_VERSION = "2026-10-30";
export const LEGAL_COMPANY = {
  name: "TrIAd Solution",
  cnpj: "49.732.652/0001-00",
  email: "contato@triadsolution.com.br",
  product: "Callia Chat",
};

export interface LegalSection {
  title: string;
  paragraphs: string[];
  items?: string[];
}

export interface LegalDocument {
  slug: "termos" | "privacidade";
  title: string;
  intro: string;
  sections: LegalSection[];
}

export const TERMS: LegalDocument = {
  slug: "termos",
  title: "Termos de Uso",
  intro:
    `Estes Termos regulam o uso do ${LEGAL_COMPANY.product}, plataforma de atendimento no WhatsApp com inteligência artificial e equipe humana, ` +
    `oferecida por ${LEGAL_COMPANY.name}, CNPJ ${LEGAL_COMPANY.cnpj} ("nós"). Ao criar uma conta, a empresa contratante ("você" ou "Cliente") declara que leu e aceita estes Termos e a Política de Privacidade.`,
  sections: [
    {
      title: "1. O serviço",
      paragraphs: [
        "O Callia Chat conecta o número de WhatsApp da sua empresa a um agente de inteligência artificial configurado com as informações do seu negócio (produtos, preços, políticas, fotos) e a uma caixa de entrada para a sua equipe assumir conversas quando quiser.",
        "O serviço é oferecido a pessoas jurídicas e profissionais que atuem em nome de uma empresa. Quem cria a conta declara ter poderes para contratar em nome dela e ter ao menos 18 anos.",
      ],
    },
    {
      title: "2. Conta, teste e planos",
      paragraphs: [
        "A conta é criada com e-mail e senha, que são pessoais e intransferíveis. Você responde pelo que for feito com as suas credenciais e deve nos avisar imediatamente se suspeitar de uso indevido.",
        "Novas contas podem receber um período de teste gratuito, com a duração informada na tela de cadastro, sem necessidade de cartão. Ao final do teste, o uso continua mediante a contratação de um plano.",
        "Os planos são cobrados de forma recorrente pelo Mercado Pago, nos valores e limites divulgados na plataforma. Você pode cancelar a qualquer momento; o acesso segue até o fim do período já pago e não há reembolso proporcional. Podemos reajustar os preços com aviso prévio de pelo menos 30 dias.",
        "O não pagamento pode levar à suspensão do serviço e, após 30 dias, ao encerramento da conta.",
      ],
    },
    {
      title: "3. Suas responsabilidades",
      paragraphs: ["Ao usar o serviço, você se compromete a:"],
      items: [
        "usar o WhatsApp de acordo com os Termos de Serviço e as Políticas Comerciais do WhatsApp e da Meta, inclusive quanto a mensagens não solicitadas (spam) e conteúdo proibido;",
        "ter base legal, nos termos da LGPD, para tratar os dados dos seus clientes nas conversas, inclusive para iniciar contato ativo com eles;",
        "manter corretas e atualizadas as informações fornecidas ao agente (preços, políticas, disponibilidade), pois é a partir delas que as respostas são geradas;",
        "não usar o serviço para fins ilícitos, discriminatórios, fraudulentos ou que violem direitos de terceiros;",
        "não tentar acessar dados de outras empresas, contornar limites do plano ou interferir no funcionamento da plataforma.",
      ],
    },
    {
      title: "4. Inteligência artificial",
      paragraphs: [
        "As respostas do agente são geradas por modelos de inteligência artificial a partir das informações que você cadastra. Apesar das salvaguardas da plataforma, respostas podem conter imprecisões. Cabe a você revisar a configuração, testar o agente no simulador e acompanhar as conversas.",
        "O agente não confirma reservas, vendas ou pagamentos por conta própria, não solicita dados de cartão e transfere a conversa para a sua equipe quando configurado para isso. Decisões comerciais e compromissos assumidos com os seus clientes são de sua responsabilidade.",
        "O conteúdo das conversas é enviado ao provedor de IA apenas para gerar a resposta; ele não é usado por nós para treinar modelos.",
      ],
    },
    {
      title: "5. Conexão com o WhatsApp",
      paragraphs: [
        "A conexão do seu número é feita por QR code ou código de pareamento, como um WhatsApp Web. Esse tipo de conexão não é uma integração oficial da Meta. Existe o risco de o número ser limitado ou bloqueado pela Meta, em especial em caso de envio em massa ou denúncias de contatos. Você reconhece esse risco e se compromete a usar o número de forma legítima.",
        "O envio e o recebimento de mensagens dependem do WhatsApp, da conexão do aparelho vinculado e de serviços de terceiros, que não controlamos.",
      ],
    },
    {
      title: "6. Disponibilidade e suporte",
      paragraphs: [
        "Trabalhamos para manter o serviço disponível de forma contínua, mas não garantimos funcionamento ininterrupto. Manutenções programadas são comunicadas com antecedência sempre que possível. O suporte é prestado pelos canais informados na plataforma, em dias úteis.",
      ],
    },
    {
      title: "7. Propriedade intelectual e seus dados",
      paragraphs: [
        "A plataforma, sua marca, código e documentação pertencem a nós. Os dados que você cadastra e as conversas da sua empresa pertencem a você; você nos autoriza a tratá-los apenas para prestar o serviço, conforme a Política de Privacidade.",
        "Ao encerrar a conta, você pode solicitar a exportação dos seus dados em até 30 dias. Depois desse prazo, eles são excluídos, salvo o que a lei exigir que seja mantido.",
      ],
    },
    {
      title: "8. Limitação de responsabilidade",
      paragraphs: [
        "Na extensão permitida pela lei, não respondemos por lucros cessantes, perda de negócios ou danos indiretos decorrentes do uso ou da indisponibilidade do serviço, de respostas geradas pela inteligência artificial ou de restrições impostas pelo WhatsApp. Nossa responsabilidade total fica limitada ao valor pago por você nos 12 meses anteriores ao fato.",
      ],
    },
    {
      title: "9. Suspensão e encerramento",
      paragraphs: [
        "Podemos suspender ou encerrar contas que violem estes Termos, as políticas do WhatsApp ou a lei, ou que coloquem em risco a plataforma e os demais clientes, com aviso quando a situação permitir. Você pode encerrar a conta a qualquer momento pela plataforma ou pelo nosso e-mail.",
      ],
    },
    {
      title: "10. Alterações e lei aplicável",
      paragraphs: [
        "Podemos atualizar estes Termos. Mudanças relevantes são avisadas por e-mail ou na plataforma com pelo menos 15 dias de antecedência; continuar usando o serviço após esse prazo significa concordar com a nova versão. A versão vigente e a data ficam sempre publicadas nesta página.",
        `Estes Termos são regidos pelas leis brasileiras. Dúvidas e solicitações: ${LEGAL_COMPANY.email}.`,
      ],
    },
  ],
};

export const PRIVACY: LegalDocument = {
  slug: "privacidade",
  title: "Política de Privacidade",
  intro:
    `Esta Política explica como ${LEGAL_COMPANY.name}, CNPJ ${LEGAL_COMPANY.cnpj}, trata dados pessoais no ${LEGAL_COMPANY.product}, em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018). ` +
    "Ela vale para quem cria e usa uma conta (a empresa Cliente e sua equipe) e para as pessoas que conversam com as empresas Clientes pelo WhatsApp (os clientes finais).",
  sections: [
    {
      title: "1. Quem é responsável pelos dados",
      paragraphs: [
        "Para os dados de cadastro e de uso da plataforma (conta, equipe, pagamentos), somos a controladora.",
        "Para os dados dos clientes finais que aparecem nas conversas do WhatsApp, a empresa Cliente é a controladora e nós atuamos como operadora: tratamos esses dados somente conforme as instruções do Cliente e para prestar o serviço.",
      ],
    },
    {
      title: "2. Quais dados tratamos",
      paragraphs: ["Dependendo de como o serviço é usado, tratamos:"],
      items: [
        "Conta e equipe: nome da empresa, segmento, site, e-mail, senha (armazenada com hash), telefone, papel na equipe e registros de acesso;",
        "Configuração do agente: textos, políticas, preços, fotos, documentos e integrações cadastradas pelo Cliente;",
        "Conversas: número de WhatsApp, nome de perfil, conteúdo das mensagens, áudios, imagens e arquivos trocados com os clientes finais, além de transcrições e descrições geradas por IA;",
        "Pagamentos: identificação da assinatura e status de cobrança. Os dados do cartão são tratados exclusivamente pelo Mercado Pago e não passam por nós;",
        "Uso técnico: endereço IP, navegador, data e hora de ações relevantes (registros de auditoria) e métricas de uso, para segurança e melhoria do serviço.",
      ],
    },
    {
      title: "3. Para que usamos",
      paragraphs: ["Usamos os dados para:"],
      items: [
        "prestar o serviço contratado: conectar o WhatsApp, gerar respostas com IA, exibir conversas à equipe e enviar mensagens;",
        "cobrar os planos, emitir comunicações sobre a conta e prestar suporte;",
        "garantir a segurança da plataforma, prevenir fraudes e abusos e cumprir obrigações legais;",
        "medir e melhorar o serviço, com dados agregados sempre que possível.",
      ],
    },
    {
      title: "4. Bases legais",
      paragraphs: [
        "Tratamos dados da conta e de pagamento para executar o contrato e cumprir obrigações legais. Dados de segurança e de melhoria do serviço são tratados com base no nosso legítimo interesse, sempre respeitando os seus direitos. Os dados dos clientes finais são tratados em nome do Cliente, que é responsável por ter uma base legal adequada para a comunicação com eles.",
      ],
    },
    {
      title: "5. Com quem compartilhamos",
      paragraphs: ["Compartilhamos dados apenas com quem precisa deles para o serviço funcionar:"],
      items: [
        "provedor de inteligência artificial, que recebe o conteúdo necessário para gerar cada resposta (texto da conversa, informações do negócio, áudios para transcrição e imagens para descrição). Esse provedor pode estar fora do Brasil, o que configura transferência internacional feita com as garantias previstas na LGPD;",
        "WhatsApp e Meta, por meio da conexão do número da empresa, para entregar e receber mensagens;",
        "Mercado Pago, para processar as assinaturas;",
        "sistemas que o Cliente escolher integrar, como o sistema de reservas ou de gestão do próprio Cliente;",
        "provedores de infraestrutura e e-mail transacional, sob obrigações de confidencialidade;",
        "autoridades, quando houver obrigação legal ou ordem judicial.",
      ],
    },
    {
      title: "6. Por quanto tempo guardamos",
      paragraphs: [
        "Os dados ficam armazenados enquanto a conta estiver ativa. Após o encerramento, o Cliente pode pedir a exportação em até 30 dias; depois disso os dados são excluídos, exceto registros que a lei exija manter (como dados fiscais e de auditoria), guardados somente pelo prazo legal.",
        "Mantemos cópias de segurança criptografadas por prazo limitado, para recuperação em caso de falha; elas seguem os mesmos controles de acesso.",
      ],
    },
    {
      title: "7. Como protegemos",
      paragraphs: [
        "Usamos criptografia em trânsito (HTTPS), senhas com hash, isolamento dos dados de cada empresa no banco, credenciais de integrações criptografadas, registros de auditoria e controle de acesso por papel na equipe. Nenhum sistema é totalmente imune a incidentes; se ocorrer um que possa causar risco relevante, avisaremos os Clientes afetados e a ANPD conforme a lei.",
      ],
    },
    {
      title: "8. Seus direitos",
      paragraphs: [
        "Como titular, você pode pedir confirmação de tratamento, acesso, correção, anonimização, portabilidade, exclusão, informação sobre compartilhamentos e revogação de consentimento, nos termos do artigo 18 da LGPD.",
        `Pedidos de membros da equipe ou de Clientes podem ser feitos pela plataforma ou pelo e-mail ${LEGAL_COMPANY.email}. Clientes finais devem procurar a empresa com quem conversaram (a controladora); se o pedido chegar a nós, encaminharemos a ela e ajudaremos no atendimento.`,
      ],
    },
    {
      title: "9. Cookies e armazenamento local",
      paragraphs: [
        "A plataforma usa o armazenamento local do navegador apenas para manter a sessão de login e preferências de uso. Não usamos cookies de publicidade nem rastreamento entre sites.",
      ],
    },
    {
      title: "10. Encarregado e contato",
      paragraphs: [
        `O encarregado pelo tratamento de dados pessoais pode ser contatado em ${LEGAL_COMPANY.email}. Esta Política pode ser atualizada; a versão vigente e a data ficam publicadas nesta página, e mudanças relevantes são comunicadas aos Clientes.`,
      ],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalDocument["slug"], LegalDocument> = { termos: TERMS, privacidade: PRIVACY };
