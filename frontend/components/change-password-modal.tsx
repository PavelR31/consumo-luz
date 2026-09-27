"use client";

import { useState } from "react";
import { KeyRound, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { changePassword } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const { token, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleClose = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setSuccess(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }
    if (newPassword.length < 8) {
      setError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("La nueva contraseña debe ser diferente a la contraseña actual.");
      return;
    }

    setLoading(true);
    try {
      await changePassword(token, currentPassword, newPassword, confirmPassword);
      setSuccess(true);
      setTimeout(() => {
        handleClose();
        logout();
      }, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al cambiar la contraseña.");
    } finally {
      setLoading(false);
    }
  };

  const strengthScore = (() => {
    if (!newPassword) return 0;
    let score = 0;
    if (newPassword.length >= 8) score++;
    if (newPassword.length >= 10 && /[A-Z]/.test(newPassword)) score++;
    if (/[0-9]/.test(newPassword)) score++;
    if (/[^A-Za-z0-9]/.test(newPassword)) score++;
    return score;
  })();

  const strengthConfig = [
    { label: "", textClass: "text-muted-foreground", bgClass: "bg-muted" },
    { label: "Muy débil", textClass: "text-red-500", bgClass: "bg-red-500" },
    { label: "Débil", textClass: "text-orange-500", bgClass: "bg-orange-500" },
    { label: "Aceptable", textClass: "text-amber-500", bgClass: "bg-amber-500" },
    { label: "Fuerte", textClass: "text-emerald-500", bgClass: "bg-emerald-500" },
  ][strengthScore] || { label: "", textClass: "text-muted-foreground", bgClass: "bg-muted" };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="rounded-sm border-border bg-card max-w-sm sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            Cambiar Contraseña
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Ingresa tu contraseña actual y define una nueva clave para tu cuenta.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-6 flex flex-col items-center justify-center text-center space-y-2">
            <CheckCircle2 className="size-10 text-emerald-500 animate-in zoom-in-75 duration-200" />
            <p className="text-sm font-semibold text-foreground">¡Contraseña actualizada con éxito!</p>
            <p className="text-xs text-muted-foreground">
              Cerrando sesión en 2 segundos para que inicies con tu nueva clave...
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 pt-1">
            {error && (
              <Alert variant="destructive" className="py-2 text-xs flex items-center gap-2">
                <AlertCircle className="size-3.5 shrink-0" />
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="current-pw" className="text-xs">
                Contraseña actual
              </Label>
              <Input
                id="current-pw"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="h-9 text-xs rounded-sm font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-pw" className="text-xs">
                Nueva contraseña
              </Label>
              <Input
                id="new-pw"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                required
                autoComplete="new-password"
                className="h-9 text-xs rounded-sm font-mono"
              />

              {newPassword.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-muted-foreground">Seguridad:</span>
                    <span className={cn("font-medium", strengthConfig.textClass)}>
                      {strengthConfig.label}
                    </span>
                  </div>
                  <div className="flex gap-1 h-1 w-full">
                    {[1, 2, 3, 4].map((step) => (
                      <div
                        key={step}
                        className={cn(
                          "h-full flex-1 rounded-full transition-colors",
                          strengthScore >= step ? strengthConfig.bgClass : "bg-muted"
                        )}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw" className="text-xs">
                Confirmar nueva contraseña
              </Label>
              <Input
                id="confirm-pw"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="new-password"
                className="h-9 text-xs rounded-sm font-mono"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-sm text-xs"
                onClick={handleClose}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                className="rounded-sm text-xs"
                disabled={loading || !currentPassword || !newPassword || !confirmPassword}
              >
                {loading ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1.5" />
                    Actualizando...
                  </>
                ) : (
                  "Actualizar contraseña"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
