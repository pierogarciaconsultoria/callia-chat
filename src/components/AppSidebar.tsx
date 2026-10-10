import {
  LayoutDashboard,
  Users,
  Truck,
  HardHat,
  ShoppingCart,
  DollarSign,
  ArrowUpCircle,
  ArrowDownCircle,
  ChevronRight,
  Wrench,
  Settings,
  LogOut,
  FileText,
  Handshake,
  ClipboardList,
  BadgePercent,
} from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

type MenuItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: MenuItem[];
};

const menuItems: MenuItem[] = [
  { title: 'Dashboard', url: '/', icon: LayoutDashboard },
  { title: 'Comercial', url: '/crm', icon: Handshake },
  { title: 'Clientes', url: '/clientes', icon: Users },
  { title: 'Contratos', url: '/contratos', icon: FileText },
  { title: 'Corretores', url: '/corretores', icon: BadgePercent },
  { title: 'Fornecedores', url: '/fornecedores', icon: Truck },
  { title: 'Obras', url: '/obras', icon: HardHat },
  { title: 'Compras', url: '/compras', icon: ShoppingCart },
  {
    title: 'Financeiro',
    url: '/financeiro',
    icon: DollarSign,
    children: [
      { title: 'Contas à Pagar', url: '/financeiro/contas-a-pagar', icon: ArrowUpCircle },
      { title: 'Contas à Receber', url: '/financeiro/contas-a-receber', icon: ArrowDownCircle },
    ],
  },
  { title: 'Patrimônio', url: '/patrimonio', icon: Wrench },
  { title: 'Project Guide', url: '/project-guide', icon: ClipboardList },
];

const bottomItems = [
  { title: 'Configurações', url: '/configuracoes', icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const { signOut, isSuperAdmin } = useAuth();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const visibleMenuItems = menuItems.filter(
    (item) => item.title !== 'Project Guide' || isSuperAdmin,
  );

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <HardHat className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && <span className="text-lg font-bold text-sidebar-foreground">PRUMO</span>}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMenuItems.map((item) =>
                item.children && !collapsed ? (
                  <Collapsible key={item.title} defaultOpen={isActive(item.url)} className="group/collapsible" asChild>
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton isActive={isActive(item.url)} tooltip={item.title} className="hover:bg-sidebar-accent/50">
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.children.map((child) => (
                            <SidebarMenuSubItem key={child.title}>
                              <SidebarMenuSubButton asChild isActive={isActive(child.url)}>
                                <NavLink to={child.url} className="hover:bg-sidebar-accent/50" activeClassName="bg-sidebar-accent text-primary font-medium">
                                  <child.icon className="h-4 w-4" />
                                  <span>{child.title}</span>
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ) : (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <NavLink to={item.url} end={item.url === '/'} className="hover:bg-sidebar-accent/50" activeClassName="bg-sidebar-accent text-primary font-medium">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                ),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          {bottomItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                <NavLink to={item.url} className="hover:bg-sidebar-accent/50" activeClassName="bg-sidebar-accent text-primary font-medium">
                  <item.icon className="h-4 w-4" />
                  {!collapsed && <span>{item.title}</span>}
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Sair">
              <Button variant="ghost" className="w-full justify-start gap-2 text-destructive hover:text-destructive" onClick={signOut}>
                <LogOut className="h-4 w-4" />
                {!collapsed && <span>Sair</span>}
              </Button>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
