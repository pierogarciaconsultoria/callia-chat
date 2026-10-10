export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      bank_accounts: {
        Row: {
          agencia: string | null
          ativo: boolean
          banco: string | null
          company_id: string
          conta: string | null
          id: string
          legal_entity_id: string | null
          nome: string
        }
        Insert: {
          agencia?: string | null
          ativo?: boolean
          banco?: string | null
          company_id: string
          conta?: string | null
          id?: string
          legal_entity_id?: string | null
          nome: string
        }
        Update: {
          agencia?: string | null
          ativo?: boolean
          banco?: string | null
          company_id?: string
          conta?: string | null
          id?: string
          legal_entity_id?: string | null
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "legal_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      cheques: {
        Row: {
          agencia: string | null
          banco: string | null
          client_id: string | null
          company_id: string
          conta: string | null
          created_at: string
          financial_entry_id: string | null
          id: string
          numero: string | null
          observacao: string | null
          status: string
          valor: number
        }
        Insert: {
          agencia?: string | null
          banco?: string | null
          client_id?: string | null
          company_id: string
          conta?: string | null
          created_at?: string
          financial_entry_id?: string | null
          id?: string
          numero?: string | null
          observacao?: string | null
          status?: string
          valor: number
        }
        Update: {
          agencia?: string | null
          banco?: string | null
          client_id?: string | null
          company_id?: string
          conta?: string | null
          created_at?: string
          financial_entry_id?: string | null
          id?: string
          numero?: string | null
          observacao?: string | null
          status?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "cheques_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cheques_financial_entry_id_fkey"
            columns: ["financial_entry_id"]
            isOneToOne: false
            referencedRelation: "financial_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cheques_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          company_id: string
          created_at: string
          document: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          type: string
        }
        Insert: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          company_id: string
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          type?: string
        }
        Update: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          company_id?: string
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          cnpj: string | null
          created_at: string
          email: string | null
          id: string
          rateio_criterio: string | null
          logo_url: string | null
          name: string
          phone: string | null
        }
        Insert: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          cnpj?: string | null
          created_at?: string
          email?: string | null
          id?: string
          rateio_criterio?: string | null
          logo_url?: string | null
          name?: string
          phone?: string | null
        }
        Update: {
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          cnpj?: string | null
          created_at?: string
          email?: string | null
          id?: string
          rateio_criterio?: string | null
          logo_url?: string | null
          name?: string
          phone?: string | null
        }
        Relationships: []
      }
      contract_installments: {
        Row: {
          company_id: string
          contract_id: string
          created_at: string
          due_date: string
          id: string
          installment_number: number
          paid_at: string | null
          status: string
          value: number
        }
        Insert: {
          company_id: string
          contract_id: string
          created_at?: string
          due_date: string
          id?: string
          installment_number: number
          paid_at?: string | null
          status?: string
          value: number
        }
        Update: {
          company_id?: string
          contract_id?: string
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          paid_at?: string | null
          status?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_installments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_installments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          client_id: string
          comissao_percentual: number | null
          comissao_valor: number | null
          company_id: string
          corretor_id: string | null
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          imobiliaria_id: string | null
          notes: string | null
          start_date: string | null
          status: string
          title: string
          total_value: number | null
        }
        Insert: {
          client_id: string
          comissao_percentual?: number | null
          comissao_valor?: number | null
          company_id: string
          corretor_id?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          imobiliaria_id?: string | null
          notes?: string | null
          start_date?: string | null
          status?: string
          title: string
          total_value?: number | null
        }
        Update: {
          client_id?: string
          comissao_percentual?: number | null
          comissao_valor?: number | null
          company_id?: string
          corretor_id?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          imobiliaria_id?: string | null
          notes?: string | null
          start_date?: string | null
          status?: string
          title?: string
          total_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_imobiliaria_id_fkey"
            columns: ["imobiliaria_id"]
            isOneToOne: false
            referencedRelation: "imobiliarias"
            referencedColumns: ["id"]
          },
        ]
      }
      corretores: {
        Row: {
          ativo: boolean
          company_id: string
          cpf: string | null
          created_at: string
          creci: string
          email: string | null
          id: string
          imobiliaria_id: string | null
          nome: string
          percentual_comissao_padrao: number | null
          telefone: string | null
          tipo: string
        }
        Insert: {
          ativo?: boolean
          company_id: string
          cpf?: string | null
          created_at?: string
          creci: string
          email?: string | null
          id?: string
          imobiliaria_id?: string | null
          nome: string
          percentual_comissao_padrao?: number | null
          telefone?: string | null
          tipo?: string
        }
        Update: {
          ativo?: boolean
          company_id?: string
          cpf?: string | null
          created_at?: string
          creci?: string
          email?: string | null
          id?: string
          imobiliaria_id?: string | null
          nome?: string
          percentual_comissao_padrao?: number | null
          telefone?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "corretores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corretores_imobiliaria_id_fkey"
            columns: ["imobiliaria_id"]
            isOneToOne: false
            referencedRelation: "imobiliarias"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          code: string | null
          company_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          code?: string | null
          company_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          code?: string | null
          company_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_deal_activities: {
        Row: {
          activity_type: string
          attachments: string[] | null
          company_id: string
          created_at: string
          date: string
          deal_id: string
          description: string
          id: string
          owner_id: string | null
          owner_name: string
        }
        Insert: {
          activity_type: string
          attachments?: string[] | null
          company_id: string
          created_at?: string
          date: string
          deal_id: string
          description: string
          id?: string
          owner_id?: string | null
          owner_name: string
        }
        Update: {
          activity_type?: string
          attachments?: string[] | null
          company_id?: string
          created_at?: string
          date?: string
          deal_id?: string
          description?: string
          id?: string
          owner_id?: string | null
          owner_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_deal_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deal_activities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_deals: {
        Row: {
          briefing_budget_range: string | null
          briefing_constraints: string | null
          briefing_deadline: string | null
          briefing_objective: string | null
          briefing_scope: string | null
          category: string | null
          client_id: string | null
          company_id: string
          company_name: string
          consultant: string | null
          contract_id: string | null
          corretor_id: string | null
          created_at: string
          development_unit_id: string | null
          email: string | null
          id: string
          imobiliaria_id: string | null
          inventory_asset_id: string | null
          last_activity: string | null
          loss_reason: string | null
          name: string
          origin: string | null
          phone: string | null
          previsao_entrega: string | null
          project_id: string | null
          site_access_notes: string | null
          site_city: string | null
          site_complement: string | null
          site_latitude: number | null
          site_longitude: number | null
          site_neighborhood: string | null
          site_number: string | null
          site_state: string | null
          site_street: string | null
          site_zip: string | null
          stage: string
          status: string | null
          status_label: string | null
          temperature: string | null
          tipo: string
          updated_at: string
          value: number | null
          work_type: string | null
        }
        Insert: {
          briefing_budget_range?: string | null
          briefing_constraints?: string | null
          briefing_deadline?: string | null
          briefing_objective?: string | null
          briefing_scope?: string | null
          category?: string | null
          client_id?: string | null
          company_id: string
          company_name: string
          consultant?: string | null
          contract_id?: string | null
          corretor_id?: string | null
          created_at?: string
          development_unit_id?: string | null
          email?: string | null
          id?: string
          imobiliaria_id?: string | null
          inventory_asset_id?: string | null
          last_activity?: string | null
          loss_reason?: string | null
          name: string
          origin?: string | null
          phone?: string | null
          previsao_entrega?: string | null
          project_id?: string | null
          site_access_notes?: string | null
          site_city?: string | null
          site_complement?: string | null
          site_latitude?: number | null
          site_longitude?: number | null
          site_neighborhood?: string | null
          site_number?: string | null
          site_state?: string | null
          site_street?: string | null
          site_zip?: string | null
          stage: string
          status?: string | null
          status_label?: string | null
          temperature?: string | null
          tipo?: string
          updated_at?: string
          value?: number | null
          work_type?: string | null
        }
        Update: {
          briefing_budget_range?: string | null
          briefing_constraints?: string | null
          briefing_deadline?: string | null
          briefing_objective?: string | null
          briefing_scope?: string | null
          category?: string | null
          client_id?: string | null
          company_id?: string
          company_name?: string
          consultant?: string | null
          contract_id?: string | null
          corretor_id?: string | null
          created_at?: string
          development_unit_id?: string | null
          email?: string | null
          id?: string
          imobiliaria_id?: string | null
          inventory_asset_id?: string | null
          last_activity?: string | null
          loss_reason?: string | null
          name?: string
          origin?: string | null
          phone?: string | null
          previsao_entrega?: string | null
          project_id?: string | null
          site_access_notes?: string | null
          site_city?: string | null
          site_complement?: string | null
          site_latitude?: number | null
          site_longitude?: number | null
          site_neighborhood?: string | null
          site_number?: string | null
          site_state?: string | null
          site_street?: string | null
          site_zip?: string | null
          stage?: string
          status?: string | null
          status_label?: string | null
          temperature?: string | null
          tipo?: string
          updated_at?: string
          value?: number | null
          work_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_development_unit_id_fkey"
            columns: ["development_unit_id"]
            isOneToOne: false
            referencedRelation: "development_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_imobiliaria_id_fkey"
            columns: ["imobiliaria_id"]
            isOneToOne: false
            referencedRelation: "imobiliarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_inventory_asset_id_fkey"
            columns: ["inventory_asset_id"]
            isOneToOne: false
            referencedRelation: "inventory_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      development_units: {
        Row: {
          andar: number | null
          banheiros: number | null
          company_id: string
          created_at: string
          disponivel_venda: boolean | null
          id: string
          metragem: number | null
          numero_unidade: string | null
          orientacao: string | null
          project_id: string
          quartos: number | null
          status: string
          tipo_unidade_id: string | null
          vagas: number | null
          valor_venda: number | null
        }
        Insert: {
          andar?: number | null
          banheiros?: number | null
          company_id: string
          created_at?: string
          disponivel_venda?: boolean | null
          id?: string
          metragem?: number | null
          numero_unidade?: string | null
          orientacao?: string | null
          project_id: string
          quartos?: number | null
          status?: string
          tipo_unidade_id?: string | null
          vagas?: number | null
          valor_venda?: number | null
        }
        Update: {
          andar?: number | null
          banheiros?: number | null
          company_id?: string
          created_at?: string
          disponivel_venda?: boolean | null
          id?: string
          metragem?: number | null
          numero_unidade?: string | null
          orientacao?: string | null
          project_id?: string
          quartos?: number | null
          status?: string
          tipo_unidade_id?: string | null
          vagas?: number | null
          valor_venda?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "development_units_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "development_units_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "development_units_tipo_unidade_id_fkey"
            columns: ["tipo_unidade_id"]
            isOneToOne: false
            referencedRelation: "unit_types"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_allocations: {
        Row: {
          company_id: string
          criterio_aplicado: Json
          financial_entry_id: string
          id: string
          percentual: number
          project_id: string
          valor_alocado: number
        }
        Insert: {
          company_id: string
          criterio_aplicado: Json
          financial_entry_id: string
          id?: string
          percentual: number
          project_id: string
          valor_alocado: number
        }
        Update: {
          company_id?: string
          criterio_aplicado?: Json
          financial_entry_id?: string
          id?: string
          percentual?: number
          project_id?: string
          valor_alocado?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_allocations_financial_entry_id_fkey"
            columns: ["financial_entry_id"]
            isOneToOne: false
            referencedRelation: "financial_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_allocations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_categories: {
        Row: {
          company_id: string
          created_at: string
          id: string
          name: string
          type: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          name: string
          type?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_entries: {
        Row: {
          cr_vinculado_id: string | null
          conta_bancaria_id: string | null
          data_competencia: string | null
          desconto: number | null
          juros: number | null
          legal_entity_id: string | null
          numero_documento: string | null
          pago_por: string | null
          recorrencia: string | null
          recorrencia_parcela: number | null
          recorrencia_serie_id: string | null
          subcategoria_id: string | null
          valor_pago: number | null
          category_id: string | null
          client_id: string | null
          company_id: string
          contract_id: string | null
          corretor_id: string | null
          cost_center_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          entry_type: string
          id: string
          custo_fixo: boolean
          imobiliaria_id: string | null
          payment_date: string | null
          payment_method: string | null
          project_id: string | null
          stage_id: string | null
          status: string
          supplier_id: string | null
          value: number
        }
        Insert: {
          cr_vinculado_id?: string | null
          conta_bancaria_id?: string | null
          data_competencia?: string | null
          desconto?: number | null
          juros?: number | null
          legal_entity_id?: string | null
          numero_documento?: string | null
          pago_por?: string | null
          recorrencia?: string | null
          recorrencia_parcela?: number | null
          recorrencia_serie_id?: string | null
          subcategoria_id?: string | null
          valor_pago?: number | null
          category_id?: string | null
          client_id?: string | null
          company_id: string
          contract_id?: string | null
          corretor_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          entry_type: string
          id?: string
          custo_fixo?: boolean
          imobiliaria_id?: string | null
          payment_date?: string | null
          payment_method?: string | null
          project_id?: string | null
          stage_id?: string | null
          status?: string
          supplier_id?: string | null
          value: number
        }
        Update: {
          cr_vinculado_id?: string | null
          conta_bancaria_id?: string | null
          data_competencia?: string | null
          desconto?: number | null
          juros?: number | null
          legal_entity_id?: string | null
          numero_documento?: string | null
          pago_por?: string | null
          recorrencia?: string | null
          recorrencia_parcela?: number | null
          recorrencia_serie_id?: string | null
          subcategoria_id?: string | null
          valor_pago?: number | null
          category_id?: string | null
          client_id?: string | null
          company_id?: string
          contract_id?: string | null
          corretor_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          entry_type?: string
          id?: string
          custo_fixo?: boolean
          imobiliaria_id?: string | null
          payment_date?: string | null
          payment_method?: string | null
          project_id?: string | null
          stage_id?: string | null
          status?: string
          supplier_id?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "financial_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "financial_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_imobiliaria_id_fkey"
            columns: ["imobiliaria_id"]
            isOneToOne: false
            referencedRelation: "imobiliarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "project_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_entry_installments: {
        Row: {
          company_id: string
          data_pagamento: string | null
          data_vencimento: string
          financial_entry_id: string
          id: string
          numero: number
          status: string
          valor: number
        }
        Insert: {
          company_id: string
          data_pagamento?: string | null
          data_vencimento: string
          financial_entry_id: string
          id?: string
          numero: number
          status?: string
          valor: number
        }
        Update: {
          company_id?: string
          data_pagamento?: string | null
          data_vencimento?: string
          financial_entry_id?: string
          id?: string
          numero?: number
          status?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "financial_entry_installments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entry_installments_financial_entry_id_fkey"
            columns: ["financial_entry_id"]
            isOneToOne: false
            referencedRelation: "financial_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      imobiliarias: {
        Row: {
          ativo: boolean
          company_id: string
          cnpj: string | null
          created_at: string
          creci_pj: string
          email: string | null
          id: string
          percentual_comissao_padrao: number | null
          razao_social: string
          telefone: string | null
        }
        Insert: {
          ativo?: boolean
          company_id: string
          cnpj?: string | null
          created_at?: string
          creci_pj: string
          email?: string | null
          id?: string
          percentual_comissao_padrao?: number | null
          razao_social: string
          telefone?: string | null
        }
        Update: {
          ativo?: boolean
          company_id?: string
          cnpj?: string | null
          created_at?: string
          creci_pj?: string
          email?: string | null
          id?: string
          percentual_comissao_padrao?: number | null
          razao_social?: string
          telefone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "imobiliarias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_assets: {
        Row: {
          company_id: string
          contract_origem_id: string | null
          created_at: string
          descricao: string
          endereco: string | null
          id: string
          origin: string
          status: string
          tipo: string | null
          transferencia_entrada_data_acordada: string | null
          transferencia_entrada_data_efetiva: string | null
          transferencia_entrada_status: string
          valor_acordado: number | null
          valor_mercado: number | null
          valor_venda: number | null
        }
        Insert: {
          company_id: string
          contract_origem_id?: string | null
          created_at?: string
          descricao: string
          endereco?: string | null
          id?: string
          origin?: string
          status?: string
          tipo?: string | null
          transferencia_entrada_data_acordada?: string | null
          transferencia_entrada_data_efetiva?: string | null
          transferencia_entrada_status?: string
          valor_acordado?: number | null
          valor_mercado?: number | null
          valor_venda?: number | null
        }
        Update: {
          company_id?: string
          contract_origem_id?: string | null
          created_at?: string
          descricao?: string
          endereco?: string | null
          id?: string
          origin?: string
          status?: string
          tipo?: string | null
          transferencia_entrada_data_acordada?: string | null
          transferencia_entrada_data_efetiva?: string | null
          transferencia_entrada_status?: string
          valor_acordado?: number | null
          valor_mercado?: number | null
          valor_venda?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_assets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_assets_contract_origem_id_fkey"
            columns: ["contract_origem_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_entities: {
        Row: {
          ativo: boolean
          cnpj: string | null
          company_id: string
          created_at: string
          id: string
          razao_social: string
          tipo: string | null
        }
        Insert: {
          ativo?: boolean
          cnpj?: string | null
          company_id: string
          created_at?: string
          id?: string
          razao_social: string
          tipo?: string | null
        }
        Update: {
          ativo?: boolean
          cnpj?: string | null
          company_id?: string
          created_at?: string
          id?: string
          razao_social?: string
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_entities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          company_id: string
          financial_entry_id: string
          forma: string
          id: string
          valor: number
        }
        Insert: {
          company_id: string
          financial_entry_id: string
          forma: string
          id?: string
          valor: number
        }
        Update: {
          company_id?: string
          financial_entry_id?: string
          forma?: string
          id?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_methods_financial_entry_id_fkey"
            columns: ["financial_entry_id"]
            isOneToOne: false
            referencedRelation: "financial_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_id: string
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stage_dependencies: {
        Row: {
          company_id: string
          created_at: string
          dependency_type: string
          id: string
          lag_days: number | null
          predecessor_stage_id: string
          project_id: string
          successor_stage_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          dependency_type: string
          id?: string
          lag_days?: number | null
          predecessor_stage_id: string
          project_id: string
          successor_stage_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          dependency_type?: string
          id?: string
          lag_days?: number | null
          predecessor_stage_id?: string
          project_id?: string
          successor_stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_stage_dependencies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stage_dependencies_predecessor_stage_id_fkey"
            columns: ["predecessor_stage_id"]
            isOneToOne: false
            referencedRelation: "project_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stage_dependencies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stage_dependencies_successor_stage_id_fkey"
            columns: ["successor_stage_id"]
            isOneToOne: false
            referencedRelation: "project_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stages: {
        Row: {
          actual_cost: number | null
          actual_duration_days: number | null
          actual_end_date: string | null
          actual_start_date: string | null
          company_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          parent_stage_id: string | null
          planned_cost: number | null
          planned_duration_days: number | null
          planned_end_date: string | null
          planned_start_date: string | null
          progress_percentage: number | null
          project_id: string
          stage_order: number | null
          status: string
        }
        Insert: {
          actual_cost?: number | null
          actual_duration_days?: number | null
          actual_end_date?: string | null
          actual_start_date?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          parent_stage_id?: string | null
          planned_cost?: number | null
          planned_duration_days?: number | null
          planned_end_date?: string | null
          planned_start_date?: string | null
          progress_percentage?: number | null
          project_id: string
          stage_order?: number | null
          status?: string
        }
        Update: {
          actual_cost?: number | null
          actual_duration_days?: number | null
          actual_end_date?: string | null
          actual_start_date?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          parent_stage_id?: string | null
          planned_cost?: number | null
          planned_duration_days?: number | null
          planned_end_date?: string | null
          planned_start_date?: string | null
          progress_percentage?: number | null
          project_id?: string
          stage_order?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_stages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stages_parent_stage_id_fkey"
            columns: ["parent_stage_id"]
            isOneToOne: false
            referencedRelation: "project_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_cost_value: number | null
          actual_end_date: string | null
          actual_start_date: string | null
          budgeted_value: number | null
          client_id: string
          code: string | null
          company_id: string
          contract_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          planned_end_date: string | null
          planned_start_date: string | null
          progress_percentage: number | null
          project_type: string
          status: string
        }
        Insert: {
          actual_cost_value?: number | null
          actual_end_date?: string | null
          actual_start_date?: string | null
          budgeted_value?: number | null
          client_id: string
          code?: string | null
          company_id: string
          contract_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          planned_end_date?: string | null
          planned_start_date?: string | null
          progress_percentage?: number | null
          project_type?: string
          status?: string
        }
        Update: {
          actual_cost_value?: number | null
          actual_end_date?: string | null
          actual_start_date?: string | null
          budgeted_value?: number | null
          client_id?: string
          code?: string | null
          company_id?: string
          contract_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          planned_end_date?: string | null
          planned_start_date?: string | null
          progress_percentage?: number | null
          project_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_types: {
        Row: {
          banheiros: number | null
          company_id: string
          created_at: string
          id: string
          metragem: number | null
          nome: string
          project_id: string | null
          quartos: number | null
          valor_base: number | null
          vagas: number | null
        }
        Insert: {
          banheiros?: number | null
          company_id: string
          created_at?: string
          id?: string
          metragem?: number | null
          nome: string
          project_id?: string | null
          quartos?: number | null
          valor_base?: number | null
          vagas?: number | null
        }
        Update: {
          banheiros?: number | null
          company_id?: string
          created_at?: string
          id?: string
          metragem?: number | null
          nome?: string
          project_id?: string | null
          quartos?: number | null
          valor_base?: number | null
          vagas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "unit_types_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_types_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_company_id: { Args: { _user_id: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
