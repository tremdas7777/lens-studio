import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  deleteHypercashKeysFn,
  getHypercashStatus,
  saveHypercashKeysFn,
  setCardEnabledFn,
  testHypercashFn,
} from "@/lib/hypercash.functions";

type KeyView = { masked: string | null; source: "db" | "env" | null };
type Status = { enabled: boolean; secret: KeyView; public: KeyView };

/** Cartão de crédito (HyperCash): chaves salvas no banco + liga/desliga no checkout. */
export function HypercashCard({ password }: { password: string }) {
  const statusFn = useServerFn(getHypercashStatus);
  const saveFn = useServerFn(saveHypercashKeysFn);
  const deleteFn = useServerFn(deleteHypercashKeysFn);
  const testFn = useServerFn(testHypercashFn);
  const toggleFn = useServerFn(setCardEnabledFn);

  const [st, setSt] = useState<Status | null>(null);
  const [secret, setSecret] = useState("");
  const [pub, setPub] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () =>
    statusFn({ data: { password } })
      .then(setSt)
      .catch(() => setMsg("Não foi possível carregar o cartão."));

  useEffect(() => {
    if (password) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg(e instanceof Error && e.message ? e.message : "Algo deu errado. Tente de novo.");
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const save = () =>
    run("save", async () => {
      await saveFn({
        data: {
          password,
          ...(secret.trim() ? { secret: secret.trim() } : {}),
          ...(pub.trim() ? { public: pub.trim() } : {}),
        },
      });
      setSecret("");
      setPub("");
      return "Chaves salvas.";
    });

  const remove = () =>
    run("delete", async () => {
      await deleteFn({ data: { password } });
      return "Chaves apagadas do banco. Sem chaves, o cartão some do checkout.";
    });

  const test = () =>
    run("test", async () => {
      const r = await testFn({ data: { password } });
      return r.ok
        ? "Conexão OK: a HyperCash aceitou a chave secreta. (Nenhuma cobrança foi criada.)"
        : `Falhou${r.status ? ` (HTTP ${r.status})` : ""}: ${r.error ?? "sem detalhes"}`;
    });

  const toggle = () =>
    run("toggle", async () => {
      const r = await toggleFn({ data: { password, enabled: !st?.enabled } });
      return r.enabled ? "Cartão ativado no checkout." : "Cartão desativado: checkout só com Pix.";
    });

  const hasKeys = !!st?.secret.masked && !!st?.public.masked;
  const keyLabel = (k: KeyView | undefined, name: string, env: string) =>
    !k?.masked
      ? `${name}`
      : k.source === "env"
        ? `${name} da variável ${env}`
        : `${name} salva (${k.masked})`;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CreditCard className="h-5 w-5 text-muted-foreground" aria-hidden />
          <div>
            <div className="font-medium">Pagamento com cartão (HyperCash)</div>
            <div className="text-xs text-muted-foreground">
              Ao ativar, o checkout passa a oferecer cartão em até 12x sem juros (parcela mínima de
              R$ 30). Desativado, os clientes veem só o Pix — mas você, logado neste admin, ainda vê
              o cartão para testar (abra /checkout.html nesta mesma aba).
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {!st
              ? "…"
              : st.enabled && hasKeys
                ? "Ativo"
                : !st.enabled
                  ? "Desativado"
                  : "Sem chaves"}
          </span>
          <Button
            size="sm"
            variant={st?.enabled ? "destructive" : "default"}
            disabled={!!busy || !st || (!st.enabled && !hasKeys)}
            onClick={toggle}
          >
            {busy === "toggle" ? "Salvando…" : st?.enabled ? "Desativar" : "Ativar"}
          </Button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          type="password"
          autoComplete="off"
          placeholder={keyLabel(st?.public, "Chave pública", "HYPERCASH_PUBLIC_KEY")}
          value={pub}
          onChange={(e) => setPub(e.target.value)}
        />
        <Input
          type="password"
          autoComplete="off"
          placeholder={keyLabel(st?.secret, "Chave secreta", "HYPERCASH_SECRET_KEY")}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={(!secret.trim() && !pub.trim()) || !!busy} onClick={save}>
          {busy === "save" ? "Salvando…" : "Salvar chaves"}
        </Button>
        <Button size="sm" variant="outline" disabled={!st?.secret.masked || !!busy} onClick={test}>
          {busy === "test" ? "Testando…" : "Testar conexão"}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={(st?.secret.source !== "db" && st?.public.source !== "db") || !!busy}
          onClick={remove}
        >
          {busy === "delete" ? "Apagando…" : "Apagar chaves"}
        </Button>
      </div>
      {msg && <p className="text-xs">{msg}</p>}
    </Card>
  );
}
