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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_configs: {
        Row: {
          ai_model: string
          business_hours: Json
          follow_up_rules: Json
          handoff_keywords: string[]
          language: string
          payment_links: Json
          persona_prompt: string
          updated_at: string
          voice_enabled: boolean
          voice_id: string | null
          website_url: string | null
          workspace_id: string
        }
        Insert: {
          ai_model?: string
          business_hours?: Json
          follow_up_rules?: Json
          handoff_keywords?: string[]
          language?: string
          payment_links?: Json
          persona_prompt?: string
          updated_at?: string
          voice_enabled?: boolean
          voice_id?: string | null
          website_url?: string | null
          workspace_id: string
        }
        Update: {
          ai_model?: string
          business_hours?: Json
          follow_up_rules?: Json
          handoff_keywords?: string[]
          language?: string
          payment_links?: Json
          persona_prompt?: string
          updated_at?: string
          voice_enabled?: boolean
          voice_id?: string | null
          website_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          last_used_at: string | null
          last_used_ip: string | null
          last_used_user_agent: string | null
          last4: string
          metadata: Json
          name: string
          prefix: string
          revoked_at: string | null
          revoked_by: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          last_used_at?: string | null
          last_used_ip?: string | null
          last_used_user_agent?: string | null
          last4: string
          metadata?: Json
          name: string
          prefix?: string
          revoked_at?: string | null
          revoked_by?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          last_used_at?: string | null
          last_used_ip?: string | null
          last_used_user_agent?: string | null
          last4?: string
          metadata?: Json
          name?: string
          prefix?: string
          revoked_at?: string | null
          revoked_by?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          id: string
          metadata: Json
          target: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          created_at?: string
          id?: string
          metadata?: Json
          target?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          id?: string
          metadata?: Json
          target?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_agent_id: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string
          id: string
          is_closed: boolean
          last_message_at: string
          metadata: Json
          mode: Database["public"]["Enums"]["conversation_mode"]
          unread_count: number
          updated_at: string
          whatsapp_instance_id: string | null
          workspace_id: string
        }
        Insert: {
          assigned_agent_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone: string
          id?: string
          is_closed?: boolean
          last_message_at?: string
          metadata?: Json
          mode?: Database["public"]["Enums"]["conversation_mode"]
          unread_count?: number
          updated_at?: string
          whatsapp_instance_id?: string | null
          workspace_id: string
        }
        Update: {
          assigned_agent_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string
          id?: string
          is_closed?: boolean
          last_message_at?: string
          metadata?: Json
          mode?: Database["public"]["Enums"]["conversation_mode"]
          unread_count?: number
          updated_at?: string
          whatsapp_instance_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      faqs: {
        Row: {
          answer: string
          created_at: string
          id: string
          is_active: boolean
          question: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          is_active?: boolean
          question: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          is_active?: boolean
          question?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "faqs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_events: {
        Row: {
          correlation_id: string
          event_type: string
          id: string
          message_id: string | null
          payload: Json
          processed_at: string | null
          processing_status: string
          provider: string
          provider_event_id: string
          received_at: string
          whatsapp_instance_id: string | null
          workspace_id: string
        }
        Insert: {
          correlation_id?: string
          event_type: string
          id?: string
          message_id?: string | null
          payload?: Json
          processed_at?: string | null
          processing_status?: string
          provider?: string
          provider_event_id: string
          received_at?: string
          whatsapp_instance_id?: string | null
          workspace_id: string
        }
        Update: {
          correlation_id?: string
          event_type?: string
          id?: string
          message_id?: string | null
          payload?: Json
          processed_at?: string | null
          processing_status?: string
          provider?: string
          provider_event_id?: string
          received_at?: string
          whatsapp_instance_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_events_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agent_user_id: string | null
          ai_model: string | null
          content: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_id: string | null
          id: string
          media_url: string | null
          metadata: Json
          sender: Database["public"]["Enums"]["message_sender"]
          tokens_used: number | null
          transcription: string | null
          type: Database["public"]["Enums"]["message_type"]
          workspace_id: string
        }
        Insert: {
          agent_user_id?: string | null
          ai_model?: string | null
          content?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          external_id?: string | null
          id?: string
          media_url?: string | null
          metadata?: Json
          sender: Database["public"]["Enums"]["message_sender"]
          tokens_used?: number | null
          transcription?: string | null
          type?: Database["public"]["Enums"]["message_type"]
          workspace_id: string
        }
        Update: {
          agent_user_id?: string | null
          ai_model?: string | null
          content?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          external_id?: string | null
          id?: string
          media_url?: string | null
          metadata?: Json
          sender?: Database["public"]["Enums"]["message_sender"]
          tokens_used?: number | null
          transcription?: string | null
          type?: Database["public"]["Enums"]["message_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_messages: {
        Row: {
          conversation_id: string | null
          correlation_id: string
          delivered_at: string | null
          delivery_status: string
          id: string
          last_error: string | null
          message_id: string | null
          payload: Json
          provider: string
          provider_message_id: string | null
          queued_at: string
          retry_count: number
          sent_at: string | null
          whatsapp_instance_id: string | null
          workspace_id: string
        }
        Insert: {
          conversation_id?: string | null
          correlation_id?: string
          delivered_at?: string | null
          delivery_status?: string
          id?: string
          last_error?: string | null
          message_id?: string | null
          payload?: Json
          provider?: string
          provider_message_id?: string | null
          queued_at?: string
          retry_count?: number
          sent_at?: string | null
          whatsapp_instance_id?: string | null
          workspace_id: string
        }
        Update: {
          conversation_id?: string | null
          correlation_id?: string
          delivered_at?: string | null
          delivery_status?: string
          id?: string
          last_error?: string | null
          message_id?: string | null
          payload?: Json
          provider?: string
          provider_message_id?: string | null
          queued_at?: string
          retry_count?: number
          sent_at?: string | null
          whatsapp_instance_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          link: string | null
          name: string
          price: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          link?: string | null
          name: string
          price?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          link?: string | null
          name?: string
          price?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_api_events: {
        Row: {
          api_key_id: string
          correlation_id: string
          created_at: string
          event_name: string
          external_id: string | null
          id: string
          metadata: Json
          payload: Json
          workspace_id: string
        }
        Insert: {
          api_key_id: string
          correlation_id?: string
          created_at?: string
          event_name: string
          external_id?: string | null
          id?: string
          metadata?: Json
          payload?: Json
          workspace_id: string
        }
        Update: {
          api_key_id?: string
          correlation_id?: string
          created_at?: string
          event_name?: string
          external_id?: string | null
          id?: string
          metadata?: Json
          payload?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_api_events_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_api_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      public_api_requests: {
        Row: {
          api_key_id: string | null
          correlation_id: string
          created_at: string
          endpoint: string
          error_code: string | null
          id: string
          idempotency_key: string | null
          method: string
          request_body: Json
          response_body: Json | null
          status_code: number
          workspace_id: string
        }
        Insert: {
          api_key_id?: string | null
          correlation_id?: string
          created_at?: string
          endpoint: string
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          method: string
          request_body?: Json
          response_body?: Json | null
          status_code: number
          workspace_id: string
        }
        Update: {
          api_key_id?: string | null
          correlation_id?: string
          created_at?: string
          endpoint?: string
          error_code?: string | null
          id?: string
          idempotency_key?: string | null
          method?: string
          request_body?: Json
          response_body?: Json | null
          status_code?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_api_requests_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_api_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempt_number: number
          attempted_at: string
          correlation_id: string
          delivered_at: string | null
          delivery_status: string
          error: string | null
          event: string
          id: string
          last_attempt_at: string | null
          next_retry_at: string | null
          payload: Json
          request_headers: Json
          response_body: string | null
          response_headers: Json | null
          response_status: number | null
          retry_count: number
          webhook_id: string
          webhook_url: string | null
          workspace_id: string
        }
        Insert: {
          attempt_number?: number
          attempted_at?: string
          correlation_id?: string
          delivered_at?: string | null
          delivery_status?: string
          error?: string | null
          event: string
          id?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          payload: Json
          request_headers?: Json
          response_body?: string | null
          response_headers?: Json | null
          response_status?: number | null
          retry_count?: number
          webhook_id: string
          webhook_url?: string | null
          workspace_id: string
        }
        Update: {
          attempt_number?: number
          attempted_at?: string
          correlation_id?: string
          delivered_at?: string | null
          delivery_status?: string
          error?: string | null
          event?: string
          id?: string
          last_attempt_at?: string | null
          next_retry_at?: string | null
          payload?: Json
          request_headers?: Json
          response_body?: string | null
          response_headers?: Json | null
          response_status?: number | null
          retry_count?: number
          webhook_id?: string
          webhook_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string
          description: string | null
          events: string[]
          headers: Json
          id: string
          is_active: boolean
          name: string
          secret: string
          updated_at: string
          url: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          events?: string[]
          headers?: Json
          id?: string
          is_active?: boolean
          name?: string
          secret?: string
          updated_at?: string
          url: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          events?: string[]
          headers?: Json
          id?: string
          is_active?: boolean
          name?: string
          secret?: string
          updated_at?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          connection_metadata: Json
          created_at: string
          display_name: string | null
          evolution_base_url: string | null
          id: string
          instance_name: string
          is_default: boolean
          last_seen_at: string | null
          phone_number: string | null
          provider_secret_ref: string | null
          provider_type: string
          qr_code: string | null
          status: Database["public"]["Enums"]["whatsapp_status"]
          updated_at: string
          webhook_token: string
          workspace_id: string
        }
        Insert: {
          connection_metadata?: Json
          created_at?: string
          display_name?: string | null
          evolution_base_url?: string | null
          id?: string
          instance_name: string
          is_default?: boolean
          last_seen_at?: string | null
          phone_number?: string | null
          provider_secret_ref?: string | null
          provider_type?: string
          qr_code?: string | null
          status?: Database["public"]["Enums"]["whatsapp_status"]
          updated_at?: string
          webhook_token?: string
          workspace_id: string
        }
        Update: {
          connection_metadata?: Json
          created_at?: string
          display_name?: string | null
          evolution_base_url?: string | null
          id?: string
          instance_name?: string
          is_default?: boolean
          last_seen_at?: string | null
          phone_number?: string | null
          provider_secret_ref?: string | null
          provider_type?: string
          qr_code?: string | null
          status?: Database["public"]["Enums"]["whatsapp_status"]
          updated_at?: string
          webhook_token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_branding: {
        Row: {
          created_at: string
          custom_domain: string | null
          display_name: string | null
          logo_url: string | null
          primary_color: string | null
          secondary_color: string | null
          support_email: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          custom_domain?: string | null
          display_name?: string | null
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          support_email?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          custom_domain?: string | null
          display_name?: string | null
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          support_email?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_branding_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_workspace_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
          _workspace_id: string
        }
        Returns: boolean
      }
      is_workspace_admin: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      rotate_webhook_secret: {
        Args: { p_webhook_id: string; p_workspace_id: string }
        Returns: string
      }
      rotate_whatsapp_webhook_token: {
        Args: { p_instance_id: string; p_workspace_id: string }
        Returns: string
      }
      set_default_whatsapp_instance: {
        Args: { p_instance_id: string; p_workspace_id: string }
        Returns: {
          connection_metadata: Json
          created_at: string
          display_name: string | null
          evolution_base_url: string | null
          id: string
          instance_name: string
          is_default: boolean
          last_seen_at: string | null
          phone_number: string | null
          provider_secret_ref: string | null
          provider_type: string
          qr_code: string | null
          status: Database["public"]["Enums"]["whatsapp_status"]
          updated_at: string
          webhook_token: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "whatsapp_instances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "agent"
      conversation_mode: "bot" | "human"
      message_direction: "inbound" | "outbound"
      message_sender: "customer" | "bot" | "agent" | "system"
      message_type: "text" | "audio" | "image" | "video" | "document" | "system"
      whatsapp_status:
        | "disconnected"
        | "connecting"
        | "qr"
        | "connected"
        | "error"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "agent"],
      conversation_mode: ["bot", "human"],
      message_direction: ["inbound", "outbound"],
      message_sender: ["customer", "bot", "agent", "system"],
      message_type: ["text", "audio", "image", "video", "document", "system"],
      whatsapp_status: [
        "disconnected",
        "connecting",
        "qr",
        "connected",
        "error",
      ],
    },
  },
} as const
