"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ChartLegend,
  ChartLegendContent,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { allocateProfitFirst } from "@/lib/financial-planning"
import {
  confirmedBalances,
  isStripeDeposit,
  monthlyResult,
  monthsEnding,
} from "@/lib/financial-scorecard/calculations"
import type { ScorecardData } from "@/lib/financial-scorecard/types"
import {
  confirmMonth,
  reviewExpenses,
  reviewIncome,
  saveAccountBalance,
} from "./scorecard-actions"

const money = (cents: number | null) =>
  cents === null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(cents / 100)
const config = {
  revenue: { label: "Cobros", color: "var(--chart-1)" },
  expenses: { label: "Gastos", color: "var(--chart-4)" },
  result: { label: "Resultado", color: "var(--chart-2)" },
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-2xl font-semibold">{value}</p>
        {detail && (
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        )}
      </CardContent>
    </Card>
  )
}
function Choice({
  value,
  onChange,
  options,
  label,
  disabled,
  placeholder,
  className = "w-52",
}: {
  value: string
  onChange: (v: string) => void
  options: [string, string][]
  label: string
  disabled: boolean
  placeholder?: string
  className?: string
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
export function FinancialOverview({
  data,
  error,
}: {
  data: ScorecardData | null
  error: string | null
}) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const now = data?.loadedAt ?? new Date().toISOString()
  const current = now.slice(0, 7)
  const [month, setMonth] = useState(monthsEnding(current, 2)[0])
  const [reviewOpen, setReviewOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [balanceAccount, setBalanceAccount] = useState<string | null>(null)
  const [balanceDate, setBalanceDate] = useState(now.slice(0, 10))
  const [balanceAmount, setBalanceAmount] = useState("")
  const [detailOpen, setDetailOpen] = useState(false)
  const run = (
    action: () => Promise<{ error: string | null }>,
    done?: () => void
  ) =>
    startTransition(async () => {
      try {
        const r = await action()
        if (r.error) {
          toast.error(r.error)
          return
        }
        toast.success("Guardado")
        done?.()
        router.refresh()
      } catch {
        toast.error("No se pudo completar. Volvé a intentar.")
      }
    })
  if (!data)
    return (
      <Alert variant="destructive">
        <AlertTitle>Scorecard no disponible</AlertTitle>
        <AlertDescription>
          {error ??
            "No se pudieron cargar los registros. No se muestran importes incompletos."}
        </AlertDescription>
      </Alert>
    )
  const r = monthlyResult(data, month)
  const series = monthsEnding(month).map((m) => {
    const x = monthlyResult(data, m)
    return {
      month: m,
      revenue: x.revenue / 100,
      expenses: x.expenses / 100,
      result: x.result === null ? null : x.result / 100,
    }
  })
  const cash = confirmedBalances(data.accounts, data.balances, now.slice(0, 10))
  const pf = allocateProfitFirst(r.stripe)
  const snapshots = [...data.snapshots].sort((a, b) =>
    b.observed_at.localeCompare(a.observed_at)
  )
  const latest = snapshots.find((s) => s.valid)
  const latestAttempt = snapshots[0]
  const history = [
    ...new Map(
      snapshots
        .filter((s) => s.valid)
        .reverse()
        .map((s) => [s.observed_at.slice(0, 7), s])
    ).values(),
  ].sort((a, b) => a.observed_at.localeCompare(b.observed_at))
  const unresolved =
    r.incomePending.length +
    r.expensePending.length +
    r.unlinkedExpenses.length +
    r.missingPaymentDates.length +
    r.unknown.length
  const incomeRows = data.bank.filter(
    (t) =>
      t.txn_date.startsWith(month) &&
      t.direction === "in" &&
      t.flow_class === "external_income" &&
      !isStripeDeposit(t)
  )
  const expenseRows = data.expenses.filter((e) =>
    (e.is_paid ? (e.paid_at ?? e.date) : e.date).startsWith(month)
  )
  const selectedIds = expenseRows
    .filter((e) => selected.has(e.id))
    .map((e) => e.id)
  const allSelected =
    expenseRows.length > 0 && selectedIds.length === expenseRows.length
  const categoryOptions: [string, string][] = [
    ["none", "Sin categoría"],
    ...[...data.categories]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c): [string, string] => [c.id, c.name]),
  ]
  const treatmentOptions: [string, string][] = [
    ["operating", "Gasto operativo"],
    ["partner_distribution", "Distribución a socios"],
  ]
  const categoryPatch = (v: string) => ({
    categoryId: v === "none" ? null : v,
  })
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            Resultado operativo por cobros y pagos
          </h2>
          <p className="text-sm text-muted-foreground">
            Antes de distribuciones a socios · USD · gastos e ingresos
            revisables
          </p>
        </div>
        <Field className="w-44">
          <FieldLabel htmlFor="finance-month">Mes</FieldLabel>
          <Input
            id="finance-month"
            type="month"
            max={current}
            value={month}
            onChange={(e) => {
              if (
                /^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value) &&
                e.target.value <= current
              )
                setMonth(e.target.value)
            }}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={r.reviewed ? "default" : "secondary"}>
          {r.reviewed ? "Revisado" : "Provisional"}
        </Badge>
        {month === current && (
          <Badge variant="outline">Mes en curso · parcial</Badge>
        )}
        <span className="text-sm text-muted-foreground">
          {unresolved
            ? `${unresolved} registros requieren atención`
            : "Confirmá que están cargados todos los cobros y gastos del mes."}
        </span>
        <Button variant="outline" size="sm" onClick={() => setReviewOpen(true)}>
          Revisar registros
        </Button>
        <Button
          size="sm"
          disabled={busy || r.reviewed || month === current || unresolved > 0}
          onClick={() => setConfirmOpen(true)}
        >
          Confirmar mes
        </Button>
      </div>
      {r.result === null && (
        <Alert>
          <AlertDescription>
            Faltan gastos registrados o una confirmación de que este mes no tuvo
            gastos. El resultado y el margen quedan sin calcular.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Cobros netos"
          value={money(r.revenue)}
          detail={`Stripe ${money(r.stripe)} · otros ${money(r.other)}`}
        />
        <Metric
          label="Gastos operativos pagados"
          value={money(r.expenses)}
          detail={`Pendientes de pago: ${money(r.pending)}`}
        />
        <Metric
          label="Resultado operativo"
          value={money(r.result)}
          detail={
            r.reviewed
              ? "Mes revisado"
              : "Provisional: sujeto a revisión de cobertura"
          }
        />
        <Metric
          label="Margen operativo"
          value={r.margin === null ? "—" : `${r.margin.toFixed(1)}%`}
          detail="Resultado / cobros netos"
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Cobros, gastos y resultado</CardTitle>
          <CardDescription>
            Últimos 12 meses hasta {month}. Los importes son los registros
            disponibles; los meses sin revisión son provisionales.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="h-64 w-full">
            <LineChart data={series}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickLine={false} />
              <YAxis tickFormatter={(v) => `$${v / 1000}k`} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {(["revenue", "expenses", "result"] as const).map((key) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={`var(--color-${key})`}
                  dot={false}
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ChartContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Desglose del mes</TableHead>
                <TableHead className="text-right">Importe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Payouts Stripe</TableCell>
                <TableCell className="text-right">{money(r.stripe)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Otros ingresos operativos revisados</TableCell>
                <TableCell className="text-right">{money(r.other)}</TableCell>
              </TableRow>
              {r.categories.map((c) => (
                <TableRow key={c.name}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell className="text-right">{money(c.cents)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>
                  Resultado operativo {r.reviewed ? "" : "(provisional)"}
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {money(r.result)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={() => setDetailOpen(true)}
          >
            Ver historial y origen
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Caja y Profit First</CardTitle>
          <CardDescription>
            Saldos confirmados a su fecha. Las reservas fiscales y los fondos de
            socios se muestran separados de la caja operativa.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric
              label="Caja operativa · Income + OPEX"
              value={money(cash.operating)}
              detail={
                cash.operating === null
                  ? "Falta confirmar saldos a la misma fecha"
                  : `Al ${cash.rows.find((r) => r.account.role === "opex")?.balance?.effective_date}`
              }
            />
            <Metric
              label="Total de las cuentas"
              value={money(cash.total)}
              detail={
                cash.total === null
                  ? "Fechas diferentes o saldos sin confirmar"
                  : `Al ${cash.rows[0]?.balance?.effective_date}`
              }
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuenta</TableHead>
                <TableHead>Fecha confirmada</TableHead>
                <TableHead className="text-right">Saldo USD</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cash.rows.map(({ account, balance }) => (
                <TableRow key={account.id}>
                  <TableCell>
                    {account.label}
                    <p className="text-xs text-muted-foreground">
                      {account.role === "tax"
                        ? "Reserva fiscal"
                        : account.role === "partner"
                          ? "Fondos asignados a socios"
                          : "Operativa"}
                    </p>
                  </TableCell>
                  <TableCell>
                    {balance?.effective_date ?? "Sin confirmar"}
                  </TableCell>
                  <TableCell className="text-right">
                    {money(balance ? Number(balance.amount_cents) : null)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setBalanceAccount(account.id)
                        setBalanceAmount("")
                      }}
                    >
                      Confirmar saldo
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profit First · {month}</TableHead>
                <TableHead className="text-right">Recomendado</TableHead>
                <TableHead className="text-right">
                  Transferencias recibidas*
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.accounts
                .filter((a) => ["opex", "tax", "partner"].includes(a.role))
                .map((a) => {
                  const allocation =
                    a.role === "opex"
                      ? pf.opexCents
                      : a.role === "tax"
                        ? pf.taxCents
                        : pf.partnerACents
                  const incoming = data.bank
                    .filter(
                      (t) =>
                        t.account_id === a.id &&
                        t.txn_date.startsWith(month) &&
                        t.direction === "in" &&
                        ["internal_transfer", "profit_first"].includes(
                          t.flow_class
                        )
                    )
                    .reduce((s, t) => s + Number(t.amount_cents), 0)
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        {a.label} ·{" "}
                        {a.role === "opex"
                          ? "25"
                          : a.role === "tax"
                            ? "15"
                            : "30"}
                        %
                      </TableCell>
                      <TableCell className="text-right">
                        {money(allocation)}
                      </TableCell>
                      <TableCell className="text-right">
                        {data.bank.some(
                          (t) =>
                            t.account_id === a.id &&
                            t.txn_date.startsWith(month)
                        )
                          ? money(incoming)
                          : "Sin extracto"}
                      </TableCell>
                    </TableRow>
                  )
                })}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            *Movimientos internos registrados en la cuenta de destino; no se
            duplican las salidas de Income. Los extractos pueden estar
            incompletos.
          </p>
          <p className="text-sm">
            OPEX frente a gastos pagados:{" "}
            <strong>{money(pf.opexCents - r.expenses)}</strong> · Retiros
            externos de socios: <strong>{money(r.withdrawals)}</strong>
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Negocio actual e histórico de MRR</CardTitle>
          <CardDescription>
            Independiente del mes seleccionado. MRR observado{" "}
            {latest
              ? `al ${new Date(latest.observed_at).toLocaleString("es-ES")}`
              : "pendiente de la primera captura válida"}
            . Operación actualizada al{" "}
            {new Date(data.loadedAt).toLocaleString("es-ES")}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {(!latestAttempt?.valid ||
            !latest ||
            Date.parse(now) - Date.parse(latest.observed_at) >
              36 * 3600000) && (
            <Alert>
              <AlertDescription>
                {latestAttempt?.error ??
                  "Aún no hay una captura válida reciente."}{" "}
                Se conserva la última captura válida, si existe.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric
              label="MRR"
              value={money(latest?.mrr_cents ?? null)}
              detail={`En mora: ${money(latest?.past_due_cents ?? null)}`}
            />
            <Metric
              label="Clientes con MRR positivo"
              value={latest?.paying_clients?.toString() ?? "—"}
            />
            <Metric
              label="ARPU"
              value={money(
                latest?.paying_clients
                  ? Math.round(latest.mrr_cents! / latest.paying_clients)
                  : null
              )}
            />
            <Metric
              label="Clientes activos"
              value={String(data.activeClients)}
            />
            <Metric
              label="Listings activos"
              value={String(data.activeListings)}
            />
          </div>
          {history.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes observado</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">MRR</TableHead>
                  <TableHead className="text-right">
                    Variación entre cierres
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((s, i) => {
                  const m = s.observed_at.slice(0, 7)
                  const end = new Date(
                    Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)
                  )
                    .toISOString()
                    .slice(0, 10)
                  const closed =
                    s.observed_at.slice(0, 10) === end && m < current
                  const prev = history[i - 1]
                  const previousMonth = monthsEnding(m, 2)[0]
                  const previousEnd = new Date(
                    Date.UTC(
                      Number(m.slice(0, 4)),
                      Number(m.slice(5, 7)) - 1,
                      0
                    )
                  )
                    .toISOString()
                    .slice(0, 10)
                  const comparable =
                    closed &&
                    prev?.observed_at.slice(0, 7) === previousMonth &&
                    prev.observed_at.slice(0, 10) === previousEnd
                  return (
                    <TableRow key={s.id}>
                      <TableCell>{m}</TableCell>
                      <TableCell>{s.observed_at.slice(0, 10)}</TableCell>
                      <TableCell>
                        {closed
                          ? "Observado en último día"
                          : m === current
                            ? "Mes parcial"
                            : "Observación, sin cierre"}
                      </TableCell>
                      <TableCell className="text-right">
                        {money(s.mrr_cents)}
                      </TableCell>
                      <TableCell className="text-right">
                        {comparable
                          ? money(s.mrr_cents! - prev.mrr_cents!)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              El histórico empieza con la primera captura válida. No se
              reconstruye el pasado con suscripciones actuales.
            </p>
          )}
          {!!latestAttempt?.details.some((d) => d.reason) && (
            <details>
              <summary className="cursor-pointer text-sm">
                Suscripciones pendientes de revisión
              </summary>
              <Table>
                <TableBody>
                  {latestAttempt.details
                    .filter((d) => d.reason)
                    .map((d) => (
                      <TableRow key={d.subscription_id}>
                        <TableCell>{d.subscription_id}</TableCell>
                        <TableCell>{d.reason}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </details>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={reviewOpen}
        onOpenChange={(open) => {
          setReviewOpen(open)
          if (!open) setSelected(new Set())
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Revisión de {month}</DialogTitle>
            <DialogDescription>
              Los cambios invalidan la confirmación del mes. Revisá también la
              cobertura en Expenses y Bank.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-6 overflow-y-auto">
            {unresolved > 0 && (
              <Alert>
                <AlertDescription>
                  {r.unlinkedExpenses.length} salidas operativas sin gasto
                  enlazado; {r.missingPaymentDates.length} gastos pagados sin
                  fecha; {r.unknown.length} movimientos con clasificación o
                  moneda pendiente. Resolvelos desde Expenses / Bank antes de
                  confirmar.
                </AlertDescription>
              </Alert>
            )}
            <h3 className="font-medium">Otros ingresos</h3>
            {incomeRows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Sin otros ingresos registrados.
              </p>
            )}
            {incomeRows.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-sm">
                  {t.txn_date} · {t.payee ?? "Ingreso"} ·{" "}
                  {money(Number(t.amount_cents))}
                </span>
                <Choice
                  disabled={busy}
                  label={`Clasificar ${t.payee ?? "ingreso"}`}
                  value={t.income_treatment}
                  options={[
                    ["pending", "Pendiente"],
                    ["operating", "Operativo"],
                    ["capital", "Aporte / financiación"],
                    ["transfer", "Transferencia"],
                  ]}
                  onChange={(v) => run(() => reviewIncome(t.id, v))}
                />
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Gastos y distribuciones</h3>
              {expenseRows.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    aria-label="Seleccionar todos los gastos del mes"
                    checked={
                      allSelected
                        ? true
                        : selectedIds.length > 0
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(c) =>
                      setSelected(
                        c === true
                          ? new Set(expenseRows.map((e) => e.id))
                          : new Set()
                      )
                    }
                  />
                  {selectedIds.length > 0
                    ? `${selectedIds.length} seleccionados`
                    : "Seleccionar todos"}
                </label>
              )}
            </div>
            {expenseRows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Sin gastos registrados en el mes.
              </p>
            )}
            {selectedIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-muted/40 p-3">
                <span className="text-sm font-medium">
                  Editar {selectedIds.length}{" "}
                  {selectedIds.length === 1 ? "gasto" : "gastos"}
                </span>
                <Choice
                  className="w-44"
                  disabled={busy}
                  label="Categoría para los gastos seleccionados"
                  placeholder="Categoría…"
                  value=""
                  options={categoryOptions}
                  onChange={(v) =>
                    run(() => reviewExpenses(selectedIds, categoryPatch(v)))
                  }
                />
                <Choice
                  className="w-44"
                  disabled={busy}
                  label="Tratamiento para los gastos seleccionados"
                  placeholder="Tratamiento…"
                  value=""
                  options={treatmentOptions}
                  onChange={(v) =>
                    run(() => reviewExpenses(selectedIds, { treatment: v }))
                  }
                />
                <Button
                  disabled={busy}
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    run(() => reviewExpenses(selectedIds, { confirm: true }))
                  }
                >
                  Confirmar seleccionados
                </Button>
                <Button
                  disabled={busy}
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(new Set())}
                >
                  Limpiar
                </Button>
              </div>
            )}
            {expenseRows.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <label className="flex min-w-0 items-center gap-2 text-sm">
                  <Checkbox
                    aria-label={`Seleccionar ${e.description}`}
                    checked={selected.has(e.id)}
                    onCheckedChange={(c) =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (c === true) next.add(e.id)
                        else next.delete(e.id)
                        return next
                      })
                    }
                  />
                  <span>
                    {e.description} ·{" "}
                    {money(Math.round(Number(e.amount) * 100))}
                    {r.expensePending.some((p) => p.id === e.id) &&
                      " · revisar cuenta de socio"}
                  </span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Choice
                    className="w-44"
                    disabled={busy}
                    label={`Categoría de ${e.description}`}
                    value={e.category_id ?? "none"}
                    options={categoryOptions}
                    onChange={(v) =>
                      run(() => reviewExpenses([e.id], categoryPatch(v)))
                    }
                  />
                  <Choice
                    className="w-44"
                    disabled={busy}
                    label={`Tratamiento de ${e.description}`}
                    value={e.financial_treatment}
                    options={treatmentOptions}
                    onChange={(v) =>
                      run(() => reviewExpenses([e.id], { treatment: v }))
                    }
                  />
                  {!e.financial_reviewed_at && (
                    <Button
                      disabled={busy}
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        run(() => reviewExpenses([e.id], { confirm: true }))
                      }
                    >
                      Confirmar
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar revisión de {month}</DialogTitle>
            <DialogDescription>
              Confirmo que cargué todos los cobros adicionales y gastos del mes,
              revisé las distribuciones a socios y los importes mostrados son
              completos. Cualquier cambio posterior en los registros invalida
              esta revisión.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(
                  () => confirmMonth(month, data.revision),
                  () => setConfirmOpen(false)
                )
              }
            >
              Confirmar revisión
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={balanceAccount !== null}
        onOpenChange={(v) => {
          if (!v) setBalanceAccount(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Confirmar saldo ·{" "}
              {data.accounts.find((a) => a.id === balanceAccount)?.label}
            </DialogTitle>
            <DialogDescription>
              Ingresá el saldo verificado en Relay a esa fecha. Se conserva el
              historial de confirmaciones.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(
                () =>
                  saveAccountBalance(
                    balanceAccount!,
                    balanceDate,
                    Math.round(Number(balanceAmount) * 100)
                  ),
                () => setBalanceAccount(null)
              )
            }}
          >
            <Field>
              <FieldLabel htmlFor="balance-date">Fecha del saldo</FieldLabel>
              <Input
                required
                id="balance-date"
                type="date"
                max={now.slice(0, 10)}
                value={balanceDate}
                onChange={(e) => setBalanceDate(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="balance-amount">Saldo USD</FieldLabel>
              <Input
                required
                id="balance-amount"
                type="number"
                step="0.01"
                value={balanceAmount}
                onChange={(e) => setBalanceAmount(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button disabled={busy} type="submit">
                Guardar saldo confirmado
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Historial y origen</DialogTitle>
            <DialogDescription>
              Stripe: payouts pagados por llegada. Otros ingresos: Bank
              revisado. Gastos: Expenses por fecha de pago. Transferencias
              excluidas.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-6 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Cobros</TableHead>
                  <TableHead>Gastos</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthsEnding(month).map((m) => {
                  const x = monthlyResult(data, m)
                  return (
                    <TableRow key={m}>
                      <TableCell>{m}</TableCell>
                      <TableCell>
                        {x.reviewed ? "Revisado" : "Provisional"}
                      </TableCell>
                      <TableCell>{money(x.revenue)}</TableCell>
                      <TableCell>{money(x.expenses)}</TableCell>
                      <TableCell>{money(x.result)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <h3 className="font-medium">Payouts del mes seleccionado</h3>
            <Table>
              <TableBody>
                {data.payouts
                  .filter(
                    (p) =>
                      p.status === "paid" &&
                      p.currency === "usd" &&
                      p.arrival_date.startsWith(month)
                  )
                  .map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.arrival_date.slice(0, 10)}</TableCell>
                      <TableCell>
                        <a
                          className="underline"
                          href={`https://dashboard.stripe.com/payouts/${p.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {p.id}
                        </a>
                      </TableCell>
                      <TableCell>{money(Number(p.amount_cents))}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
