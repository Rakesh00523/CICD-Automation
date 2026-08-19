import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import ProductCard from './ProductCard';

const product = {
  _id: '1',
  name: 'Test Product',
  price: 12.5,
  imageUrl: 'https://example.com/image.png',
};

describe('ProductCard', () => {
  it('renders product name and price', () => {
    render(
      <MemoryRouter>
        <ProductCard product={product} />
      </MemoryRouter>
    );

    expect(screen.getByText('Test Product')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
  });
});
