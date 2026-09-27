"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/auth-context";
import { login as apiLogin, register as apiRegister } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sun, Moon } from "lucide-react";

export default function LoginForm() {
  const { login } = useAuth();
  const { theme, setTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRegister, setIsRegister] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isRegister) {
        await apiRegister(username, password);
      }
      const data = await apiLogin(username, password);
      login(data.access_token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      {/* Theme toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 top-4"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </Button>
      <div className="flex w-full max-w-sm flex-col gap-6">
        {/* Brand */}
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-lg font-semibold tracking-tight">Consumo Luz</span>
          <span className="text-sm text-muted-foreground">Monitor de consumo de energía</span>
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              {isRegister ? "Crear cuenta" : "Iniciar sesión"}
            </CardTitle>
            <CardDescription>
              {isRegister
                ? "Registrate para comenzar a monitorear tu consumo"
                : "Ingresá tus credenciales para acceder"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <div className="grid gap-5">
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="username">Usuario</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Tu nombre de usuario"
                    autoComplete="username"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Tu contraseña"
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Cargando..." : isRegister ? "Registrarse" : "Iniciar sesión"}
                </Button>
                <div className="text-center text-sm text-muted-foreground">
                  {isRegister ? (
                    <>
                      ¿Ya tenés cuenta?{" "}
                      <button
                        type="button"
                        onClick={() => { setIsRegister(false); setError(""); }}
                        className="text-foreground underline underline-offset-4 hover:no-underline"
                      >
                        Iniciá sesión
                      </button>
                    </>
                  ) : (
                    <>
                      ¿Primera vez?{" "}
                      <button
                        type="button"
                        onClick={() => { setIsRegister(true); setError(""); }}
                        className="text-foreground underline underline-offset-4 hover:no-underline"
                      >
                        Registrate
                      </button>
                    </>
                  )}
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
