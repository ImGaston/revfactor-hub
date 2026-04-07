# Integración: Landing Page → Pipeline (Webhook)

## Objetivo

Cuando un prospecto agenda una llamada desde la landing page (otro repositorio), se crea automáticamente un lead en el pipeline del Hub con stage `inquiry` y toda la información que completó el cliente.

---

## Arquitectura

```
Landing Page (otro repo)          RevFactor Hub
┌─────────────────────┐           ┌──────────────────────────────┐
│                     │           │                              │
│  Formulario de      │  POST     │  /api/webhooks/new-lead      │
│  agendar llamada    │ ────────► │  (Route Handler)             │
│                     │  JSON     │                              │
│                     │           │  1. Valida API key            │
└─────────────────────┘           │  2. Valida campos             │
                                  │  3. Inserta lead en Supabase  │
                                  │  4. Responde 201              │
                                  └──────────────────────────────┘
```

---

## Parte 1: Cambios en RevFactor Hub

### Instrucciones para Claude Code

Abrir el repo `revfactor-hub` y pedir:

```
Necesito crear un webhook endpoint para recibir leads desde la landing page.

Crear: app/api/webhooks/new-lead/route.ts

El endpoint debe:

1. Ser un POST route handler (App Router)
2. Autenticación via header `x-webhook-secret` que se compara contra
   una env var WEBHOOK_SECRET (NO usa Supabase Auth, es server-to-server)
3. Usar el admin client (lib/supabase/admin.ts) para insertar el lead
   ya que no hay sesión de usuario autenticado
4. Aceptar este JSON body:

{
  "project_name": "string (required — nombre del proyecto o propiedad)",
  "full_name": "string (required — nombre completo del prospecto)",
  "email": "string (required)",
  "phone": "string (optional)",
  "lead_source": "string (optional, default: 'landing_page')",
  "scheduled_date": "string ISO 8601 (optional — fecha/hora de la call)",
  "timezone": "string (optional — ej: 'America/New_York')",
  "location": "string (optional — ciudad o mercado del prospecto)",
  "description": "string (optional — notas o mensaje del prospecto)"
}

5. Insertar en la tabla `leads` con:
   - stage: 'inquiry'
   - sort_order: calcular como MAX(sort_order) + 1 donde stage = 'inquiry'
   - service_type: null (se clasifica después manualmente)
   - created_by: null (no hay usuario Hub asociado)
   - Los demás campos del body mapeados directamente

6. Respuestas HTTP:
   - 201: { success: true, lead_id: "uuid" }
   - 400: { error: "mensaje de validación" }
   - 401: { error: "Unauthorized" } si falta o no coincide el secret
   - 500: { error: "Internal server error" }

7. Validaciones:
   - project_name, full_name y email son required
   - email debe tener formato válido (regex básico)
   - scheduled_date si viene debe ser ISO 8601 válido

8. NO usar revalidatePath (es una API route, no server action).
   Los usuarios del Hub verán el nuevo lead al recargar o navegar al pipeline.

9. Agregar WEBHOOK_SECRET a .env.local (generar un valor random seguro).

10. Opcional: loggear en console.log el lead creado para debugging.
```

### Env var nueva

Agregar en `.env.local` y en Vercel:

```
WEBHOOK_SECRET=generar-un-string-random-seguro-de-64-chars
```

Generar con: `openssl rand -hex 32`

---

## Parte 2: Cambios en el Repo de la Landing Page

### Instrucciones para Claude Code

Abrir el repo de la landing page y pedir:

```
Después de que el usuario completa el formulario de agendar llamada
y se confirma la reserva (o se envía el form, según el flujo actual),
necesito hacer un POST al webhook del Hub para crear el lead automáticamente.

Crear una función utilitaria (por ejemplo lib/hub-webhook.ts o utils/create-lead.ts)
que haga lo siguiente:

1. POST a la URL del Hub:
   - Producción: https://hub.revfactor.io/api/webhooks/new-lead
   - La URL debe venir de una env var: NEXT_PUBLIC_HUB_WEBHOOK_URL
     o HUB_WEBHOOK_URL (sin NEXT_PUBLIC_ si se llama desde server-side)

2. Headers:
   - Content-Type: application/json
   - x-webhook-secret: valor de env var WEBHOOK_SECRET
     (debe ser el MISMO valor que tiene el Hub)

3. Body JSON con los campos del formulario mapeados:
   {
     "project_name": nombre de la propiedad o del prospecto,
     "full_name": nombre completo,
     "email": email,
     "phone": teléfono (si lo tiene el form),
     "lead_source": "landing_page",
     "scheduled_date": fecha y hora de la call en ISO 8601,
     "timezone": timezone del prospecto,
     "location": mercado o ciudad,
     "description": cualquier nota o mensaje que haya dejado
   }

4. El fetch debe ser server-side (desde un server action, API route,
   o server component). NUNCA exponer el WEBHOOK_SECRET en el browser.

5. Si el fetch falla, loggear el error pero NO bloquear el flujo
   del usuario. La agenda de la llamada es lo prioritario;
   la creación del lead en el Hub es best-effort.

6. Usar try/catch y un timeout de 5 segundos en el fetch
   para no bloquear si el Hub está caído.

Integrar esta función en el flujo existente de confirmación
de llamada agendada (después de que la reserva se confirma
exitosamente).
```

### Env vars nuevas en la landing page

```
HUB_WEBHOOK_URL=https://hub.revfactor.io/api/webhooks/new-lead
WEBHOOK_SECRET=el-mismo-valor-que-en-el-hub
```

---

## Parte 3: Ejemplo del Route Handler (referencia)

Este es el patrón esperado del endpoint en el Hub — para que Claude Code tenga contexto:

```typescript
// app/api/webhooks/new-lead/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function POST(request: NextRequest) {
  // 1. Auth
  const secret = request.headers.get("x-webhook-secret")
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 2. Parse + validate body
  const body = await request.json()
  const { project_name, full_name, email } = body

  if (!project_name || !full_name || !email) {
    return NextResponse.json(
      { error: "project_name, full_name, and email are required" },
      { status: 400 }
    )
  }

  // 3. Insert lead via admin client (bypasses RLS)
  const supabase = createAdminClient()

  const { data: maxOrder } = await supabase
    .from("leads")
    .select("sort_order")
    .eq("stage", "inquiry")
    .order("sort_order", { ascending: false })
    .limit(1)
    .single()

  const sort_order = (maxOrder?.sort_order ?? -1) + 1

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      project_name,
      full_name,
      email,
      phone: body.phone || null,
      lead_source: body.lead_source || "landing_page",
      scheduled_date: body.scheduled_date || null,
      timezone: body.timezone || null,
      location: body.location || null,
      description: body.description || null,
      stage: "inquiry",
      sort_order,
      created_by: null,
    })
    .select("id")
    .single()

  if (error) {
    console.error("Webhook new-lead error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log("New lead created via webhook:", lead.id)
  return NextResponse.json({ success: true, lead_id: lead.id }, { status: 201 })
}
```

---

## Parte 4: Testing

### Probar el webhook localmente

Antes de deployar, probar con curl:

```bash
# Desde la terminal, con el Hub corriendo en localhost:3000
curl -X POST http://localhost:3000/api/webhooks/new-lead \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: TU_WEBHOOK_SECRET" \
  -d '{
    "project_name": "Test Property Miami",
    "full_name": "Juan Pérez",
    "email": "juan@test.com",
    "phone": "+1234567890",
    "lead_source": "landing_page",
    "scheduled_date": "2026-04-10T15:00:00Z",
    "timezone": "America/New_York",
    "location": "Miami, FL",
    "description": "Tengo 3 propiedades en Miami Beach"
  }'
```

Respuesta esperada:
```json
{ "success": true, "lead_id": "uuid-del-lead" }
```

Después abrir `/pipeline` en el Hub y verificar que el lead aparece en la columna Inquiry.

### Probar casos de error

```bash
# Sin secret → 401
curl -X POST http://localhost:3000/api/webhooks/new-lead \
  -H "Content-Type: application/json" \
  -d '{"project_name": "Test"}'

# Sin campos requeridos → 400
curl -X POST http://localhost:3000/api/webhooks/new-lead \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: TU_WEBHOOK_SECRET" \
  -d '{"phone": "123"}'
```

---

## Parte 5: Deploy

1. **Hub (Vercel):** agregar `WEBHOOK_SECRET` en Settings → Environment Variables
2. **Landing page:** agregar `HUB_WEBHOOK_URL` y `WEBHOOK_SECRET` en las env vars del hosting
3. Deployar el Hub primero, verificar que el endpoint responde
4. Deployar la landing page con la integración

---

## Checklist

- [ ] Route handler creado en `app/api/webhooks/new-lead/route.ts`
- [ ] `WEBHOOK_SECRET` configurado en `.env.local` del Hub
- [ ] Función de webhook creada en el repo de la landing page
- [ ] `HUB_WEBHOOK_URL` y `WEBHOOK_SECRET` configurados en la landing page
- [ ] Testeado con curl localmente
- [ ] Env vars agregadas en Vercel (Hub) y hosting de la landing page
- [ ] Probado end-to-end: agendar call → lead aparece en pipeline
