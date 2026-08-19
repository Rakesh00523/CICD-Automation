import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { submitCheckout } from '../api';

export default function Checkout() {
  const { items, total, clearCart } = useCart();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const placeOrder = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload = items.map(({ productId, quantity }) => ({ productId, quantity }));
      const result = await submitCheckout(payload);
      setOrder(result);
      clearCart();
    } catch (err) {
      setError(err.response?.data?.message || 'Checkout failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (order) {
    return (
      <div className="order-confirmation">
        <h2>Order confirmed</h2>
        <p>Order ID: {order.orderId}</p>
        <p>Total: ${order.total.toFixed(2)}</p>
        <p>
          <Link to="/">Continue shopping</Link>
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p>
        Your cart is empty. <Link to="/">Browse products</Link>.
      </p>
    );
  }

  return (
    <div className="checkout">
      <h2>Review order</h2>
      {items.map((item) => (
        <div key={item.productId} className="checkout-row">
          <span>
            {item.name} × {item.quantity}
          </span>
          <span>${(item.price * item.quantity).toFixed(2)}</span>
        </div>
      ))}
      <p className="cart-total">Total: ${total.toFixed(2)}</p>
      <p className="notice">This is a mock checkout — no real payment is processed.</p>
      {error && <p className="error">{error}</p>}
      <button onClick={placeOrder} disabled={submitting}>
        {submitting ? 'Placing order…' : 'Place order'}
      </button>
    </div>
  );
}
