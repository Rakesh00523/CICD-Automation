import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchProduct } from '../api';
import { useCart } from '../context/CartContext';

export default function ProductDetail() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [status, setStatus] = useState('loading');
  const { addItem } = useCart();

  useEffect(() => {
    fetchProduct(id)
      .then((data) => {
        setProduct(data);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [id]);

  if (status === 'loading') return <p>Loading product…</p>;
  if (status === 'error' || !product) return <p>Product not found.</p>;

  return (
    <div className="product-detail">
      <img src={product.imageUrl} alt={product.name} />
      <div>
        <h2>{product.name}</h2>
        <p>{product.description}</p>
        <p className="price">${product.price.toFixed(2)}</p>
        <p className="stock">{product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}</p>
        <button disabled={product.stock === 0} onClick={() => addItem(product)}>
          Add to cart
        </button>
      </div>
    </div>
  );
}
