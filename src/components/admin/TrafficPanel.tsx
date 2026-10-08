import { Loader2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { TrafficSourceRow } from "@/lib/admin.functions";
import type { FunnelEventRow } from "@/lib/db-types";
import { DIRECT, originOf, type TrafficOrigin } from "@/lib/traffic-origin";

/** Filtro por origem (e campanha, quando escolhida pela linha do resumo). */
export type OriginFilter = { source: string; campaign?: string | null } | null;

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

const SOURCE_COLORS: Record<string, string> = {
  facebook: "bg-blue-100 text-blue-800",
  fb: "bg-blue-100 text-blue-800",
  instagram: "bg-pink-100 text-pink-800",
  ig: "bg-pink-100 text-pink-800",
  google: "bg-amber-100 text-amber-800",
  tiktok: "bg-zinc-200 text-zinc-900",
  youtube: "bg-red-100 text-red-800",
  whatsapp: "bg-green-100 text-green-800",
  [DIRECT.toLowerCase()]: "bg-gray-100 text-gray-700",
};

export function SourceBadge({ source }: { source: string }) {
  const cls = SOURCE_COLORS[source.toLowerCase()] ?? "bg-violet-100 text-violet-800";
  return (
    <span
      className={`inline-block max-w-[9rem] truncate rounded px-2 py-0.5 align-middle text-xs font-semibold ${cls}`}
      title={source}
    >
      {source}
    </span>
  );
}

const matches = (o: Pick<TrafficOrigin, "source" | "campaign">, f: OriginFilter) =>
  !f || (o.source === f.source && (f.campaign === undefined || o.campaign === f.campaign));

/** Resumo por origem/campanha no período (sessões únicas). Clicar numa linha filtra os eventos. */
export function TrafficSources({
  rows,
  filter,
  onFilter,
}: {
  rows: TrafficSourceRow[];
  filter: OriginFilter;
  onFilter: (f: OriginFilter) => void;
}) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Origem do tráfego (sessões únicas)
        </h2>
        <span className="text-xs text-muted-foreground">
          Clique numa linha para ver só os eventos dessa origem.
        </span>
      </div>
      <Card className="overflow-hidden">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Origem</th>
                <th className="px-4 py-2 font-medium">Campanha</th>
                <th className="px-4 py-2 text-right font-medium">Visitantes</th>
                <th className="px-4 py-2 text-right font-medium">Viram produto</th>
                <th className="px-4 py-2 text-right font-medium">Checkout</th>
                <th className="px-4 py-2 text-right font-medium">Pedidos</th>
                <th className="px-4 py-2 text-right font-medium">Conv.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const active =
                  !!filter && filter.source === r.source && filter.campaign === r.campaign;
                return (
                  <tr
                    key={`${r.source}|${r.campaign ?? ""}`}
                    onClick={() =>
                      onFilter(active ? null : { source: r.source, campaign: r.campaign })
                    }
                    className={`cursor-pointer border-t hover:bg-muted/40 ${active ? "bg-primary/10" : ""}`}
                  >
                    <td className="whitespace-nowrap px-4 py-2">
                      <SourceBadge source={r.source} />
                      {r.medium && (
                        <span className="ml-2 text-xs text-muted-foreground">{r.medium}</span>
                      )}
                    </td>
                    <td
                      className="min-w-[14rem] max-w-[24rem] px-4 py-2 break-words"
                      title={r.campaign ?? ""}
                    >
                      {r.campaign ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.visitors}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.viewedProduct}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.checkout}</td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.orders}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {pct(r.orders, r.visitors)}%
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Sem visitas no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

/** Eventos recentes com a origem logo depois da hora (sem precisar rolar para o lado). */
export function RecentEvents({
  events,
  loading,
  filter,
  onFilter,
}: {
  events: FunnelEventRow[];
  loading: boolean;
  filter: OriginFilter;
  onFilter: (f: OriginFilter) => void;
}) {
  const host = typeof window !== "undefined" ? window.location.host : null;
  const rows = events
    .map((e) => ({ e, o: originOf(e, host) }))
    .filter(({ o }) => matches(o, filter));
  const sources = [...new Set(events.map((e) => originOf(e, host).source))];

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Eventos recentes ({rows.length}
          {filter ? ` de ${events.length}` : ""})
        </h2>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onFilter(null)}
          className={`rounded-full border px-3 py-1 text-xs ${!filter ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
        >
          Todas as origens
        </button>
        {sources.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() =>
              onFilter(filter?.source === s && filter.campaign === undefined ? null : { source: s })
            }
            className={`rounded-full border px-3 py-1 text-xs ${filter?.source === s && filter.campaign === undefined ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {s}
          </button>
        ))}
        {filter?.campaign !== undefined && filter && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs">
            {filter.source} · {filter.campaign ?? "sem campanha"}
            <button type="button" aria-label="Limpar filtro" onClick={() => onFilter(null)}>
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[8.5rem]" />
              <col className="w-[9.5rem]" />
              <col className="w-[16rem]" />
              <col />
              <col className="w-[6.5rem]" />
              <col className="w-[9rem]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Hora</th>
                <th className="px-3 py-2 font-medium">Evento</th>
                <th className="px-3 py-2 font-medium">Origem</th>
                <th className="px-3 py-2 font-medium">Produto · página</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
                <th className="px-3 py-2 font-medium">Sessão</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, o }) => (
                <tr key={e.id} className="border-t align-top hover:bg-muted/30">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <EventBadge
                      type={e.event_type}
                      step={(e.metadata as { step?: string } | null)?.step}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="max-w-full text-left"
                      title="Filtrar por esta origem"
                      onClick={() => onFilter({ source: o.source, campaign: o.campaign })}
                    >
                      <SourceBadge source={o.source} />
                      {o.medium && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{o.medium}</span>
                      )}
                    </button>
                    {o.campaign && (
                      <div
                        className="line-clamp-2 break-words text-xs"
                        title={`Campanha: ${o.campaign}`}
                      >
                        {o.campaign}
                      </div>
                    )}
                    {o.content && (
                      <div
                        className="truncate text-xs text-muted-foreground"
                        title={`Anúncio (utm_content): ${o.content}`}
                      >
                        {o.content}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="truncate" title={e.bundle_name ?? ""}>
                      {e.bundle_name ?? <span className="text-muted-foreground">—</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={e.path ?? ""}>
                      {e.path}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {e.value != null ? brl(Number(e.value)) : "—"}
                  </td>
                  <td className="truncate px-3 py-2 font-mono text-xs text-muted-foreground">
                    {e.session_id.slice(0, 8)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    {filter
                      ? "Nenhum evento dessa origem no período."
                      : "Nenhum evento ainda. Navegue na loja para gerar dados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

const CHECKOUT_STEP_LABEL: Record<string, string> = {
  checkout: "Checkout: entrou",
  dados: "Checkout: dados",
  entrega: "Checkout: entrega",
  pix: "Pedido gerado",
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
