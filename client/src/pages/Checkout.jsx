import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { submitCheckout } from '../api';

const initialPayment = { cardNumber: '', expiry: '', cvc: '' };

export default function Checkout() {
  const { items, total, clearCart } = useCart();
  const [payment, setPayment] = useState(initialPayment);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const updatePaymentField = (field) => (e) => setPayment({ ...payment, [field]: e.target.value });

  const placeOrder = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = items.map(({ productId, quantity }) => ({ productId, quantity }));
      const result = await submitCheckout(payload, payment);
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
    <form className="checkout" onSubmit={placeOrder}>
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

      <h3>Payment</h3>
      <p className="notice">
        Fake payment gateway — use 4242 4242 4242 4242 to succeed, or 4000 0000 0000 0002 /
        4000 0000 0000 0069 to see a simulated decline. No real payment is processed.
      </p>
      <label>
        Card number
        <input
          value={payment.cardNumber}
          onChange={updatePaymentField('cardNumber')}
          placeholder="4242424242424242"
          maxLength={16}
          required
        />
      </label>
      <label>
        Expiry (MM/YY)
        <input
          value={payment.expiry}
          onChange={updatePaymentField('expiry')}
          placeholder="12/99"
          maxLength={5}
          required
        />
      </label>
      <label>
        CVC
        <input value={payment.cvc} onChange={updatePaymentField('cvc')} placeholder="123" maxLength={3} required />
      </label>

      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Placing order…' : 'Place order'}
      </button>
    </form>
  );
}
