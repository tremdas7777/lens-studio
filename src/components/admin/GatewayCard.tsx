import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GATEWAYS, GATEWAY_IDS, type GatewayId } from "@/lib/gateway-id";
import {
  deleteGatewayKey,
  getGatewayStatus,
  saveGatewayKey,
  setActiveGatewayFn,
  testGatewayKey,
} from "@/lib/gateway.functions";

export interface GatewayCardProps {
  password: string;
}

type GatewayState = {
  id: GatewayId;
  configured: boolean;
  source: "db" | "env" | null;
  maskedKey: string | null;
};

const ENV: Record<GatewayId, string> = {
  pixgate: "PIXGATE_API_KEY",
  sagacepay: "SAGACEPAY_API_KEY",
};

/** Gateway Pix: escolhe o ativo e guarda a chave de cada um. */
export function GatewayCard({ password }: GatewayCardProps) {
  const statusFn = useServerFn(getGatewayStatus);
  const saveFn = useServerFn(saveGatewayKey);
  const deleteFn = useServerFn(deleteGatewayKey);
  const activateFn = useServerFn(setActiveGatewayFn);
  const testFn = useServerFn(testGatewayKey);

  const [active, setActive] = useState<GatewayId | null>(null);
  const [states, setStates] = useState<GatewayState[]>([]);
  const [keys, setKeys] = useState<Record<GatewayId, string>>({ pixgate: "", sagacepay: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = () =>
    statusFn({ data: { password } })
      .then((r) => {
        setActive(r.active);
        setStates(r.gateways);
      })
      .catch(() => setMsg("Não foi possível carregar os gateways."));

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
    } catch (e) {
      setMsg(e instanceof Error && e.message ? e.message : "Falhou. Tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  const save = (gateway: GatewayId) =>
    run(async () => {
      await saveFn({ data: { password, gateway, key: keys[gateway].trim() } });
      setKeys((k) => ({ ...k, [gateway]: "" }));
      await refresh();
      return `Chave da ${GATEWAYS[gateway]} salva.`;
    });

  const remove = (gateway: GatewayId) =>
    run(async () => {
      await deleteFn({ data: { password, gateway } });
      await refresh();
      return `Chave da ${GATEWAYS[gateway]} apagada do banco.`;
    });

  const activate = (gateway: GatewayId) =>
    run(async () => {
      await activateFn({ data: { password, gateway } });
      await refresh();
      return `${GATEWAYS[gateway]} ativado. Os próximos Pix serão gerados nele; Pix já gerados continuam sendo conferidos no gateway de origem.`;
    });

  const test = (gateway: GatewayId) =>
    run(async () => {
      const r = await testFn({ data: { password, gateway } });
      if (gateway === "pixgate") return r.ok ? "PixGate: chave presente." : "PixGate: sem chave.";
      return r.ok
        ? "SagacePay: conexão OK, a chave foi aceita."
        : `SagacePay recusou (HTTP ${r.status ?? "?"})${r.error ? `: ${r.error}` : ""}`;
    });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <CreditCard className="h-5 w-5 text-muted-foreground" aria-hidden />
        <div>
          <div className="font-medium">Gateway de pagamento (Pix)</div>
          <div className="text-xs text-muted-foreground">
            O gateway ativo gera os novos Pix. A confirmação de pagamento é sempre feita no gateway
            em que o Pix foi gerado.
          </div>
        </div>
      </div>

      {GATEWAY_IDS.map((id) => {
        const st = states.find((s) => s.id === id);
        const isActive = active === id;
        return (
          <div
            key={id}
            className={`flex flex-col gap-3 rounded-lg border p-4 ${isActive ? "border-primary" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{GATEWAYS[id]}</span>
              {isActive ? (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                  Ativo
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !st?.configured}
                  onClick={() => activate(id)}
                >
                  Usar este gateway
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {!st
                  ? "…"
                  : st.configured
                    ? st.source === "env"
                      ? `Chave da variável ${ENV[id]}`
                      : `Chave salva ${st.maskedKey ?? ""}`
                    : "Sem chave"}
              </span>
            </div>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <Input
                type="password"
                placeholder={
                  st?.configured
                    ? "Chave salva — cole uma nova para trocar"
                    : `Cole a API key da ${GATEWAYS[id]}`
                }
                value={keys[id]}
                onChange={(e) => setKeys((k) => ({ ...k, [id]: e.target.value }))}
                className="lg:max-w-sm"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={!keys[id].trim() || busy} onClick={() => save(id)}>
                  Salvar
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={st?.source !== "db" || isActive || busy}
                  onClick={() => remove(id)}
                >
                  Apagar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!st?.configured || busy}
                  onClick={() => test(id)}
                >
                  Testar conexão
                </Button>
              </div>
            </div>
          </div>
        );
      })}

      {msg && <div className="text-xs text-foreground">{msg}</div>}
    </Card>
  );
}
