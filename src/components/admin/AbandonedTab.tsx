import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageCircle, RefreshCw } from "lucide-react";
import {
  getAbandonedCheckouts,
  type AbandonedCheckout,
  type AbandonStep,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PERIODS = [
  { days: 1, label: "Hoje" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
] as const;

/** Onde a pessoa parou (etapa mais avançada que ela chegou). */
const STEP_INFO: Record<AbandonStep, { label: string; cls: string }> = {
  checkout: { label: "Entrou e saiu", cls: "bg-gray-100 text-gray-700" },
  dados: { label: "Parou na entrega", cls: "bg-amber-100 text-amber-800" },
  entrega: { label: "Parou no pagamento", cls: "bg-orange-100 text-orange-800" },
  pix: { label: "Gerou Pix e não pagou", cls: "bg-red-100 text-red-700" },
};

const FUNNEL: { key: AbandonStep | "pago"; label: string }[] = [
  { key: "checkout", label: "Entraram no checkout" },
  { key: "dados", label: "Preencheram os dados" },
  { key: "entrega", label: "Preencheram a entrega" },
  { key: "pix", label: "Geraram o Pix" },
  { key: "pago", label: "Pagaram" },
];

const brl = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const fmtPhone = (d: string) =>
  d.length === 11
    ? d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3")
    : d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");

function whatsappLink(r: AbandonedCheckout) {
  if (!r.phone) return null;
  const first = (r.name ?? "").split(/\s+/)[0];
  const msg =
    r.step === "pix"
      ? `Oi ${first}! Vi que você gerou o Pix do seu pedido Hubble${r.number ? ` ${r.number}` : ""} e ainda não finalizou. Posso te ajudar com alguma dúvida?`
      : `Oi ${first}! Vi que você começou seu pedido na Hubble. Ficou alguma dúvida? Estou aqui pra te ajudar.`;
  return `https://wa.me/55${r.phone.replace(/^55/, "")}?text=${encodeURIComponent(msg)}`;
}

export function AbandonedTab({ password }: { password: string }) {
  const fetchFn = useServerFn(getAbandonedCheckouts);
  const [days, setDays] = useState<number>(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    funnel: Record<AbandonStep | "pago", number>;
    rows: AbandonedCheckout[];
  } | null>(null);
  const [filter, setFilter] = useState<AbandonStep | "todos">("todos");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchFn({ data: { password, days } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password, days]);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    // "Entrou e saiu" não tem contato; só aparece quando filtrado.
    return filter === "todos"
      ? all.filter((r) => r.step !== "checkout")
      : all.filter((r) => r.step === filter);
  }, [data, filter]);

  const counts = useMemo(() => {
    const c: Record<AbandonStep, number> = { checkout: 0, dados: 0, entrega: 0, pix: 0 };
    for (const r of data?.rows ?? []) c[r.step]++;
    return c;
  }, [data]);

  const top = data?.funnel.checkout || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <Button
            key={p.days}
            size="sm"
            variant={days === p.days ? "default" : "outline"}
            onClick={() => setDays(p.days)}
          >
            {p.label}
          </Button>
        ))}
        <Button size="sm" variant="outline" className="ml-auto" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}{" "}
          Atualizar
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Onde abandonam
        </h3>
        <div className="space-y-3">
          {FUNNEL.map((f, i) => {
            const n = data?.funnel[f.key] ?? 0;
            const prev = i === 0 ? n : (data?.funnel[FUNNEL[i - 1]!.key] ?? 0);
            const pct = top ? Math.round((n / top) * 100) : 0;
            const lost = i === 0 ? 0 : prev - n;
            return (
              <div key={f.key}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="font-medium">{f.label}</span>
                  <span className="tabular-nums">
                    <b>{n}</b> <span className="text-muted-foreground">({pct}%)</span>
                    {lost > 0 && (
                      <span className="ml-2 text-xs text-red-600">−{lost} saíram aqui</span>
                    )}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      f.key === "pago" ? "bg-green-600" : "bg-primary",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Quem pagou (mesmo em outra visita, pelo e-mail) não aparece como abandono.
        </p>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={filter === "todos" ? "default" : "outline"}
          onClick={() => setFilter("todos")}
        >
          Com contato ({counts.dados + counts.entrega + counts.pix})
        </Button>
        {(["pix", "entrega", "dados", "checkout"] as AbandonStep[]).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={filter === s ? "default" : "outline"}
            onClick={() => setFilter(s)}
          >
            {STEP_INFO[s].label} ({counts[s]})
          </Button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[700px] overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Quando</th>
                <th className="px-4 py-2 font-medium">Onde parou</th>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Telefone</th>
                <th className="px-4 py-2 font-medium">Carrinho</th>
                <th className="px-4 py-2 font-medium">Valor</th>
                <th className="px-4 py-2 font-medium">Local</th>
                <th className="px-4 py-2 font-medium">Origem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const wa = whatsappLink(r);
                const info = STEP_INFO[r.step];
                return (
                  <tr key={r.sessionId} className="border-t hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                      {fmtDate(r.lastAt)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium",
                          info.cls,
                        )}
                      >
                        {r.pixPending ? "Pix gerado (aguardando)" : info.label}
                      </span>
                      {r.number && (
                        <div className="mt-1 font-mono text-xs text-muted-foreground">
                          {r.number}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.email ?? ""}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {r.phone ? fmtPhone(r.phone) : "—"}
                      {wa && (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-2 inline-flex items-center gap-1 rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700"
                        >
                          <MessageCircle className="h-3 w-3" /> Chamar
                        </a>
                      )}
                    </td>
                    <td className="max-w-[260px] px-4 py-2">
                      {r.plano ?? "—"}
                      {r.bump && (
                        <span className="ml-1 text-xs text-muted-foreground">+ oferta</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums">{brl(r.value)}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {r.cidade ? `${r.cidade}/${r.uf ?? ""}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {r.utmSource ?? "—"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    Nenhum checkout abandonado neste período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
