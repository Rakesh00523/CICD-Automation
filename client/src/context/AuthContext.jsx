import { createContext, useContext, useState } from 'react';
import { loginUser, registerUser } from '../api';

const AuthContext = createContext(null);
const STORAGE_KEY = 'shoppipe.auth';

function loadAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { token: null, user: null };
  } catch {
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(loadAuth);

  const persist = (next) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setAuth(next);
  };

  const login = async (email, password) => {
    const { token, user } = await loginUser(email, password);
    persist({ token, user });
  };

  const register = async (email, password) => {
    const { token, user } = await registerUser(email, password);
    persist({ token, user });
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setAuth({ token: null, user: null });
  };

  const value = { token: auth.token, user: auth.user, login, register, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
