// Fake payment gateway for demo purposes: no real money moves. Deliberately
// mirrors Stripe's published test-card convention (same well-known numbers,
// same decline semantics) so the success/decline paths are reproducible and
// recognizable rather than arbitrary made-up rules.
const crypto = require('crypto');

const DECLINE_CARDS = {
  '4000000000000002': 'Card declined: insufficient funds',
  '4000000000000069': 'Card declined: expired card',
};

const CARD_NUMBER_RE = /^\d{16}$/;
const EXPIRY_RE = /^(0[1-9]|1[0-2])\/(\d{2})$/;
const CVC_RE = /^\d{3}$/;

function isExpiryInFuture(month, year) {
  const expiry = new Date(2000 + Number(year), Number(month), 1); // first day of the month *after* expiry
  return expiry.getTime() > Date.now();
}

function validateCard({ cardNumber, expiry, cvc }) {
  if (typeof cardNumber !== 'string' || !CARD_NUMBER_RE.test(cardNumber)) {
    return 'Invalid card number';
  }
  const expiryMatch = typeof expiry === 'string' && expiry.match(EXPIRY_RE);
  if (!expiryMatch) {
    return 'Invalid expiry date';
  }
  if (!isExpiryInFuture(expiryMatch[1], expiryMatch[2])) {
    return 'Card has expired';
  }
  if (typeof cvc !== 'string' || !CVC_RE.test(cvc)) {
    return 'Invalid CVC';
  }
  return null;
}

// Small fixed delay so this reads as a real network call to a gateway
// rather than a synchronous stub.
const SIMULATED_LATENCY_MS = 300;

async function charge({ cardNumber, expiry, cvc }, amount) {
  const validationError = validateCard({ cardNumber, expiry, cvc });
  await new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS));

  if (validationError) {
    return { approved: false, reason: validationError };
  }

  const declineReason = DECLINE_CARDS[cardNumber];
  if (declineReason) {
    return { approved: false, reason: declineReason };
  }

  return {
    approved: true,
    // crypto.randomUUID(), not Math.random() -- this becomes a persisted
    // transaction identifier, which SonarCloud correctly flags as a
    // security-sensitive use of a non-cryptographic PRNG (S2245).
    transactionId: `txn_${crypto.randomUUID()}`,
    cardLast4: cardNumber.slice(-4),
    amount,
  };
}

module.exports = { charge, validateCard };
