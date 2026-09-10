export type Json = Record<string, unknown>;
export function object(v: unknown): Json {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('invalid_object');
  return v as Json;
}
export function str(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
export function invoiceIdFromPayload(custom: Json): string {
  const direct = str(custom.invoice_id);
  if (direct) return direct;
  try { return new URL(str(custom.invoice_url)).pathname.match(/\/invoice\/([a-zA-Z0-9]{10,40})\/?$/)?.[1] ?? ''; }
  catch { return ''; }
}
export const PRIMARY = '6a82cc5ee5be4fc0e73657ae';
export const SETUP = '6a88b142ccdd6adc6f5035c0';
export type Job = { invoiceId: string; contactId: string; email: string; givenName: string; familyName: string; legalName: string; listings: number };
export function eligibleInvoice(invoice: Json, contactId: string, locationId: string, activatedAt: string): number | null {
  if (invoice.altId !== locationId || invoice.altType !== 'location' || invoice.liveMode !== true || invoice.status !== 'paid' || invoice.currency !== 'USD') return null;
  if (object(invoice.contactDetails).id !== contactId) throw new Error('invoice_contact_mismatch');
  const paidAt = Date.parse(str(invoice.lastPaidAt));
  if (!Number.isFinite(paidAt) || paidAt < Date.parse(activatedAt)) return null;
  if (!Array.isArray(invoice.invoiceItems) || invoice.invoiceItems.length !== 2) return null;
  const items = invoice.invoiceItems.map(object);
  const service = items.find(i => i.productId === PRIMARY);
  const setup = items.find(i => i.productId === SETUP);
  if (!service || !setup || service.amount !== 350 || setup.amount !== 150 || setup.qty !== 1) return null;
  const n = service.qty;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 5) return null;
  const total = 350 * n + 150;
  if (invoice.total !== total || invoice.amountPaid !== total || invoice.amountDue !== 0) return null;
  return n;
}
export function verifiedJob(invoice: Json, contact: Json, invoiceId: string, locationId: string, activatedAt: string): Job | null {
  const contactId = str(contact.id);
  if (contact.locationId !== locationId || invoice._id !== invoiceId) throw new Error('identity_mismatch');
  const listings = eligibleInvoice(invoice, contactId, locationId, activatedAt);
  if (!listings) return null;
  const email = str(contact.email).toLowerCase();
  if (!email || email !== str(object(invoice.contactDetails).email).toLowerCase()) throw new Error('email_mismatch');
  const fields = Array.isArray(contact.customFields) ? contact.customFields.map(object) : [];
  const legalName = str(fields.find(f => f.id === 'SQ0wwhLhD8qZVymkHslW')?.value);
  const givenName = str(contact.firstName), familyName = str(contact.lastName);
  if (!legalName || !givenName || !familyName) throw new Error('missing_client_details');
  return {invoiceId,contactId,email,givenName,familyName,legalName,listings};
}
export type State = { job: Job; stage: 'queued'|'company_pending'|'company_ready'|'client_pending'|'linked'|'hub_linked'|'complete'|'review'; companyId?: string; clientId?: string; hubClientId?: string; attempts: number; error?: string; updatedAt: string };
export type Ports = {
  save(s: State): Promise<void>;
  find(email: string): Promise<Json[]>;
  company(name: string): Promise<Json>;
  client(job: Job, companyId: string): Promise<Json>;
  hub(s: State): Promise<string>;
  mark(contactId: string): Promise<void>;
};
// Persist intent before a create call. If its outcome is unknown, reconcile by email
// or stop for review; never blindly repeat a company/client POST.
export async function advance(s: State, p: Ports): Promise<State> {
  if ((s.stage === 'complete' && s.hubClientId) || s.stage === 'review') return s;
  if (!s.clientId) {
    const matches = await p.find(s.job.email);
    if (matches.length > 1 || matches.some(c => str(c.email).toLowerCase() !== s.job.email)) throw new Error('assembly_identity_conflict');
    if (matches.length === 1) {
      if (!str(matches[0].id)) throw new Error('invalid_assembly_client');
      s.clientId = str(matches[0].id);
      const companies = Array.isArray(matches[0].companyIds) ? matches[0].companyIds.filter(c=>typeof c==='string') : [];
      s.companyId = companies.length===1 ? str(companies[0]) : (companies.length===0 ? str(matches[0].companyId)||undefined : undefined);
      s.stage = 'linked';
      await p.save(s);
    } else {
      if (s.stage === 'company_pending' || s.stage === 'client_pending') throw new Error('ambiguous_create_requires_review');
      if (!s.companyId) {
        s.stage = 'company_pending'; await p.save(s);
        const company = await p.company(s.job.legalName);
        if (!str(company.id)) throw new Error('invalid_assembly_company');
        s.companyId = str(company.id); s.stage = 'company_ready'; await p.save(s);
      }
      s.stage = 'client_pending'; await p.save(s);
      const client = await p.client(s.job, s.companyId);
      if (!str(client.id) || str(client.email).toLowerCase() !== s.job.email) throw new Error('invalid_assembly_client');
      s.clientId = str(client.id); s.stage = 'linked'; await p.save(s);
    }
  }
  if (!s.hubClientId) {
    s.hubClientId=await p.hub(s);
    if(!s.hubClientId) throw new Error('hub_missing_client_id');
    s.stage='hub_linked'; await p.save(s);
  }
  await p.mark(s.job.contactId);
  s.stage = 'complete'; delete s.error; await p.save(s);
  return s;
}
