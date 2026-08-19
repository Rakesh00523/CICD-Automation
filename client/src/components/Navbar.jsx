import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';

export default function Navbar() {
  const { items } = useCart();
  const count = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <nav className="navbar">
      <Link to="/" className="brand">
        ShopPipe
      </Link>
      <Link to="/cart" className="cart-link">
        Cart ({count})
      </Link>
    </nav>
  );
}
