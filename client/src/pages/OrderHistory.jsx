import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyOrders } from '../api';

export default function OrderHistory() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMyOrders()
      .then(setOrders)
      .catch(() => setError('Could not load your orders.'));
  }, []);

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!orders) {
    return <p>Loading orders…</p>;
  }

  if (orders.length === 0) {
    return (
      <p>
        You haven't placed any orders yet. <Link to="/">Browse products</Link>.
      </p>
    );
  }

  return (
    <div className="order-history">
      <h2>Your orders</h2>
      {orders.map((order) => (
        <div key={order.orderId} className="order-card">
          <div className="order-card-header">
            <span>Order {order.orderId}</span>
            <span>{new Date(order.createdAt).toLocaleString()}</span>
          </div>
          {order.items.map((item) => (
            <div key={item.product} className="checkout-row">
              <span>
                {item.name} × {item.quantity}
              </span>
              <span>${(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <p className="cart-total">Total: ${order.total.toFixed(2)}</p>
        </div>
      ))}
    </div>
  );
}
