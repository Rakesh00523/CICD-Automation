import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';

export default function Cart() {
  const { items, removeItem, updateQuantity, total } = useCart();
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <p>
        Your cart is empty. <Link to="/">Browse products</Link>.
      </p>
    );
  }

  return (
    <div className="cart">
      {items.map((item) => (
        <div key={item.productId} className="cart-row">
          <span>{item.name}</span>
          <input
            type="number"
            min="1"
            value={item.quantity}
            onChange={(e) => updateQuantity(item.productId, Math.max(1, Number(e.target.value)))}
          />
          <span>${(item.price * item.quantity).toFixed(2)}</span>
          <button onClick={() => removeItem(item.productId)}>Remove</button>
        </div>
      ))}
      <p className="cart-total">Total: ${total.toFixed(2)}</p>
      <button onClick={() => navigate('/checkout')}>Proceed to checkout</button>
    </div>
  );
}
