import { object, str, PRIMARY, SETUP, type Json, type Job } from './core.ts';

export const PRIMARY_PRICE = '6a82cc5ee5be4fc0e73657b8';
export const SETUP_PRICE = '6a88b143ccdd6adc6f5035c8';
export const STRIPE_ACCOUNT = 'acct_1RVotKAN8lUrk5rx';
export type SubscriptionPolicy = { locationId: string; activatedAt: string; links: Record<string, number> };

// All inputs must be freshly read from GHL's authenticated API. Neither a
// redirect nor webhook-provided prices/status/identity can authorize provisioning.
export function verifiedSubscriptionJob(transaction: Json, order: Json, subscription: Json, contact: Json, policy: SubscriptionPolicy): Job | null {
  const source = object(order.source);
  const n = policy.links[str(source.id)];
  if (!Number.isInteger(n) || n < 1 || n > 5 || source.type !== 'payment_link') return null;
  const contactId = str(contact.id), email = str(contact.email).toLowerCase();
  if (!contactId || !email || contact.locationId !== policy.locationId) throw new Error('identity_mismatch');
  for (const record of [transaction, order, subscription]) {
    if (record.altId !== policy.locationId || record.altType !== 'location' || record.liveMode !== true || str(record.currency).toUpperCase() !== 'USD') return null;
    if (record.contactId !== contactId) throw new Error('payment_contact_mismatch');
  }
  const total = n * 350 + 150;
  const paidAt = Date.parse(str(transaction.createdAt)), activatedAt = Date.parse(policy.activatedAt);
  if (!Number.isFinite(paidAt) || !Number.isFinite(activatedAt) || paidAt < activatedAt) return null;
  if (order.status !== 'completed' || order.paymentStatus !== 'paid' || order.amount !== total || transaction.status !== 'succeeded' || transaction.amount !== total || transaction.amountRefunded !== 0) return null;
  if (subscription.status !== 'active' || subscription.amount !== n * 350 || !/^sub_[a-zA-Z0-9]+$/.test(str(subscription.subscriptionId))) return null;
  if (transaction.entityType !== 'order' || transaction.entityId !== order._id || transaction.entitySourceType !== 'payment_link' || transaction.entitySourceId !== source.id || transaction.paymentProviderType !== 'stripe' || transaction.paymentProviderConnectedAccount !== STRIPE_ACCOUNT) return null;
  const subscriptionSource = object(subscription.entitySource), provider = object(subscription.paymentProvider), account = object(provider.connectedAccount);
  if (subscription.entityType !== 'order' || subscription.entityId !== order._id || subscriptionSource.type !== 'payment_link' || subscriptionSource.id !== source.id || provider.type !== 'stripe' || account.accountId !== STRIPE_ACCOUNT || account.liveMode !== true) return null;
  if (str(transaction.contactEmail).toLowerCase() !== email || str(object(subscription.contactSnapshot).email).toLowerCase() !== email || str(object(order.contactSnapshot).email).toLowerCase() !== email) throw new Error('email_mismatch');
  if (transaction.subscriptionId !== subscription.subscriptionId) return null;
  if (!Array.isArray(order.items) || order.items.length !== 2) return null;
  const items = order.items.map(object);
  const service = items.find(i => object(i.product)._id === PRIMARY);
  const setup = items.find(i => object(i.product)._id === SETUP);
  if (!service || !setup || service.qty !== n || setup.qty !== 1) return null;
  const recurring = object(service.price), fee = object(setup.price);
  if (recurring._id !== PRIMARY_PRICE || recurring.amount !== 350 || recurring.type !== 'recurring' || fee._id !== SETUP_PRICE || fee.amount !== 150 || fee.type !== 'one_time') return null;
  if (object(recurring.recurring).interval !== 'month' || object(recurring.recurring).intervalCount !== 1 || (recurring.setupFee && recurring.setupFee !== 0) || (recurring.trialPeriod && recurring.trialPeriod !== 0)) return null;
  const subscribed = object(subscription.recurringProduct);
  if (object(subscribed.product)._id !== PRIMARY || object(subscribed.price)._id !== PRIMARY_PRICE || subscribed.qty !== n) return null;
  const charge = object(transaction.chargeSnapshot);
  if (charge.object !== 'payment_intent' || charge.status !== 'succeeded' || charge.livemode !== true || charge.currency !== 'usd' || charge.amount_received !== total * 100 || charge.setup_future_usage !== 'off_session') return null;
  const method = object(charge.payment_method);
  if (method.type !== 'card' || method.livemode !== true || !str(method.id) || method.customer !== charge.customer) return null;
  const invoiceId = str(charge.invoice);
  if (!/^in_[a-zA-Z0-9]+$/.test(invoiceId)) return null;
  const stripe = object(subscription.subscriptionSnapshot);
  if (stripe.id !== transaction.subscriptionId || stripe.status !== 'active' || stripe.livemode !== true || stripe.collection_method !== 'charge_automatically' || stripe.customer !== charge.customer || stripe.default_payment_method !== method.id || stripe.cancel_at_period_end === true || stripe.cancel_at || stripe.pause_collection || stripe.trial_end) return null;
  const stripeItems = object(stripe.items);
  if (stripeItems.has_more || !Array.isArray(stripeItems.data) || stripeItems.data.length !== 1) return null;
  const stripeItem = object(stripeItems.data[0]), stripePrice = object(stripeItem.price);
  if (stripeItem.quantity !== n || stripePrice.unit_amount !== 35000 || stripePrice.currency !== 'usd' || object(stripePrice.recurring).interval !== 'month' || object(stripePrice.recurring).interval_count !== 1) return null;
  const firstInvoice = object(stripe.latest_invoice);
  if (firstInvoice.id !== invoiceId || firstInvoice.billing_reason !== 'subscription_create' || firstInvoice.status !== 'paid' || firstInvoice.amount_paid !== total * 100 || firstInvoice.amount_remaining !== 0) return null;
  // Only the matching completed-agreement workflow adds this internal tag.
  // A differently-sized agreement or a checkout-only purchase cannot qualify.
  const tags = Array.isArray(contact.tags) ? contact.tags.map(str) : [];
  const signed = tags.filter(tag => /^rf-subscription-agreement-q[1-5]-signed$/.test(tag));
  if (signed.length !== 1 || signed[0] !== `rf-subscription-agreement-q${n}-signed`) throw new Error('signed_agreement_not_verified');
  const fields = Array.isArray(contact.customFields) ? contact.customFields.map(object) : [];
  const legalName = str(fields.find(f => f.id === 'SQ0wwhLhD8qZVymkHslW')?.value);
  const givenName = str(contact.firstName), familyName = str(contact.lastName);
  if (!legalName || !givenName || !familyName) throw new Error('missing_client_details');
  return { invoiceId, contactId, email, givenName, familyName, legalName, listings: n,
    subscriptionPayment: { transactionId: str(transaction._id), orderId: str(order._id), subscriptionId: str(subscription._id) } };
}
