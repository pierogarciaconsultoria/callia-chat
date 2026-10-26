-- Link do formulário de pré-reserva do PMS (ex.: Hospedin): no PIX, o hóspede faz a pré-reserva,
-- a equipe confirma a vaga e só então envia os dados para o sinal.
alter table public.workspace_business_info
  add column pre_reservation_url text check (pre_reservation_url is null or pre_reservation_url ~ '^https://[^\s]+$');
