const paymentGateway = require('../src/services/paymentGateway');

const validCard = { cardNumber: '4242424242424242', expiry: '12/99', cvc: '123' };

describe('paymentGateway.charge', () => {
  it('approves the well-known success test card', async () => {
    const result = await paymentGateway.charge(validCard, 50);

    expect(result.approved).toBe(true);
    expect(result.transactionId).toEqual(expect.any(String));
    expect(result.cardLast4).toBe('4242');
  });

  it('declines the insufficient-funds test card', async () => {
    const result = await paymentGateway.charge({ ...validCard, cardNumber: '4000000000000002' }, 50);

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/insufficient funds/i);
  });

  it('declines the expired-card test card', async () => {
    const result = await paymentGateway.charge({ ...validCard, cardNumber: '4000000000000069' }, 50);

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it('rejects a malformed card number before charging', async () => {
    const result = await paymentGateway.charge({ ...validCard, cardNumber: '1234' }, 50);

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/invalid card number/i);
  });

  it('rejects an expiry date already in the past', async () => {
    const result = await paymentGateway.charge({ ...validCard, expiry: '01/20' }, 50);

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it('rejects a malformed CVC', async () => {
    const result = await paymentGateway.charge({ ...validCard, cvc: '12' }, 50);

    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/invalid cvc/i);
  });
});
