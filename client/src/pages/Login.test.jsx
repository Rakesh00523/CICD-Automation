import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './Login';
import { AuthProvider } from '../context/AuthContext';

const { loginUser } = vi.hoisted(() => ({ loginUser: vi.fn() }));
vi.mock('../api', () => ({ loginUser, registerUser: vi.fn(), fetchMyOrders: vi.fn() }));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<p>Home page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Login', () => {
  beforeEach(() => {
    localStorage.clear();
    loginUser.mockReset();
  });

  it('renders email, password, and a submit button', () => {
    renderLogin();

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('logs in and redirects home on success', async () => {
    loginUser.mockResolvedValue({ token: 'tok', user: { id: '1', email: 'shopper@example.com' } });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'shopper@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(screen.getByText('Home page')).toBeInTheDocument());
    expect(loginUser).toHaveBeenCalledWith('shopper@example.com', 'password123');
  });

  it('shows the server error message on failed login', async () => {
    loginUser.mockRejectedValue({ response: { data: { message: 'Invalid email or password' } } });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'shopper@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrongpassword' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
  });
});
