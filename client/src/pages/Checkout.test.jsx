import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Checkout from './Checkout';
import { CartProvider } from '../context/CartContext';

const { submitCheckout } = vi.hoisted(() => ({ submitCheckout: vi.fn() }));
vi.mock('../api', () => ({ submitCheckout }));

function seedCart(items) {
  localStorage.setItem('shoppipe.cart', JSON.stringify(items));
}

function renderCheckout() {
  return render(
    <MemoryRouter>
      <CartProvider>
        <Checkout />
      </CartProvider>
    </MemoryRouter>
  );
}

function fillPaymentForm({ cardNumber, expiry, cvc }) {
  fireEvent.change(screen.getByLabelText(/card number/i), { target: { value: cardNumber } });
  fireEvent.change(screen.getByLabelText(/expiry/i), { target: { value: expiry } });
  fireEvent.change(screen.getByLabelText(/cvc/i), { target: { value: cvc } });
}

describe('Checkout', () => {
  beforeEach(() => {
    localStorage.clear();
    submitCheckout.mockReset();
  });

  it('shows an empty-cart message when there is nothing to check out', () => {
    renderCheckout();

    expect(screen.getByText(/cart is empty/i)).toBeInTheDocument();
  });

  it('submits the cart and payment details, then shows the confirmation', async () => {
    seedCart([{ productId: 'p1', name: 'Widget', price: 10, quantity: 2 }]);
    submitCheckout.mockResolvedValue({
      orderId: 'o1',
      total: 20,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    });

    renderCheckout();
    fillPaymentForm({ cardNumber: '4242424242424242', expiry: '12/99', cvc: '123' });
    fireEvent.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(screen.getByText('Order confirmed')).toBeInTheDocument());
    expect(submitCheckout).toHaveBeenCalledWith(
      [{ productId: 'p1', quantity: 2 }],
      { cardNumber: '4242424242424242', expiry: '12/99', cvc: '123' }
    );
  });

  it('shows the gateway decline reason on a 402 response', async () => {
    seedCart([{ productId: 'p1', name: 'Widget', price: 10, quantity: 1 }]);
    submitCheckout.mockRejectedValue({ response: { data: { message: 'Card declined: insufficient funds' } } });

    renderCheckout();
    fillPaymentForm({ cardNumber: '4000000000000002', expiry: '12/99', cvc: '123' });
    fireEvent.click(screen.getByRole('button', { name: /place order/i }));

    expect(await screen.findByText('Card declined: insufficient funds')).toBeInTheDocument();
  });
});
