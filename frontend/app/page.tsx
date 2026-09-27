"use client";

import { useAuth } from "@/lib/auth-context";
import LoginForm from "@/components/login-form";
import Dashboard from "@/components/dashboard";

export default function Home() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return <Dashboard />;
}
