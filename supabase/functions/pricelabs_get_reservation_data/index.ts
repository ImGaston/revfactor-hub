import { createClient } from "jsr:@supabase/supabase-js@2";

const TABLE_NAME = "pricelabs_reservations_airbnb";
const DEFAULT_BASE_URL = "https://api.pricelabs.co";
const DEFAULT_PAGE_LIMIT = 100;

Deno.serve(async (req) => {
  try {
    const serverKey = Deno.env.get("REVFACTOR_PRICELABS_SECRET_KEY");
    if (!serverKey || !serverKey.startsWith("sb_secret_")) return jsonResponse({error:"Edge credentials unavailable"},503);
    const presented = req.headers.get("apikey") || "";
    const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
    const [expected,received] = await Promise.all([hash(serverKey),hash(presented)]);
    let difference = 0; for (let i=0;i<expected.length;i++) difference |= expected[i]^received[i];
    if (difference !== 0) return jsonResponse({error:"Unauthorized"},401);
    if (req.method !== "POST") {
      return jsonResponse({ error: "Use POST method only." }, 405);
    }

    const body = await req.json().catch(() => null);

    if (!body) {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const pms = stringOrNull(body.pms);
    let startDate = stringOrNull(body.start_date);
    let endDate = stringOrNull(body.end_date);
    const rollingDays = toPositiveInteger(body.rolling_days);

    if (!pms) {
      return jsonResponse({ error: "Missing required field: pms" }, 400);
    }

    // Auto mode:
    // If start_date is not provided, use rolling_days and default end_date = today (UTC)
    if (!endDate) {
      endDate = getUtcDateString(new Date());
    }

    if (!startDate) {
      if (!rollingDays) {
        return jsonResponse(
          {
            error:
              "Provide either start_date + end_date, or pms + rolling_days.",
          },
          400
        );
      }

      const end = parseDateOnly(endDate);
      if (!end) {
        return jsonResponse(
          { error: "Invalid end_date. Expected format: YYYY-MM-DD" },
          400
        );
      }

      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - rollingDays);
      startDate = getUtcDateString(start);
    }

    if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate)) {
      return jsonResponse(
        { error: "start_date and end_date must be in YYYY-MM-DD format." },
        400
      );
    }

    if (startDate > endDate) {
      return jsonResponse(
        { error: "start_date cannot be later than end_date." },
        400
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = serverKey;
    const pricelabsApiKey = Deno.env.get("PRICELABS_API_KEY");
    const pricelabsBaseUrl =
      Deno.env.get("PRICELABS_API_BASE_URL") || DEFAULT_BASE_URL;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse(
        {
          error: "Edge database configuration unavailable.",
        },
        500
      );
    }

    if (!pricelabsApiKey) {
      return jsonResponse(
        { error: "Missing PRICELABS_API_KEY secret." },
        500
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{fetch:(input,init)=>{const headers=new Headers(init?.headers);if(headers.get("authorization")===`Bearer ${supabaseServiceRoleKey}`)headers.delete("authorization");return fetch(input,{...init,headers});}}
    });

    let offset = 0;
    let hasNextPage = true;
    let totalProcessed = 0;
    let totalPages = 0;

    while (hasNextPage) {
      const url = new URL("/v1/reservation_data", pricelabsBaseUrl);
      url.searchParams.set("pms", pms);
      url.searchParams.set("start_date", startDate);
      url.searchParams.set("end_date", endDate);
      url.searchParams.set("limit", String(DEFAULT_PAGE_LIMIT));
      url.searchParams.set("offset", String(offset));

      const apiResponse = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-API-Key": pricelabsApiKey,
          Accept: "application/json",
        },
      });

      const responseText = await apiResponse.text();

      if (!apiResponse.ok) {
        return jsonResponse(
          {
            error: `PriceLabs API error: ${apiResponse.status}`,
            details: "Sensitive diagnostics suppressed",
          },
          500
        );
      }

      let payload: any;
      try {
        payload = JSON.parse(responseText);
      } catch (err) {
        return jsonResponse(
          {
            error: "Failed to parse PriceLabs response as JSON.",
            details: "Sensitive diagnostics suppressed",
          },
          500
        );
      }

      const items = Array.isArray(payload?.data) ? payload.data : [];

      const rows = items
        .filter((item: any) => item?.reservation_id)
        .map((item: any) => ({
          pms: payload?.pms ?? pms,
          listing_id: stringOrNull(item?.listing_id),
          listing_name: stringOrNull(item?.listing_name),
          reservation_id: String(item.reservation_id),

          check_in: toDateOnlyOrNull(item?.check_in),
          check_out: toDateOnlyOrNull(item?.check_out),
          booking_status: stringOrNull(item?.booking_status),
          booked_date: toDateOnlyOrNull(item?.booked_date),
          cancelled_on: toDateOnlyOrNull(item?.cancelled_on),

          rental_revenue: toNumber(item?.rental_revenue),
          total_cost: toNumber(item?.total_cost),
          no_of_days: toNumber(item?.no_of_days),
          cleaning_fees: toNumber(item?.cleaning_fees),

          currency: stringOrNull(item?.currency),
          min_price_type: stringOrNull(item?.min_price_type),
          booking_channel: stringOrNull(item?.booking_channel),
          channel_confirmation_code:
            stringOrNull(item?.channelConfirmationCode) ??
            stringOrNull(item?.channel_confirmation_code),

          raw: item,
          fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from(TABLE_NAME)
          .upsert(rows, { onConflict: "pms,reservation_id" });

        if (error) {
          return jsonResponse(
            {
              error: "Supabase upsert failed.",
              details: "Sensitive diagnostics suppressed",
            },
            500
          );
        }
      }

      totalProcessed += rows.length;
      totalPages += 1;
      hasNextPage = Boolean(payload?.next_page);
      offset += DEFAULT_PAGE_LIMIT;
    }

    return jsonResponse({
      success: true,
      table_name: TABLE_NAME,
      pms,
      start_date: startDate,
      end_date: endDate,
      rolling_days: rollingDays || null,
      total_processed: totalProcessed,
      total_pages: totalPages,
    });
  } catch (err) {
    return jsonResponse(
      {
        error: "Unexpected error.",
        details: "Sensitive diagnostics suppressed",
      },
      500
    );
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function toDateOnlyOrNull(value: unknown): string | null {
  const s = stringOrNull(value);
  if (!s) return null;

  // If the API returns full datetime, keep only YYYY-MM-DD
  const candidate = s.slice(0, 10);
  return isValidDateOnly(candidate) ? candidate : null;
}

function isValidDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDateOnly(value: string): Date | null {
  if (!isValidDateOnly(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}