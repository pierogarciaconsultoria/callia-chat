import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useCompanyId(): string {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('company_id').eq('id', user!.id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
  return data?.company_id ?? '';
}

export function useClientesSelect(companyId: string, enabled = true) {
  return useQuery({
    queryKey: ['clients', companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name').eq('company_id', companyId).order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!companyId && enabled,
  });
}

export function useCategoriasFinanceiras(companyId: string, enabled = true) {
  return useQuery({
    queryKey: ['financial_categories', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financial_categories')
        .select('id, name')
        .eq('company_id', companyId)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!companyId && enabled,
  });
}

export function useObrasSelect(companyId: string, enabled = true) {
  return useQuery({
    queryKey: ['projects-select', companyId],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id, name').eq('company_id', companyId).order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!companyId && enabled,
  });
}

export function useCnpjsEmissores(companyId: string, enabled = true) {
  return useQuery({
    queryKey: ['legal_entities', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('legal_entities')
        .select('id, razao_social, cnpj')
        .eq('company_id', companyId)
        .eq('ativo', true)
        .order('razao_social');
      if (error) throw error;
      return data;
    },
    enabled: !!companyId && enabled,
  });
}

export function useContasBancarias(companyId: string, enabled = true) {
  return useQuery({
    queryKey: ['bank_accounts', companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bank_accounts')
        .select('id, nome, banco, agencia, conta')
        .eq('company_id', companyId)
        .eq('ativo', true)
        .order('nome');
      if (error) throw error;
      return data;
    },
    enabled: !!companyId && enabled,
  });
}
