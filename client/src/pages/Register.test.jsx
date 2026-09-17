import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Register from './Register';
import { AuthProvider } from '../context/AuthContext';

const { registerUser } = vi.hoisted(() => ({ registerUser: vi.fn() }));
vi.mock('../api', () => ({ registerUser, loginUser: vi.fn(), fetchMyOrders: vi.fn() }));

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<p>Home page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Register', () => {
  beforeEach(() => {
    localStorage.clear();
    registerUser.mockReset();
  });

  it('renders email, password, and a submit button', () => {
    renderRegister();

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument();
  });

  it('registers and redirects home on success', async () => {
    registerUser.mockResolvedValue({ token: 'tok', user: { id: '1', email: 'shopper@example.com' } });
    renderRegister();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'shopper@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /register/i }));

    await waitFor(() => expect(screen.getByText('Home page')).toBeInTheDocument());
    expect(registerUser).toHaveBeenCalledWith('shopper@example.com', 'password123');
  });

  it('shows the server error message on a duplicate email', async () => {
    registerUser.mockRejectedValue({ response: { data: { message: 'An account with that email already exists' } } });
    renderRegister();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'shopper@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /register/i }));

    expect(await screen.findByText('An account with that email already exists')).toBeInTheDocument();
  });
});
