"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface AuthContextType {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  isAuthenticated: false,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("consumo_luz_token");
    if (stored) setToken(stored);
  }, []);

  const loginFn = (newToken: string) => {
    setToken(newToken);
    localStorage.setItem("consumo_luz_token", newToken);
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem("consumo_luz_token");
  };

  return (
    <AuthContext.Provider value={{ token, isAuthenticated: !!token, login: loginFn, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
