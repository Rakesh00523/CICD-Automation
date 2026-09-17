import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import Navbar from './Navbar';
import { CartProvider } from '../context/CartContext';
import { AuthProvider } from '../context/AuthContext';

function renderNavbar() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <CartProvider>
          <Navbar />
        </CartProvider>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Navbar', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('shows login/register links when logged out', () => {
    renderNavbar();

    expect(screen.getByText('Log in')).toBeInTheDocument();
    expect(screen.getByText('Register')).toBeInTheDocument();
  });

  it('shows the user email, an orders link, and logout when logged in', () => {
    localStorage.setItem(
      'shoppipe.auth',
      JSON.stringify({ token: 'tok', user: { id: '1', email: 'shopper@example.com' } })
    );
    renderNavbar();

    expect(screen.getByText('shopper@example.com')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });

  it('clears stored auth and shows logged-out links after logout', () => {
    localStorage.setItem(
      'shoppipe.auth',
      JSON.stringify({ token: 'tok', user: { id: '1', email: 'shopper@example.com' } })
    );
    renderNavbar();

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));

    expect(localStorage.getItem('shoppipe.auth')).toBeNull();
    expect(screen.getByText('Log in')).toBeInTheDocument();
  });
});
