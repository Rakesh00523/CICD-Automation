import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import ProtectedRoute from './ProtectedRoute';
import { AuthProvider } from '../context/AuthContext';

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={['/checkout']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>Login page</p>} />
          <Route
            path="/checkout"
            element={
              <ProtectedRoute>
                <p>Secret checkout content</p>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('redirects to /login when logged out', () => {
    renderProtected();

    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Secret checkout content')).not.toBeInTheDocument();
  });

  it('renders the protected content when logged in', () => {
    localStorage.setItem(
      'shoppipe.auth',
      JSON.stringify({ token: 'fake-token', user: { id: '1', email: 'shopper@example.com' } })
    );

    renderProtected();

    expect(screen.getByText('Secret checkout content')).toBeInTheDocument();
  });
});
