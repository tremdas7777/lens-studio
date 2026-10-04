import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Activity, CreditCard, Eye, Loader2, LogOut, ShoppingBag, Users } from "lucide-react";
import { getAdminFunnel, getAdminHealth, verifyAdminPassword } from "@/lib/admin.functions";
import type { FunnelEventRow } from "@/integrations/supabase/types";
import { UtmifyCard } from "@/components/admin/UtmifyCard";
import { MetaPixelCard } from "@/components/admin/MetaPixelCard";
import { OrdersTab } from "@/components/admin/OrdersTab";
import { AbandonedTab } from "@/components/admin/AbandonedTab";
import { HubbleLogo } from "@/components/admin/HubbleLogo";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Admin · Hubble Brasil" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  component: AdminPage,
});

const STORAGE_KEY = "hubble_admin_pwd";

type Funnel = {
  visited: number;
  viewedProduct: number;
  checkout: number;
  totalEvents: number;
  totalSessions: number;
  onlineNow: number;
  windowMinutes: number;
  onlineMinutes: number;
};

const TIME_WINDOWS = [
  { key: "15m", label: "15min", minutes: 15 },
  { key: "1h", label: "1h", minutes: 60 },
  { key: "6h", label: "6h", minutes: 60 * 6 },
  { key: "24h", label: "24h", minutes: 60 * 24 },
  { key: "7d", label: "7d", minutes: 60 * 24 * 7 },
  { key: "30d", label: "30d", minutes: 60 * 24 * 30 },
] as const;

function windowLabel(minutes: number) {
  return TIME_WINDOWS.find((w) => w.minutes === minutes)?.label ?? `${minutes}min`;
}

function AdminPage() {
  const verify = useServerFn(verifyAdminPassword);
  const fetchFunnel = useServerFn(getAdminFunnel);

  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  const [events, setEvents] = useState<FunnelEventRow[]>([]);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [windowMinutes, setWindowMinutes] = useState<number>(60 * 24);
  const onlineMinutes = 3;

  // Login automático com a senha da sessão.
  useEffect(() => {
    const stored = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_KEY) : null;
    if (!stored) {
      setChecking(false);
      return;
    }
    verify({ data: { password: stored } })
      .then((r) => {
        if (r.ok) {
          setPassword(stored);
          setAuthed(true);
        } else sessionStorage.removeItem(STORAGE_KEY);
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [verify]);

  // Dados do funil, atualizados a cada 15 s.
  useEffect(() => {
    if (!authed || !password) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const r = await fetchFunnel({ data: { password, windowMinutes, onlineMinutes } });
        if (!cancelled) {
          setEvents(r.recent);
          setFunnel(r.funnel);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Erro ao carregar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [authed, password, fetchFunnel, windowMinutes]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const r = await verify({ data: { password } });
      if (r.ok) {
        sessionStorage.setItem(STORAGE_KEY, password);
        setAuthed(true);
      } else setError("error" in r && r.error ? r.error : "Senha incorreta");
    } catch {
      setError("Erro ao verificar senha");
    }
  };

  const logout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setAuthed(false);
    setPassword("");
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm p-8">
          <HubbleLogo className="mb-6 h-7 text-primary" />
          <h1 className="mb-1 text-xl font-semibold">Painel administrativo</h1>
          <p className="mb-6 text-sm text-muted-foreground">Acesso restrito</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">
              Entrar
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5">
          <div className="flex items-center gap-4">
            <HubbleLogo className="h-6" />
            <div className="border-l border-white/30 pl-4">
              <h1 className="text-lg font-semibold leading-tight">Painel Admin</h1>
              <p className="text-xs opacity-80">
                Últimas {windowLabel(windowMinutes)} · atualiza a cada 15 s
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
              Ao vivo
            </span>
            <Button size="sm" variant="secondary" onClick={logout}>
              <LogOut className="h-4 w-4" /> Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <Tabs defaultValue="funil">
          <TabsList className="mb-8 flex-wrap">
            <TabsTrigger value="funil">Funil</TabsTrigger>
            <TabsTrigger value="pedidos">Pedidos</TabsTrigger>
            <TabsTrigger value="abandonados">Checkouts abandonados</TabsTrigger>
            <TabsTrigger value="integracoes">Integrações</TabsTrigger>
          </TabsList>

          <TabsContent value="pedidos">
            <OrdersTab password={password} />
          </TabsContent>

          <TabsContent value="abandonados">
            <AbandonedTab password={password} />
          </TabsContent>

          <TabsContent value="integracoes" className="space-y-3">
            <HealthCard password={password} />
            <UtmifyCard password={password} />
            <MetaPixelCard password={password} />
          </TabsContent>

          <TabsContent value="funil" className="space-y-8">
            <section>
              <div className="flex flex-wrap gap-2">
                {TIME_WINDOWS.map((w) => (
                  <Button
                    key={w.key}
                    type="button"
                    variant={windowMinutes === w.minutes ? "default" : "outline"}
                    size="sm"
                    onClick={() => setWindowMinutes(w.minutes)}
                  >
                    {w.label}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Online agora = sessões com atividade nos últimos {onlineMinutes} min.
              </p>
              {loadError && <p className="mt-2 text-sm text-destructive">{loadError}</p>}
            </section>

            <section>
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Funil (sessões únicas)
              </h2>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <StatCard
                  icon={<Users className="h-5 w-5" />}
                  label="Online agora"
                  value={funnel?.onlineNow ?? 0}
                  helper={`últimos ${onlineMinutes} min`}
                />
                <StatCard
                  icon={<Activity className="h-5 w-5" />}
                  label="Visitantes"
                  value={funnel?.visited ?? 0}
                />
                <StatCard
                  icon={<Eye className="h-5 w-5" />}
                  label="Viram produto"
                  value={funnel?.viewedProduct ?? 0}
                  percent={pct(funnel?.viewedProduct, funnel?.visited)}
                />
                <StatCard
                  icon={<ShoppingBag className="h-5 w-5" />}
                  label="Foram ao checkout"
                  value={funnel?.checkout ?? 0}
                  percent={pct(funnel?.checkout, funnel?.visited)}
                />
                <StatCard
                  icon={<CreditCard className="h-5 w-5" />}
                  label="Conv. checkout"
                  value={`${pct(funnel?.checkout, funnel?.visited)}%`}
                />
              </div>
            </section>

            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Eventos recentes ({events.length})
                </h2>
                {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>
              <Card className="overflow-hidden">
                <div className="max-h-[600px] overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/50">
                      <tr className="text-left">
                        <th className="px-4 py-2 font-medium">Hora</th>
                        <th className="px-4 py-2 font-medium">Evento</th>
                        <th className="px-4 py-2 font-medium">Sessão</th>
                        <th className="px-4 py-2 font-medium">Página</th>
                        <th className="px-4 py-2 font-medium">Produto</th>
                        <th className="px-4 py-2 font-medium">Valor</th>
                        <th className="px-4 py-2 font-medium">UTM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e) => (
                        <tr key={e.id} className="border-t hover:bg-muted/30">
                          <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                            {new Date(e.created_at).toLocaleString("pt-BR", {
                              dateStyle: "short",
                              timeStyle: "medium",
                            })}
                          </td>
                          <td className="px-4 py-2">
                            <EventBadge
                              type={e.event_type}
                              step={(e.metadata as { step?: string } | null)?.step}
                            />
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                            {e.session_id.slice(0, 8)}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{e.path}</td>
                          <td className="px-4 py-2">{e.bundle_name ?? "—"}</td>
                          <td className="px-4 py-2 tabular-nums">
                            {e.value != null ? brl(Number(e.value)) : "—"}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {e.utm_source ?? "—"}
                          </td>
                        </tr>
                      ))}
                      {events.length === 0 && !loading && (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                            Nenhum evento ainda. Navegue na loja para gerar dados.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function pct(part?: number, total?: number) {
  if (!total || !part) return 0;
  return Math.round((part / total) * 100);
}

function HealthCard({ password }: { password: string }) {
  const fn = useServerFn(getAdminHealth);
  const [h, setH] = useState<Awaited<ReturnType<typeof fn>> | null>(null);
  useEffect(() => {
    fn({ data: { password } })
      .then(setH)
      .catch(() => setH(null));
  }, [fn, password]);
  const Item = ({ ok, label, env }: { ok: boolean | undefined; label: string; env: string }) => (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>
        {label} <span className="font-mono text-xs text-muted-foreground">{env}</span>
      </span>
      <span
        className={`rounded px-2 py-0.5 text-xs font-medium ${ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}
      >
        {ok ? "configurado" : "faltando"}
      </span>
    </div>
  );
  return (
    <Card className="space-y-2 p-5">
      <div className="mb-2 font-medium">Variáveis de ambiente</div>
      <Item
        ok={h?.supabase}
        label="Banco (Supabase)"
        env="SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"
      />
      <Item ok={h?.pixgate} label="Gateway Pix (PixGate)" env="PIXGATE_API_KEY" />
      <Item ok={h?.rastrocode} label="Rastreio (RastroCode)" env="RASTROCODE_API_KEY" />
      <p className="pt-2 text-xs text-muted-foreground">
        URL pública (postback do Pix):{" "}
        {h?.publicSiteUrl ?? "domínio da requisição (PUBLIC_SITE_URL não definida)"}
      </p>
    </Card>
  );
}

function StatCard({
  icon,
  label,
  value,
  percent,
  helper,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  percent?: number;
  helper?: string;
}) {
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-3xl font-semibold tabular-nums text-primary">{value}</div>
      {percent !== undefined && (
        <div className="mt-1 text-xs text-muted-foreground">{percent}% dos visitantes</div>
      )}
      {helper && percent === undefined && (
        <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
      )}
    </Card>
  );
}

const CHECKOUT_STEP_LABEL: Record<string, string> = {
  checkout: "Checkout: entrou",
  dados: "Checkout: dados",
  entrega: "Checkout: entrega",
  pix: "Checkout: Pix gerado",
};

function EventBadge({ type, step }: { type: string; step?: string | undefined }) {
  const map: Record<string, { label: string; cls: string }> = {
    page_view: { label: "Visita", cls: "bg-blue-100 text-blue-800" },
    product_view: { label: "Produto", cls: "bg-indigo-100 text-indigo-800" },
    checkout_click: { label: "Checkout", cls: "bg-green-100 text-green-800" },
    checkout_step: {
      label: CHECKOUT_STEP_LABEL[step ?? ""] ?? "Checkout: etapa",
      cls: step === "pix" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
    },
  };
  const m = map[type] ?? { label: type, cls: "bg-gray-100 text-gray-800" };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
}
