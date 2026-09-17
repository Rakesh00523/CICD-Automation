import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrderHistory from './OrderHistory';

const { fetchMyOrders } = vi.hoisted(() => ({ fetchMyOrders: vi.fn() }));
vi.mock('../api', () => ({ fetchMyOrders }));

function renderOrderHistory() {
  return render(
    <MemoryRouter>
      <OrderHistory />
    </MemoryRouter>
  );
}

describe('OrderHistory', () => {
  beforeEach(() => {
    fetchMyOrders.mockReset();
  });

  it('shows an empty state when there are no orders', async () => {
    fetchMyOrders.mockResolvedValue([]);
    renderOrderHistory();

    expect(await screen.findByText(/haven't placed any orders/i)).toBeInTheDocument();
  });

  it('renders past orders with their items and total', async () => {
    fetchMyOrders.mockResolvedValue([
      {
        orderId: 'o1',
        items: [{ product: 'p1', name: 'Widget', price: 10, quantity: 2 }],
        total: 20,
        createdAt: new Date().toISOString(),
      },
    ]);
    renderOrderHistory();

    expect(await screen.findByText(/Widget × 2/)).toBeInTheDocument();
    expect(screen.getByText('Total: $20.00')).toBeInTheDocument();
  });

  it('shows an error message when the request fails', async () => {
    fetchMyOrders.mockRejectedValue(new Error('network error'));
    renderOrderHistory();

    expect(await screen.findByText('Could not load your orders.')).toBeInTheDocument();
  });
});
