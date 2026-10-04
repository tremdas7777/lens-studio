import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  deleteUtmifyTokenFn,
  getUtmifyStatus,
  saveUtmifyTokenFn,
  sendUtmifyTest,
} from "@/lib/utmify.functions";

export interface UtmifyCardProps {
  password: string;
}

/** Integração UTMify: token salvo no banco, com troca, exclusão e venda de teste. */
export function UtmifyCard({ password }: UtmifyCardProps) {
  const statusFn = useServerFn(getUtmifyStatus);
  const testFn = useServerFn(sendUtmifyTest);
  const saveFn = useServerFn(saveUtmifyTokenFn);
  const deleteFn = useServerFn(deleteUtmifyTokenFn);

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [source, setSource] = useState<"db" | "env" | null>(null);
  const [maskedToken, setMaskedToken] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () =>
    statusFn({ data: { password } })
      .then((r) => {
        setConfigured(r.configured);
        setSource(r.source);
        setMaskedToken(r.maskedToken);
      })
      .catch(() => setConfigured(false));

  useEffect(() => {
    if (!password) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch {
      setMsg("Falhou. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await saveFn({ data: { password, token: token.trim() } });
      setToken("");
      await refresh();
      return "Token salvo.";
    });

  const remove = () =>
    run(async () => {
      await deleteFn({ data: { password } });
      await refresh();
      return "Token apagado do banco.";
    });

  const runTest = (status: "paid" | "waiting_payment") =>
    run(async () => {
      const r = await testFn({ data: { password, status } });
      return r.ok
        ? `Conexão OK: a UTMify aceitou o pedido ${status === "paid" ? "pago" : "pendente"} (enviado como teste — não entra nas vendas).`
        : `A UTMify recusou (HTTP ${r.status ?? "?"}): ${r.error ?? "sem detalhes"}`;
    });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-5 w-5 text-muted-foreground" aria-hidden />
        <div>
          <div className="font-medium">Integração UTMify</div>
          <div className="text-xs text-muted-foreground">
            Cada Pix gerado (pendente) e cada pagamento aprovado é enviado à UTMify com as UTMs do
            cliente.
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <Input
          type="password"
          placeholder={
            configured ? "Token salvo — cole um novo para trocar" : "Cole o token da UTMify"
          }
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="lg:max-w-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!token.trim() || busy} onClick={save}>
            Salvar
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={source !== "db" || busy}
            onClick={remove}
          >
            Apagar
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!configured || busy}
            onClick={() => runTest("paid")}
          >
            Testar (pago)
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!configured || busy}
            onClick={() => runTest("waiting_payment")}
          >
            Testar (pendente)
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted-foreground">
          {configured === null
            ? "…"
            : configured
              ? source === "env"
                ? "Conectada (token da variável UTMIFY_API_TOKEN)"
                : "Conectada"
              : "Sem token"}
        </span>
        {maskedToken && (
          <span className="font-mono text-muted-foreground">Token atual: {maskedToken}</span>
        )}
        {msg && <span className="text-foreground">{msg}</span>}
      </div>
    </Card>
  );
}
