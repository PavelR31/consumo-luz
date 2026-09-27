"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/auth-context";
import { ChangePasswordModal } from "@/components/change-password-modal";
import {
  getDashboard,
  getDailyConsumption,
  getReadings,
  createReading,
  updateReading,
  deleteReading,
  createReadingWithPhoto,
  ocrPreview,
  getCycles,
  getCycle,
  createCycle,
  updateCycle,
  closeCycle,
  deleteCycle,
  getSuggestedStart,
  getCycleComparison,
  getReports,
  createReport,
  deleteReport,
  getSavedReportPdfUrl,
  getPdfReportUrl,
  getMe,
  changePassword,
} from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  ReferenceLine,
  PieChart,
  Pie,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
  ResponsiveContainer,
} from "recharts";
import {
  Zap,
  TrendingUp,
  Receipt,
  LogOut,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  KeyRound,
  Menu,
  Sun,
  Moon,
  Bell,
  LayoutDashboard,
  ArrowRight,
  FileDown,
  Trash2,
  PanelLeftClose,
  PanelLeftOpen,
  Gauge,
  FileText,
  X,
  ExternalLink,
  Edit2,
  Scale,
  Camera,
  Upload,
  Check,
  Calendar,
} from "lucide-react";

// ── Interfaces ────────────────────────────────────────────────────────
interface DashboardData {
  cycle_id: number | null;
  cycle_is_active: boolean | null;
  cycle_start_date: string | null;
  cycle_end_date: string | null;
  cycle_start_reading: number | null;
  cycle_end_reading: number | null;
  current_reading: number | null;
  previous_reading: number | null;
  kwh_consumed: number;
  days_elapsed: number;
  daily_average: number;
  projected_monthly: number;
  projected_cost: number;
  days_remaining: number;
  kwh_remaining_for_subsidy: number;
  subsidy_at_risk: boolean;
  cost_breakdown: Array<{
    block_name: string;
    kwh: number;
    price_per_kwh: number;
    subtotal: number;
  }>;
  recent_readings: Array<ReadingItem>;
  billed_kwh: number | null;
  billed_amount: number | null;
  energy_cost?: number;
  fixed_charge?: number;
  alumbrado?: number;
  regulacion_ine?: number;
  iva?: number;
  current_cost?: number;
}

interface ReadingItem {
  id: number;
  reading_kwh: number;
  created_at: string;
  source: string;
  notes: string | null;
  photo_path: string | null;
  billing_cycle_id: number | null;
}

interface DailyData {
  date: string;
  reading: number;
  delta_kwh: number;
  daily_avg: number;
  source: string;
  is_interpolated?: boolean;
  is_peak?: boolean;
  peak_kwh?: number;
}

interface CycleItem {
  id: number;
  start_date: string;
  end_date: string | null;
  start_reading: number;
  end_reading: number | null;
  is_active: boolean;
  notes: string | null;
  billed_kwh: number | null;
  billed_amount: number | null;
  utility_invoice_number: string | null;
  created_at: string;
}

interface ReportItem {
  id: number;
  user_id: number;
  billing_cycle_id: number | null;
  title: string;
  start_date: string;
  end_date: string;
  kwh_consumed: number;
  total_cost: number;
  daily_avg_kwh: number;
  projected_kwh: number;
  subsidy_status: string;
  notes: string | null;
  created_at: string;
}

interface CycleComparison {
  cycle_id: number;
  start_date: string;
  end_date: string | null;
  real_kwh: number;
  calculated_amount: number;
  billed_kwh: number | null;
  billed_amount: number | null;
  utility_invoice_number: string | null;
  diff_kwh: number | null;
  diff_amount: number | null;
  status: "exact" | "overcharged" | "undercharged" | "pending_bill";
  verdict: string;
}

const chartConfig = {
  delta_kwh: {
    label: "Consumo diario (kWh)",
    color: "hsl(var(--foreground))",
  },
} satisfies ChartConfig;

export default function Dashboard() {
  const { token, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [userName, setUserName] = useState<string>("Usuario");

  useEffect(() => {
    if (token) {
      getMe(token)
        .then((u: { username?: string }) => {
          if (u?.username) setUserName(u.username);
        })
        .catch(() => {});
    }
  }, [token]);

  // Navigation state
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Core Data
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [allReadings, setAllReadings] = useState<ReadingItem[]>([]);
  const [cycles, setCycles] = useState<CycleItem[]>([]);
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modals state
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [cycleDialogOpen, setCycleDialogOpen] = useState(false);
  const [closeCycleDialogOpen, setCloseCycleDialogOpen] = useState(false);
  const [editCycleDialogOpen, setEditCycleDialogOpen] = useState(false);
  const [comparisonDialogOpen, setComparisonDialogOpen] = useState(false);
  const [readingDialogOpen, setReadingDialogOpen] = useState(false);
  const [editReadingDialogOpen, setEditReadingDialogOpen] = useState(false);
  const [reportDialogOpen, setReportDialogOpen] = useState(false);

  // Cycle form states
  const [cycleStartDate, setCycleStartDate] = useState("");
  const [cycleStartReading, setCycleStartReading] = useState("");
  const [cycleNotes, setCycleNotes] = useState("");
  const [closingCycleId, setClosingCycleId] = useState<number | null>(null);
  const [closeEndDate, setCloseEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [closeEndReading, setCloseEndReading] = useState("");
  const [closeBilledKwh, setCloseBilledKwh] = useState("");
  const [closeBilledAmount, setCloseBilledAmount] = useState("");
  const [closeInvoiceNum, setCloseInvoiceNum] = useState("");

  // Edit Cycle form
  const [editingCycle, setEditingCycle] = useState<CycleItem | null>(null);
  const [editCycleStartReading, setEditCycleStartReading] = useState("");
  const [editCycleEndReading, setEditCycleEndReading] = useState("");
  const [editCycleStartDate, setEditCycleStartDate] = useState("");
  const [editCycleEndDate, setEditCycleEndDate] = useState("");
  const [editCycleIsActive, setEditCycleIsActive] = useState(true);
  const [editCycleBilledKwh, setEditCycleBilledKwh] = useState("");
  const [editCycleBilledAmount, setEditCycleBilledAmount] = useState("");
  const [editCycleInvoiceNum, setEditCycleInvoiceNum] = useState("");
  const [editCycleNotes, setEditCycleNotes] = useState("");

  // Comparison State
  const [comparisonData, setComparisonData] = useState<CycleComparison | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);

  // Helper functions for date handling without UTC shift
  const getTodayLocalDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const formatDisplayDate = (rawStr: string | null | undefined): string => {
    if (!rawStr) return "—";
    const dateOnly = rawStr.split("T")[0].split(" ")[0];
    const parts = dateOnly.split("-");
    if (parts.length === 3) {
      const [y, m, d] = parts;
      const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
      const mIndex = parseInt(m, 10) - 1;
      const mName = months[mIndex] || m;
      return `${parseInt(d, 10)} ${mName} ${y}`;
    }
    return rawStr;
  };

  // Chart mode: daily bars or pie distribution
  const [chartMode, setChartMode] = useState<"daily" | "pie">("daily");

  // Reading form states (with Real-time OCR Autocomplete)
  const [readingValue, setReadingValue] = useState("");
  const [readingDate, setReadingDate] = useState<string>(getTodayLocalDate());
  const [readingNotes, setReadingNotes] = useState("");
  const [readingPhoto, setReadingPhoto] = useState<File | null>(null);
  const [readingPhotoPreview, setReadingPhotoPreview] = useState<string | null>(null);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null);
  const [submittingReading, setSubmittingReading] = useState(false);

  // Edit Reading state
  const [editingReading, setEditingReading] = useState<ReadingItem | null>(null);
  const [editReadingValue, setEditReadingValue] = useState("");
  const [editReadingDate, setEditReadingDate] = useState("");
  const [editReadingNotes, setEditReadingNotes] = useState("");

  // Report Form state
  const [reportTitle, setReportTitle] = useState("");
  const [reportCycleId, setReportCycleId] = useState<string>("all");
  const [reportNotes, setReportNotes] = useState("");
  const [generatingReport, setGeneratingReport] = useState(false);

  // ── Saludo según la hora ─────────────────────────────────────────────
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Buenos días";
    if (hour >= 12 && hour < 19) return "Buenas tardes";
    return "Buenas noches";
  }, []);

  // Cálculos de pico diario e interpolación para gráficos
  const peakKwh = useMemo(() => {
    if (!dailyData || dailyData.length === 0) return 0;
    return Math.max(...dailyData.map((d) => d.delta_kwh || 0));
  }, [dailyData]);

  const peakItem = useMemo(() => {
    if (!dailyData || peakKwh <= 0) return null;
    return dailyData.find((d) => d.delta_kwh === peakKwh) || null;
  }, [dailyData, peakKwh]);

  // Datos para la Gráfica de Pastel (Distribución por Bloque Tarifario INE)
  const pieChartData = useMemo(() => {
    if (!dashboard?.cost_breakdown || dashboard.cost_breakdown.length === 0) {
      if (dashboard?.kwh_consumed && dashboard.kwh_consumed > 0) {
        return [
          {
            name: "Consumo Actual",
            value: dashboard.kwh_consumed,
            color: "#18181b",
            subtotal: dashboard.current_cost || 0,
          },
        ];
      }
      return [];
    }
    const colors = ["#18181b", "#3f3f46", "#71717a", "#a1a1aa", "#d4d4d8"];
    const activeBlocks = dashboard.cost_breakdown.filter((b) => b.kwh > 0);
    if (activeBlocks.length === 0 && dashboard.kwh_consumed > 0) {
      return [
        {
          name: "Consumo Registrado",
          value: dashboard.kwh_consumed,
          color: "#18181b",
          subtotal: dashboard.current_cost || 0,
        },
      ];
    }
    return activeBlocks.map((b, idx) => ({
      name: b.block_name,
      value: b.kwh,
      subtotal: b.subtotal,
      color: colors[idx % colors.length],
    }));
  }, [dashboard]);

  // ── Carga de Datos Principal ─────────────────────────────────────────
  const loadAllData = useCallback(async (targetCycleId?: number | null) => {
    if (!token) return;
    try {
      setError(null);
      const effectiveCycleId = targetCycleId !== undefined ? targetCycleId : selectedCycleId;

      const [dash, daily, rdgs, cycList, repList] = await Promise.all([
        getDashboard(token, effectiveCycleId ?? undefined),
        getDailyConsumption(token, 30, effectiveCycleId ?? undefined),
        getReadings(token, 100),
        getCycles(token),
        getReports(token),
      ]);

      setDashboard(dash);
      setDailyData(daily);
      setAllReadings(rdgs);
      setCycles(cycList);
      setReports(repList);

      if (dash.cycle_id && selectedCycleId === null) {
        setSelectedCycleId(dash.cycle_id);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Error al cargar la información");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, selectedCycleId]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
  };

  const handleCycleSelect = async (cycleIdStr: string) => {
    const cycleId = cycleIdStr === "active" ? null : parseInt(cycleIdStr, 10);
    setSelectedCycleId(cycleId);
    setLoading(true);
    await loadAllData(cycleId);
  };

  // ── Handlers de Ciclos ───────────────────────────────────────────────
  const openNewCycleDialog = async () => {
    if (!token) return;
    try {
      const suggested = await getSuggestedStart(token);
      setCycleStartDate(suggested.start_date || new Date().toISOString().split("T")[0]);
      setCycleStartReading(suggested.start_reading !== undefined ? String(suggested.start_reading) : "");
      setCycleNotes("");
      setCycleDialogOpen(true);
    } catch {
      setCycleStartDate(new Date().toISOString().split("T")[0]);
      setCycleStartReading("");
      setCycleDialogOpen(true);
    }
  };

  const handleCreateCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const startR = parseFloat(cycleStartReading);
    if (isNaN(startR) || startR < 0) {
      setError("Ingresa una lectura inicial válida");
      return;
    }
    try {
      await createCycle(token, cycleStartDate, startR, cycleNotes || undefined);
      setCycleDialogOpen(false);
      setActionSuccess("Nuevo ciclo de facturación creado correctamente");
      setTimeout(() => setActionSuccess(null), 4000);
      await loadAllData(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creando el ciclo");
    }
  };

  const openCloseCycleDialog = (cycle: CycleItem) => {
    setClosingCycleId(cycle.id);
    setCloseEndDate(new Date().toISOString().split("T")[0]);
    // Pre-populate with last reading if available
    const lastR = allReadings.find((r) => r.billing_cycle_id === cycle.id) || allReadings[0];
    setCloseEndReading(lastR ? String(lastR.reading_kwh) : String(cycle.start_reading));
    setCloseBilledKwh(cycle.billed_kwh ? String(cycle.billed_kwh) : "");
    setCloseBilledAmount(cycle.billed_amount ? String(cycle.billed_amount) : "");
    setCloseInvoiceNum(cycle.utility_invoice_number || "");
    setCloseCycleDialogOpen(true);
  };

  const handleCloseCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !closingCycleId) return;
    const endR = parseFloat(closeEndReading);
    if (isNaN(endR)) {
      setError("Ingresa una lectura final válida");
      return;
    }
    try {
      await closeCycle(token, closingCycleId, {
        end_date: closeEndDate,
        end_reading: endR,
        billed_kwh: closeBilledKwh ? parseFloat(closeBilledKwh) : undefined,
        billed_amount: closeBilledAmount ? parseFloat(closeBilledAmount) : undefined,
        utility_invoice_number: closeInvoiceNum || undefined,
      });
      setCloseCycleDialogOpen(false);
      setActionSuccess("Ciclo cerrado satisfactoriamente");
      setTimeout(() => setActionSuccess(null), 4000);
      await loadAllData(closingCycleId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cerrando el ciclo");
    }
  };

  const openEditCycleDialog = (cycle: CycleItem) => {
    setEditingCycle(cycle);
    setEditCycleStartDate(cycle.start_date);
    setEditCycleEndDate(cycle.end_date || "");
    setEditCycleStartReading(String(cycle.start_reading));
    setEditCycleEndReading(cycle.end_reading !== null ? String(cycle.end_reading) : "");
    setEditCycleIsActive(cycle.is_active);
    setEditCycleBilledKwh(cycle.billed_kwh !== null ? String(cycle.billed_kwh) : "");
    setEditCycleBilledAmount(cycle.billed_amount !== null ? String(cycle.billed_amount) : "");
    setEditCycleInvoiceNum(cycle.utility_invoice_number || "");
    setEditCycleNotes(cycle.notes || "");
    setEditCycleDialogOpen(true);
  };

  const handleUpdateCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editingCycle) return;
    try {
      await updateCycle(token, editingCycle.id, {
        start_date: editCycleStartDate,
        end_date: editCycleEndDate || null,
        start_reading: parseFloat(editCycleStartReading),
        end_reading: editCycleEndReading ? parseFloat(editCycleEndReading) : null,
        is_active: editCycleIsActive,
        billed_kwh: editCycleBilledKwh ? parseFloat(editCycleBilledKwh) : null,
        billed_amount: editCycleBilledAmount ? parseFloat(editCycleBilledAmount) : null,
        utility_invoice_number: editCycleInvoiceNum || null,
        notes: editCycleNotes || null,
      });
      setEditCycleDialogOpen(false);
      setActionSuccess("Ciclo actualizado con éxito");
      setTimeout(() => setActionSuccess(null), 4000);
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error actualizando ciclo");
    }
  };

  const handleDeleteCycle = async (cycleId: number) => {
    if (!token || !window.confirm("¿Estás seguro de eliminar este ciclo? Las lecturas se conservarán.")) return;
    try {
      await deleteCycle(token, cycleId);
      setActionSuccess("Ciclo eliminado correctamente");
      setTimeout(() => setActionSuccess(null), 4000);
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error eliminando ciclo");
    }
  };

  const openComparisonDialog = async (cycleId: number) => {
    if (!token) return;
    setLoadingComparison(true);
    setComparisonDialogOpen(true);
    try {
      const comp = await getCycleComparison(token, cycleId);
      setComparisonData(comp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando comparativa");
      setComparisonDialogOpen(false);
    } finally {
      setLoadingComparison(false);
    }
  };

  // ── Handlers de Lecturas con Autocomplete OCR ─────────────────────────
  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setReadingPhoto(file);
    setReadingPhotoPreview(URL.createObjectURL(file));

    // Real-time OCR Autocomplete
    setOcrScanning(true);
    setOcrConfidence(null);
    try {
      const res = await ocrPreview(token, file);
      if (res.success && res.detected_value) {
        setReadingValue(String(res.detected_value));
        setOcrConfidence(res.confidence);
      }
    } catch (err) {
      console.warn("OCR preview failed:", err);
    } finally {
      setOcrScanning(false);
    }
  };

  const handleCreateReading = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const val = parseFloat(readingValue);
    if (isNaN(val) || val < 0) {
      setError("Ingresa un valor de lectura numérico válido");
      return;
    }
    setSubmittingReading(true);
    try {
      const targetDate = readingDate || getTodayLocalDate();
      if (readingPhoto) {
        await createReadingWithPhoto(token, readingPhoto, val, readingNotes || undefined, false, targetDate);
      } else {
        await createReading(token, val, readingNotes || undefined, targetDate);
      }
      setReadingDialogOpen(false);
      setReadingValue("");
      setReadingNotes("");
      setReadingPhoto(null);
      setReadingPhotoPreview(null);
      setOcrConfidence(null);
      setReadingDate(getTodayLocalDate());
      setActionSuccess("Lectura registrada exitosamente");
      setTimeout(() => setActionSuccess(null), 4000);
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error registrando lectura");
    } finally {
      setSubmittingReading(false);
    }
  };

  const openEditReadingDialog = (item: ReadingItem) => {
    setEditingReading(item);
    setEditReadingValue(String(item.reading_kwh));
    const dtPart = item.created_at ? item.created_at.split("T")[0].split(" ")[0] : getTodayLocalDate();
    setEditReadingDate(dtPart);
    setEditReadingNotes(item.notes || "");
    setEditReadingDialogOpen(true);
  };

  const handleUpdateReading = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editingReading) return;
    const val = parseFloat(editReadingValue);
    if (isNaN(val) || val < 0) {
      setError("Ingresa una lectura válida");
      return;
    }
    try {
      await updateReading(token, editingReading.id, {
        reading_kwh: val,
        notes: editReadingNotes || undefined,
        reading_date: editReadingDate || undefined,
      });
      setEditReadingDialogOpen(false);
      setActionSuccess("Lectura modificada con éxito");
      setTimeout(() => setActionSuccess(null), 4000);
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error editando lectura");
    }
  };

  const handleDeleteReading = async (id: number) => {
    if (!token || !window.confirm("¿Seguro que deseas eliminar esta lectura?")) return;
    try {
      await deleteReading(token, id);
      setActionSuccess("Lectura eliminada");
      setTimeout(() => setActionSuccess(null), 4000);
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar lectura");
    }
  };

  // ── Handlers de Reportes ─────────────────────────────────────────────
  const handleGenerateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setGeneratingReport(true);
    try {
      const cycleIdParam = reportCycleId === "all" ? undefined : parseInt(reportCycleId, 10);
      await createReport(token, {
        billing_cycle_id: cycleIdParam,
        title: reportTitle.trim() || undefined,
        notes: reportNotes || undefined,
      });
      setReportDialogOpen(false);
      setReportTitle("");
      setReportNotes("");
      setActionSuccess("Reporte oficial generado y guardado");
      setTimeout(() => setActionSuccess(null), 4000);
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error generando reporte");
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleDeleteReport = async (id: number) => {
    if (!token || !window.confirm("¿Eliminar este reporte guardado?")) return;
    try {
      await deleteReport(token, id);
      setActionSuccess("Reporte eliminado");
      setTimeout(() => setActionSuccess(null), 4000);
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar reporte");
    }
  };

  const handleDownloadDirectPdf = (cycleId?: number | null) => {
    if (!token) return;
    const url = getPdfReportUrl(token, cycleId ?? undefined);
    window.open(url, "_blank");
  };

  // ── Estados derivados ────────────────────────────────────────────────
  const activeCycle = cycles.find((c) => c.is_active);
  const hasActiveCycle = Boolean(activeCycle);
  const isSubsidyAtRisk = dashboard?.subsidy_at_risk ?? false;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* ── TOP NAVBAR ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/95 backdrop-blur flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          {/* Mobile drawer toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden size-8 rounded-sm"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Abrir menú"
          >
            <Menu className="size-4" />
          </Button>

          {/* Desktop sidebar toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex size-8 rounded-sm text-muted-foreground hover:text-foreground"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            aria-label="Colapsar barra lateral"
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>

          {/* Logo y Título exacto solicitado */}
          <div className="flex items-center gap-2">
            <div className="size-7 rounded-sm bg-foreground text-background flex items-center justify-center font-bold">
              <Zap className="size-4 fill-current" />
            </div>
            <h1 className="text-sm sm:text-base font-semibold tracking-tight text-foreground">
              Monitoreo de consumo de energia
            </h1>
          </div>
        </div>

        {/* Cluster derecho del Header */}
        <div className="flex items-center gap-2">
          {/* Refrescar data */}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-sm text-muted-foreground hover:text-foreground"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Sincronizar datos"
          >
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>

          {/* Tema Claro / Oscuro */}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-sm text-muted-foreground hover:text-foreground"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Alternar tema"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>

          {/* Indicador de moneda oficial */}
          <div className="hidden sm:flex items-center px-2 py-1 rounded-sm border border-border bg-muted/40 text-[11px] font-mono text-muted-foreground">
            NIC (C$)
          </div>

          {/* Notificaciones Reales */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center size-8 text-muted-foreground hover:text-foreground relative rounded-sm hover:bg-accent transition-colors outline-none cursor-pointer"
              title="Notificaciones del sistema"
            >
              <Bell className="size-4" />
              {isSubsidyAtRisk ? (
                <span className="absolute top-2 right-2 size-1.5 rounded-full bg-red-500" />
              ) : hasActiveCycle ? (
                <span className="absolute top-2 right-2 size-1.5 rounded-full bg-emerald-500" />
              ) : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 rounded-sm p-2 text-xs border-border bg-popover">
              <DropdownMenuLabel className="font-semibold text-xs text-foreground px-2 py-1">
                Notificaciones del Sistema
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="space-y-1.5 py-1">
                <div className="p-2 rounded-sm bg-muted/40 border border-border space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">Estado de Subsidio INE</span>
                    <Badge variant={isSubsidyAtRisk ? "destructive" : "outline"} className="text-[10px] rounded-sm py-0">
                      {isSubsidyAtRisk ? "Riesgo" : "En margen"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {isSubsidyAtRisk
                      ? `Proyección supera 150 kWh. Perderías subsidio.`
                      : `Consumo dentro de los 150 kWh subsidiados.`}
                  </p>
                </div>
                <div className="p-2 rounded-sm bg-muted/40 border border-border space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">Ciclo de Facturación</span>
                    <Badge variant={hasActiveCycle ? "secondary" : "outline"} className="text-[10px] rounded-sm py-0">
                      {hasActiveCycle ? "Activo" : "Sin ciclo"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {hasActiveCycle
                      ? `Inició el ${activeCycle?.start_date}.`
                      : `No hay ciclo activo. Haz click en Crear Ciclo.`}
                  </p>
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Menú de Usuario */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center justify-center h-8 px-2 text-xs rounded-sm border border-border hover:bg-accent transition-colors gap-1.5 font-medium outline-none cursor-pointer"
            >
              <span className="size-2 rounded-full bg-emerald-500" />
              <span>{userName}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-sm p-1 text-xs border-border bg-popover">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="font-normal text-muted-foreground px-2 py-1">
                  Conectado como <strong className="text-foreground">{userName}</strong>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setChangePasswordOpen(true)}
                className="flex items-center gap-2 cursor-pointer rounded-sm"
              >
                <KeyRound className="size-3.5" />
                <span>Cambiar contraseña</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={logout}
                className="text-red-500 focus:text-red-500 flex items-center gap-2 cursor-pointer rounded-sm"
              >
                <LogOut className="size-3.5" />
                <span>Cerrar sesión</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* ── CUERPO PRINCIPAL (Sidebar + Contenido) ───────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Desktop */}
        <aside
          className={`hidden lg:flex flex-col border-r border-border bg-card transition-all duration-200 ${
            isSidebarCollapsed ? "w-16" : "w-64"
          }`}
        >
          <div className="p-3 border-b border-border">
            <p className={`text-[11px] uppercase tracking-wider text-muted-foreground font-semibold ${isSidebarCollapsed ? "text-center text-[9px]" : "px-2"}`}>
              {isSidebarCollapsed ? "NAV" : "Navegación"}
            </p>
          </div>

          <nav className="flex-1 p-2 space-y-1">
            <button
              type="button"
              id="nav-dashboard"
              onClick={() => setActiveTab("dashboard")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-xs font-medium transition-colors cursor-pointer ${
                activeTab === "dashboard"
                  ? "bg-accent text-accent-foreground border border-border"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              } ${isSidebarCollapsed ? "justify-center px-0" : ""}`}
              title="Panel Principal"
            >
              <LayoutDashboard className="size-4 shrink-0" />
              {!isSidebarCollapsed && <span>Panel Principal</span>}
            </button>

            <button
              type="button"
              id="nav-lecturas"
              onClick={() => setActiveTab("lecturas")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-xs font-medium transition-colors cursor-pointer ${
                activeTab === "lecturas"
                  ? "bg-accent text-accent-foreground border border-border"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              } ${isSidebarCollapsed ? "justify-center px-0" : ""}`}
              title="Lecturas del Medidor"
            >
              <Gauge className="size-4 shrink-0" />
              {!isSidebarCollapsed && <span>Lecturas del Medidor</span>}
            </button>

            <button
              type="button"
              id="nav-ciclos"
              onClick={() => setActiveTab("ciclos")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-xs font-medium transition-colors cursor-pointer ${
                activeTab === "ciclos"
                  ? "bg-accent text-accent-foreground border border-border"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              } ${isSidebarCollapsed ? "justify-center px-0" : ""}`}
              title="Ciclos de Facturación"
            >
              <Receipt className="size-4 shrink-0" />
              {!isSidebarCollapsed && <span>Ciclos de Facturación</span>}
            </button>

            <button
              type="button"
              id="nav-reportes"
              onClick={() => setActiveTab("reportes")}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-xs font-medium transition-colors cursor-pointer ${
                activeTab === "reportes"
                  ? "bg-accent text-accent-foreground border border-border"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              } ${isSidebarCollapsed ? "justify-center px-0" : ""}`}
              title="Reportes Oficiales"
            >
              <FileText className="size-4 shrink-0" />
              {!isSidebarCollapsed && <span>Reportes Oficiales</span>}
            </button>
          </nav>

          {/* Quick cycle info box */}
          {!isSidebarCollapsed && (
            <div className="p-3 m-2 border border-border rounded-sm bg-muted/20 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">Ciclo en curso</span>
                {hasActiveCycle ? (
                  <Badge variant="secondary" className="text-[10px] rounded-sm py-0">Activo</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] rounded-sm py-0">Ninguno</Badge>
                )}
              </div>
              {hasActiveCycle ? (
                <div className="text-[11px] text-muted-foreground space-y-0.5">
                  <p>Inicio: {activeCycle?.start_date}</p>
                  <p>Lectura: {activeCycle?.start_reading} kWh</p>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">Inicia un ciclo para calcular proyecciones exactas.</p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs h-7 rounded-sm mt-1"
                onClick={openNewCycleDialog}
              >
                <Plus className="size-3 mr-1" />
                Nuevo Ciclo
              </Button>
            </div>
          )}
        </aside>

        {/* Mobile Drawer */}
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
            <div className="relative w-64 max-w-[80vw] bg-card border-r border-border h-full flex flex-col p-4 z-10 shadow-lg">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <span className="font-semibold text-xs tracking-tight uppercase text-muted-foreground">Navegación</span>
                <Button variant="ghost" size="icon" className="size-7 rounded-sm" onClick={() => setIsMobileMenuOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
              <div className="py-3 space-y-1 flex-1">
                <button
                  onClick={() => { setActiveTab("dashboard"); setIsMobileMenuOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-xs font-medium ${
                    activeTab === "dashboard" ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                  }`}
                >
                  <LayoutDashboard className="size-4" />
                  <span>Panel Principal</span>
                </button>
                <button
                  onClick={() => { setActiveTab("lecturas"); setIsMobileMenuOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-xs font-medium ${
                    activeTab === "lecturas" ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Gauge className="size-4" />
                  <span>Lecturas del Medidor</span>
                </button>
                <button
                  onClick={() => { setActiveTab("ciclos"); setIsMobileMenuOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-xs font-medium ${
                    activeTab === "ciclos" ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Receipt className="size-4" />
                  <span>Ciclos de Facturación</span>
                </button>
                <button
                  onClick={() => { setActiveTab("reportes"); setIsMobileMenuOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-sm text-xs font-medium ${
                    activeTab === "reportes" ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                  }`}
                >
                  <FileText className="size-4" />
                  <span>Reportes Oficiales</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CONTENIDO PRINCIPAL ────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
          {/* Avisos globales */}
          {error && (
            <Alert variant="destructive" className="rounded-sm">
              <AlertTriangle className="size-4" />
              <AlertTitle className="text-xs font-semibold">Atención</AlertTitle>
              <AlertDescription className="text-xs flex items-center justify-between">
                <span>{error}</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setError(null)}>
                  Cerrar
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {actionSuccess && (
            <Alert className="rounded-sm border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" />
              <AlertTitle className="text-xs font-semibold">Completado</AlertTitle>
              <AlertDescription className="text-xs">{actionSuccess}</AlertDescription>
            </Alert>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* TAB 1: DASHBOARD PRINCIPAL                                      */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === "dashboard" && (
            <div className="space-y-6">
              {/* Barra de Controles y Selector de Ciclos */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Ciclo visualizado:</span>
                  <Select
                    value={selectedCycleId ? String(selectedCycleId) : "active"}
                    onValueChange={(val: string | null) => {
                      if (val) handleCycleSelect(val);
                    }}
                  >
                    <SelectTrigger className="w-[260px] h-8 text-xs rounded-sm">
                      <SelectValue placeholder="Seleccionar ciclo" />
                    </SelectTrigger>
                    <SelectContent className="rounded-sm text-xs">
                      {hasActiveCycle && (
                        <SelectItem value="active">
                          Ciclo Activo ({activeCycle?.start_date} - Presente)
                        </SelectItem>
                      )}
                      {cycles.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.is_active ? "[Activo] " : "[Cerrado] "}
                          {c.start_date} {c.end_date ? `a ${c.end_date}` : ""}
                        </SelectItem>
                      ))}
                      {cycles.length === 0 && (
                        <SelectItem value="none" disabled>
                          Sin ciclos registrados
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Botón Comparativa con Recibo */}
                  {dashboard?.cycle_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs rounded-sm gap-1.5"
                      onClick={() => openComparisonDialog(dashboard.cycle_id!)}
                    >
                      <Scale className="size-3.5" />
                      <span>Comparar con Recibo</span>
                    </Button>
                  )}

                  {/* Exportar PDF Directo */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs rounded-sm gap-1.5"
                    onClick={() => handleDownloadDirectPdf(dashboard?.cycle_id)}
                    title="Exportar PDF de este ciclo"
                  >
                    <FileDown className="size-3.5" />
                    <span>Exportar PDF</span>
                  </Button>

                  {/* Botón Nueva Lectura */}
                  <Button
                    size="sm"
                    className="h-8 text-xs rounded-sm gap-1.5"
                    onClick={() => {
                      setReadingValue("");
                      setReadingNotes("");
                      setReadingPhoto(null);
                      setReadingPhotoPreview(null);
                      setReadingDialogOpen(true);
                    }}
                  >
                    <Plus className="size-3.5" />
                    <span>Nueva Lectura</span>
                  </Button>
                </div>
              </div>

              {/* CARD DE BIENVENIDA (Alineado y centrado) */}
              <Card className="rounded-sm border-border bg-card overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="space-y-2 text-center md:text-left">
                      <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-muted text-[11px] font-mono text-muted-foreground">
                        <span>{new Date().toLocaleDateString("es-NI", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
                      </div>
                      <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                        {greeting}, {userName}
                      </h2>
                      <p className="text-xs sm:text-sm text-muted-foreground max-w-xl">
                        {dashboard?.cycle_start_date ? (
                          <>
                            Monitoreando ciclo iniciado el <strong className="text-foreground">{dashboard.cycle_start_date}</strong>. 
                            Has consumido <strong className="text-foreground">{dashboard.kwh_consumed} kWh</strong> en{" "}
                            <strong className="text-foreground">{dashboard.days_elapsed} días</strong> transcurridos.
                          </>
                        ) : (
                          "No hay lecturas ni ciclos activos en el sistema. Registra un ciclo para comenzar el monitoreo tarifario."
                        )}
                      </p>
                      <div className="pt-2 flex flex-wrap gap-2 justify-center md:justify-start">
                        {!hasActiveCycle && (
                          <Button size="sm" className="h-8 text-xs rounded-sm gap-1.5" onClick={openNewCycleDialog}>
                            <Plus className="size-3.5" />
                            <span>Crear Ciclo Inicial</span>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs rounded-sm gap-1.5"
                          onClick={() => setActiveTab("lecturas")}
                        >
                          <Gauge className="size-3.5" />
                          <span>Ver Todas las Lecturas</span>
                        </Button>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center justify-center">
                      <img
                        src="https://demos.shadcndashboard.dev/images/backgrounds/analytic-user-dark.svg"
                        alt="Analítica de Consumo"
                        className="h-32 sm:h-36 w-auto object-contain"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* TARJETAS KPI (4 columnas en desktop, 2 en tablet, 1 en mobile) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Consumo Acumulado */}
                <Card className="rounded-sm border-border bg-card">
                  <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-xs font-medium text-muted-foreground">Consumo Acumulado</CardTitle>
                    <Zap className="size-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold tracking-tight text-foreground">
                      {dashboard?.kwh_consumed.toFixed(1) ?? "0.0"} <span className="text-xs font-normal text-muted-foreground">kWh</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {dashboard?.current_reading !== null ? (
                        <>Lectura actual: <strong className="text-foreground font-mono">{dashboard?.current_reading}</strong> kWh</>
                      ) : (
                        "Sin lecturas aún"
                      )}
                    </p>
                  </CardContent>
                </Card>

                {/* 2. Promedio Diario */}
                <Card className="rounded-sm border-border bg-card">
                  <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-xs font-medium text-muted-foreground">Promedio Diario</CardTitle>
                    <TrendingUp className="size-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold tracking-tight text-foreground">
                      {dashboard?.daily_average.toFixed(2) ?? "0.00"} <span className="text-xs font-normal text-muted-foreground">kWh/día</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      En {dashboard?.days_elapsed ?? 0} días transcurridos de ciclo
                    </p>
                  </CardContent>
                </Card>

                {/* 3. Proyección de luz según consumo actual (sustituye 'Key Nights') */}
                <Card className="rounded-sm border-border bg-card">
                  <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-xs font-medium text-muted-foreground">Proyección de Luz</CardTitle>
                    <Receipt className="size-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold tracking-tight text-foreground">
                      C$ {dashboard?.projected_cost.toFixed(2) ?? "0.00"}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Proyección 30 días: <strong className="text-foreground font-mono">{dashboard?.projected_monthly.toFixed(1) ?? "0"} kWh</strong>
                    </p>
                  </CardContent>
                </Card>

                {/* 4. Subsidio INE (Único indicador limpio) */}
                <Card className="rounded-sm border-border bg-card">
                  <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-xs font-medium text-muted-foreground">Margen de Subsidio INE</CardTitle>
                    <Badge variant={isSubsidyAtRisk ? "destructive" : "outline"} className="text-[10px] rounded-sm py-0">
                      {isSubsidyAtRisk ? "En Riesgo" : "Protegido"}
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold tracking-tight text-foreground">
                      {dashboard?.kwh_remaining_for_subsidy.toFixed(1) ?? "150.0"} <span className="text-xs font-normal text-muted-foreground">kWh</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      <Progress
                        value={Math.min(((dashboard?.kwh_consumed ?? 0) / 150) * 100, 100)}
                        className="h-1.5 rounded-sm"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Límite tarifario: 150 kWh mensuales
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* ── CUADRÍCULA 2 COLUMNAS (Gráfico y Desglose) ─────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Columna Izquierda (2 cols): Gráficos (Barras con Pico e Interpolación / Gráfica de Pastel) */}
                <Card className="lg:col-span-2 rounded-sm border-border bg-card">
                  <CardHeader className="pb-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <CardTitle className="text-sm font-semibold">
                          {chartMode === "daily" ? "Consumo Diario del Ciclo (kWh/día)" : "Distribución de Consumo (Gráfica de Pastel)"}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {chartMode === "daily"
                            ? "Eje Y en kWh por día con línea de pico máximo y promedio de días sin registro"
                            : "Proporción de kWh consumidos por bloque tarifario regulado según normativa INE"}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-1 bg-muted p-0.5 rounded-sm self-start sm:self-auto">
                        <Button
                          type="button"
                          size="sm"
                          variant={chartMode === "daily" ? "secondary" : "ghost"}
                          className="h-7 px-2.5 text-xs rounded-sm"
                          onClick={() => setChartMode("daily")}
                        >
                          Barras Diarias
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={chartMode === "pie" ? "secondary" : "ghost"}
                          className="h-7 px-2.5 text-xs rounded-sm"
                          onClick={() => setChartMode("pie")}
                        >
                          Gráfica de Pastel
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {dailyData.length > 0 ? (
                      chartMode === "daily" ? (
                        <div className="space-y-3">
                          <ChartContainer config={chartConfig} className="h-[280px] w-full">
                            <BarChart data={dailyData} margin={{ top: 20, right: 15, left: -10, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
                              <XAxis
                                dataKey="date"
                                tickLine={false}
                                axisLine={false}
                                tickMargin={8}
                                tickFormatter={(v) => {
                                  const parts = v.split("-");
                                  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : v;
                                }}
                                className="text-[10px] fill-muted-foreground"
                              />
                              <YAxis
                                tickLine={false}
                                axisLine={false}
                                tickMargin={8}
                                className="text-[10px] fill-muted-foreground"
                                unit=" kWh"
                              />
                              <ChartTooltip
                                content={({ active, payload }) => {
                                  if (!active || !payload?.length) return null;
                                  const data = payload[0].payload as DailyData;
                                  const isPeak = data.delta_kwh === peakKwh && peakKwh > 0;
                                  return (
                                    <div className="rounded-sm border border-border bg-popover p-2.5 text-xs shadow-md space-y-1">
                                      <p className="font-semibold text-foreground">
                                        {formatDisplayDate(data.date)}
                                      </p>
                                      <div className="flex items-center justify-between gap-4">
                                        <span className="text-muted-foreground">Consumo día:</span>
                                        <span className="font-mono font-bold text-foreground">
                                          {data.delta_kwh.toFixed(2)} kWh
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between gap-4 text-[10px] text-muted-foreground">
                                        <span>Lectura acumulada:</span>
                                        <span className="font-mono">{data.reading.toFixed(1)} kWh</span>
                                      </div>
                                      {isPeak && (
                                        <Badge variant="destructive" className="text-[9px] py-0 px-1 rounded-sm mt-1">
                                          Día de mayor consumo (Pico)
                                        </Badge>
                                      )}
                                      {data.is_interpolated && (
                                        <p className="text-[10px] text-amber-500 font-medium mt-1">
                                          Día sin registro: promedio diario equitativo
                                        </p>
                                      )}
                                    </div>
                                  );
                                }}
                              />
                              {peakKwh > 0 && (
                                <ReferenceLine
                                  y={peakKwh}
                                  stroke="#ef4444"
                                  strokeDasharray="4 4"
                                  strokeWidth={1.5}
                                  label={{
                                    value: `Día pico: ${peakKwh.toFixed(1)} kWh`,
                                    position: "top",
                                    fill: "#ef4444",
                                    fontSize: 10,
                                    fontWeight: "bold",
                                  }}
                                />
                              )}
                              <Bar dataKey="delta_kwh" radius={[2, 2, 0, 0]}>
                                {dailyData.map((entry, index) => {
                                  const isPeak = entry.delta_kwh === peakKwh && peakKwh > 0;
                                  const isInterpolated = entry.is_interpolated;
                                  return (
                                    <Cell
                                      key={`bar-cell-${index}`}
                                      fill={
                                        isPeak
                                          ? "#ef4444"
                                          : isInterpolated
                                          ? "hsl(var(--muted-foreground)/0.45)"
                                          : "hsl(var(--foreground)/0.85)"
                                      }
                                    />
                                  );
                                })}
                              </Bar>
                            </BarChart>
                          </ChartContainer>

                          {/* Leyenda y datos del pico */}
                          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border text-[11px] text-muted-foreground">
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-1.5">
                                <span className="size-2.5 rounded-xs bg-[#ef4444]" />
                                <span>Día de mayor consumo</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="size-2.5 rounded-xs bg-muted-foreground/45" />
                                <span>Promediado (días sin toma)</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="size-2.5 rounded-xs bg-foreground/85" />
                                <span>Toma normal</span>
                              </div>
                            </div>
                            {peakItem && (
                              <div className="font-mono text-xs text-foreground">
                                Pico: <strong>{peakKwh.toFixed(2)} kWh</strong> ({formatDisplayDate(peakItem.date)})
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="h-[300px] w-full flex flex-col items-center justify-center">
                          {pieChartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={290}>
                              <PieChart>
                                <Pie
                                  data={pieChartData}
                                  cx="50%"
                                  cy="48%"
                                  innerRadius={55}
                                  outerRadius={95}
                                  paddingAngle={3}
                                  dataKey="value"
                                  nameKey="name"
                                >
                                  {pieChartData.map((entry, index) => (
                                    <Cell key={`pie-cell-${index}`} fill={entry.color} />
                                  ))}
                                </Pie>
                                <RechartsTooltip
                                  content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const item = payload[0].payload;
                                    return (
                                      <div className="rounded-sm border border-border bg-popover p-2 text-xs shadow-md space-y-1">
                                        <p className="font-semibold text-foreground">{item.name}</p>
                                        <div className="flex items-center justify-between gap-4">
                                          <span className="text-muted-foreground">Consumo:</span>
                                          <span className="font-mono font-bold text-foreground">
                                            {item.value.toFixed(1)} kWh
                                          </span>
                                        </div>
                                        {item.subtotal !== undefined && (
                                          <div className="flex items-center justify-between gap-4">
                                            <span className="text-muted-foreground">Subtotal:</span>
                                            <span className="font-mono text-foreground">
                                              C$ {item.subtotal.toFixed(2)}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  }}
                                />
                                <RechartsLegend
                                  verticalAlign="bottom"
                                  height={36}
                                  formatter={(value) => (
                                    <span className="text-[11px] text-foreground">{value}</span>
                                  )}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="text-center text-xs text-muted-foreground p-6">
                              Sin bloques de consumo activos para mostrar en el pastel.
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="h-[260px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-border rounded-sm">
                        <Gauge className="size-8 text-muted-foreground mb-2 opacity-40" />
                        <p className="text-xs font-medium text-foreground">Sin registros suficientes para graficar</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Registra al menos 2 lecturas en este ciclo para generar la curva diaria.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Columna Derecha (1 col): Comparativa y Datos de Facturación */}
                <div className="space-y-4">
                  {/* Tarjeta de Resumen del Recibo */}
                  <Card className="rounded-sm border-border bg-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center justify-between">
                        <span>Recibo vs Medidor</span>
                        <Scale className="size-4 text-muted-foreground" />
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Comparación con la factura emitida
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-xs">
                      {dashboard?.billed_kwh !== null && dashboard?.billed_kwh !== undefined ? (
                        <div className="space-y-2 p-2.5 rounded-sm bg-muted/40 border border-border">
                          <div className="flex justify-between text-muted-foreground">
                            <span>Medidor real:</span>
                            <strong className="text-foreground">{dashboard.kwh_consumed} kWh</strong>
                          </div>
                          <div className="flex justify-between text-muted-foreground">
                            <span>Facturado por distribuidora:</span>
                            <strong className="text-foreground">{dashboard.billed_kwh} kWh</strong>
                          </div>
                          <div className="flex justify-between text-muted-foreground">
                            <span>Monto facturado:</span>
                            <strong className="text-foreground">C$ {dashboard.billed_amount?.toFixed(2)}</strong>
                          </div>
                          <div className="pt-1.5 border-t border-border flex justify-between font-medium">
                            <span>Diferencia:</span>
                            <span className={((dashboard.billed_kwh - dashboard.kwh_consumed) > 2) ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>
                              {(dashboard.billed_kwh - dashboard.kwh_consumed).toFixed(1)} kWh
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 rounded-sm border border-dashed border-border text-center space-y-2">
                          <p className="text-[11px] text-muted-foreground">
                            Aún no has ingresado los datos del recibo para este ciclo.
                          </p>
                          {dashboard?.cycle_id && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full text-xs h-7 rounded-sm"
                              onClick={() => openComparisonDialog(dashboard.cycle_id!)}
                            >
                              Ingresar Datos del Recibo
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Desglose Tarifario INE */}
                  <Card className="rounded-sm border-border bg-card">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">Desglose Tarifario INE</CardTitle>
                      <CardDescription className="text-xs">Bloques de consumo según normativa nacional</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow className="text-[11px]">
                            <TableHead className="h-8">Bloque</TableHead>
                            <TableHead className="h-8 text-right">kWh</TableHead>
                            <TableHead className="h-8 text-right">C$/kWh</TableHead>
                            <TableHead className="h-8 text-right">Subtotal</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dashboard?.cost_breakdown && dashboard.cost_breakdown.length > 0 ? (
                            dashboard.cost_breakdown.map((b, idx) => (
                              <TableRow key={idx} className="text-xs">
                                <TableCell className="py-1.5 font-medium">{b.block_name}</TableCell>
                                <TableCell className="py-1.5 text-right font-mono">{b.kwh.toFixed(1)}</TableCell>
                                <TableCell className="py-1.5 text-right font-mono">{b.price_per_kwh.toFixed(2)}</TableCell>
                                <TableCell className="py-1.5 text-right font-mono font-medium">C$ {b.subtotal.toFixed(2)}</TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-4">
                                Sin consumo registrado en este ciclo
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                        {dashboard?.cost_breakdown && dashboard.cost_breakdown.length > 0 && (
                          <TableFooter className="bg-muted/40 font-mono text-xs">
                            <TableRow className="border-t border-border">
                              <TableCell colSpan={3} className="py-1.5 text-muted-foreground font-sans text-xs">
                                Subtotal Energía Consumida
                              </TableCell>
                              <TableCell className="py-1.5 text-right font-medium">
                                C$ {(dashboard.energy_cost ?? dashboard.cost_breakdown.reduce((acc, b) => acc + b.subtotal, 0)).toFixed(2)}
                              </TableCell>
                            </TableRow>
                            {/* Alumbrado Público */}
                            <TableRow>
                              <TableCell colSpan={3} className="py-1 text-muted-foreground font-sans text-[11px]">
                                + Alumbrado Público (Aprox.)
                              </TableCell>
                              <TableCell className="py-1 text-right text-muted-foreground text-[11px]">
                                C$ {(dashboard.alumbrado ?? 0).toFixed(2)}
                              </TableCell>
                            </TableRow>
                            {/* Comercialización */}
                            <TableRow>
                              <TableCell colSpan={3} className="py-1 text-muted-foreground font-sans text-[11px]">
                                + Cargo de Comercialización
                              </TableCell>
                              <TableCell className="py-1 text-right text-muted-foreground text-[11px]">
                                C$ {(dashboard.fixed_charge ?? 36.05).toFixed(2)}
                              </TableCell>
                            </TableRow>
                            {/* Regulación INE */}
                            <TableRow>
                              <TableCell colSpan={3} className="py-1 text-muted-foreground font-sans text-[11px]">
                                + Regulación INE (1%)
                              </TableCell>
                              <TableCell className="py-1 text-right text-muted-foreground text-[11px]">
                                C$ {(dashboard.regulacion_ine ?? 0).toFixed(2)}
                              </TableCell>
                            </TableRow>
                            {/* IVA */}
                            {(dashboard.iva ?? 0) > 0 && (
                              <TableRow>
                                <TableCell colSpan={3} className="py-1 text-muted-foreground font-sans text-[11px]">
                                  + IVA (15%)
                                </TableCell>
                                <TableCell className="py-1 text-right text-muted-foreground text-[11px]">
                                  C$ {(dashboard.iva ?? 0).toFixed(2)}
                                </TableCell>
                              </TableRow>
                            )}
                            <TableRow className="border-t border-border/80 font-bold bg-muted/70">
                              <TableCell colSpan={3} className="py-2 text-foreground font-sans text-xs">
                                Total Estimado Facturable
                              </TableCell>
                              <TableCell className="py-2 text-right text-foreground font-semibold">
                                C$ {(dashboard.current_cost ?? 0).toFixed(2)}
                              </TableCell>
                            </TableRow>
                          </TableFooter>
                        )}
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* TAB 2: LECTURAS DEL MEDIDOR (CRUD con OCR Autocomplete)         */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === "lecturas" && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Registro de Lecturas</h2>
                  <p className="text-xs text-muted-foreground">
                    Captura tus lecturas manualmente o con foto. El OCR autocompleta el campo en tiempo real.
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-8 text-xs rounded-sm gap-1.5"
                  onClick={() => {
                    setReadingValue("");
                    setReadingNotes("");
                    setReadingPhoto(null);
                    setReadingPhotoPreview(null);
                    setOcrConfidence(null);
                    setReadingDialogOpen(true);
                  }}
                >
                  <Plus className="size-3.5" />
                  <span>Nueva Lectura</span>
                </Button>
              </div>

              {/* Formulario rápido para subir lectura */}
              <Card className="rounded-sm border-border bg-card">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Camera className="size-4" />
                    <span>Registro Rápido con Reconocimiento OCR</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Sube una foto del medidor; el sistema detecta los números y autocompleta el valor para que lo verifiques antes de guardar.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateReading} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    {/* Archivo / Foto */}
                    <div className="space-y-1.5 md:col-span-1">
                      <Label className="text-xs">Foto del Medidor (Opcional)</Label>
                      <label className="flex items-center justify-center gap-2 h-9 px-3 border border-dashed border-border rounded-sm cursor-pointer hover:bg-muted/40 transition-colors text-xs text-muted-foreground">
                        <Upload className="size-3.5" />
                        <span className="truncate">{readingPhoto ? readingPhoto.name : "Subir imagen"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handlePhotoSelect}
                        />
                      </label>
                      {ocrScanning && (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Loader2 className="size-3 animate-spin" /> Analizando dígitos del medidor...
                        </p>
                      )}
                      {ocrConfidence !== null && (
                        <p className="text-[10px] text-emerald-500 font-medium">
                          Detectado por OCR (confianza {(ocrConfidence * 100).toFixed(0)}%)
                        </p>
                      )}
                    </div>

                    {/* Valor de lectura */}
                    <div className="space-y-1.5 md:col-span-1">
                      <Label htmlFor="reading-val" className="text-xs">Lectura (kWh)</Label>
                      <Input
                        id="reading-val"
                        type="number"
                        step="0.01"
                        placeholder="Ej. 2265.4"
                        value={readingValue}
                        onChange={(e) => setReadingValue(e.target.value)}
                        required
                        className="h-9 text-xs rounded-sm font-mono"
                      />
                    </div>

                    {/* Fecha de lectura */}
                    <div className="space-y-1.5 md:col-span-1">
                      <Label htmlFor="reading-dt" className="text-xs">Fecha de Lectura</Label>
                      <Input
                        id="reading-dt"
                        type="date"
                        value={readingDate}
                        onChange={(e) => setReadingDate(e.target.value)}
                        className="h-9 text-xs rounded-sm"
                      />
                    </div>

                    {/* Botón de envío */}
                    <div className="md:col-span-1">
                      <Button
                        type="submit"
                        disabled={submittingReading || !readingValue}
                        className="w-full h-9 text-xs rounded-sm"
                      >
                        {submittingReading ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin mr-1" />
                            Guardando...
                          </>
                        ) : (
                          <>
                            <Check className="size-3.5 mr-1" />
                            Guardar Lectura
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              {/* Tabla de Lecturas con Edición y Eliminación */}
              <Card className="rounded-sm border-border bg-card">
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold">Historial de Lecturas</CardTitle>
                    <CardDescription className="text-xs">
                      Puedes modificar cualquier lectura en caso de error humano.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-xs rounded-sm">
                    {allReadings.length} lecturas registradas
                  </Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-[11px]">
                        <TableHead className="h-8">Fecha de Lectura</TableHead>
                        <TableHead className="h-8">Lectura (kWh)</TableHead>
                        <TableHead className="h-8">Origen</TableHead>
                        <TableHead className="h-8">Notas</TableHead>
                        <TableHead className="h-8 text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {allReadings.length > 0 ? (
                        allReadings.map((r) => (
                          <TableRow key={r.id} className="text-xs">
                            <TableCell className="py-2 font-mono font-medium">
                              {formatDisplayDate(r.created_at)}
                            </TableCell>
                            <TableCell className="py-2 font-mono font-semibold">
                              {r.reading_kwh.toFixed(1)} kWh
                            </TableCell>
                            <TableCell className="py-2">
                              <Badge variant="secondary" className="text-[10px] rounded-sm py-0 capitalize">
                                {r.source}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-2 text-muted-foreground truncate max-w-[200px]">
                              {r.notes || "—"}
                            </TableCell>
                            <TableCell className="py-2 text-right space-x-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 rounded-sm text-muted-foreground hover:text-foreground"
                                onClick={() => openEditReadingDialog(r)}
                                title="Editar lectura"
                              >
                                <Edit2 className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 rounded-sm text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                onClick={() => handleDeleteReading(r.id)}
                                title="Eliminar lectura"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-8">
                            No hay lecturas registradas. Usa el formulario superior para ingresar tu primera lectura.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* TAB 3: MÓDULO INDEPENDIENTE DE CICLOS (CRUD Completo)           */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === "ciclos" && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Gestión de Ciclos de Facturación</h2>
                  <p className="text-xs text-muted-foreground">
                    Crea, cierra y compara los ciclos con los recibos de luz emitidos por la distribuidora.
                  </p>
                </div>
                <Button size="sm" className="h-8 text-xs rounded-sm gap-1.5" onClick={openNewCycleDialog}>
                  <Plus className="size-3.5" />
                  <span>Crear Nuevo Ciclo</span>
                </Button>
              </div>

              {/* Lista y CRUD de Ciclos */}
              <Card className="rounded-sm border-border bg-card">
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold">Ciclos Registrados</CardTitle>
                    <CardDescription className="text-xs">
                      Solo un ciclo puede estar activo a la vez. Al crear uno nuevo, el anterior se cierra automáticamente.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-xs rounded-sm">
                    {cycles.length} ciclos
                  </Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-[11px]">
                        <TableHead className="h-8">Período</TableHead>
                        <TableHead className="h-8">Estado</TableHead>
                        <TableHead className="h-8">Lectura Inicial</TableHead>
                        <TableHead className="h-8">Lectura Final</TableHead>
                        <TableHead className="h-8">Consumo Medidor</TableHead>
                        <TableHead className="h-8">Factura Recibo</TableHead>
                        <TableHead className="h-8 text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cycles.length > 0 ? (
                        cycles.map((c) => {
                          const medidorKwh = c.end_reading !== null
                            ? (c.end_reading - c.start_reading).toFixed(1)
                            : "En curso";
                          return (
                            <TableRow key={c.id} className="text-xs">
                              <TableCell className="py-2 font-mono">
                                <div>{c.start_date}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {c.end_date ? `hasta ${c.end_date}` : "Abierto (Presente)"}
                                </div>
                              </TableCell>
                              <TableCell className="py-2">
                                <Badge
                                  variant={c.is_active ? "secondary" : "outline"}
                                  className={`text-[10px] rounded-sm py-0 ${c.is_active ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" : ""}`}
                                >
                                  {c.is_active ? "Activo" : "Cerrado"}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-2 font-mono">{c.start_reading.toFixed(1)} kWh</TableCell>
                              <TableCell className="py-2 font-mono">
                                {c.end_reading !== null ? `${c.end_reading.toFixed(1)} kWh` : "—"}
                              </TableCell>
                              <TableCell className="py-2 font-mono font-medium">
                                {medidorKwh !== "En curso" ? `${medidorKwh} kWh` : <span className="text-muted-foreground italic">En curso</span>}
                              </TableCell>
                              <TableCell className="py-2">
                                {c.billed_kwh !== null ? (
                                  <div className="font-mono text-[11px]">
                                    <div>{c.billed_kwh} kWh</div>
                                    <div className="text-muted-foreground">C$ {c.billed_amount?.toFixed(2)}</div>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground italic">Sin recibo</span>
                                )}
                              </TableCell>
                              <TableCell className="py-2 text-right space-x-1">
                                {c.is_active && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs rounded-sm px-2 text-foreground"
                                    onClick={() => openCloseCycleDialog(c)}
                                  >
                                    Cerrar Ciclo
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 rounded-sm text-muted-foreground hover:text-foreground"
                                  onClick={() => openComparisonDialog(c.id)}
                                  title="Comparar con Recibo"
                                >
                                  <Scale className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 rounded-sm text-muted-foreground hover:text-foreground"
                                  onClick={() => openEditCycleDialog(c)}
                                  title="Editar Ciclo"
                                >
                                  <Edit2 className="size-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 rounded-sm text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                  onClick={() => handleDeleteCycle(c.id)}
                                  title="Eliminar Ciclo"
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">
                            No hay ciclos creados. Haz click en "Crear Nuevo Ciclo" para iniciar el primer período.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* TAB 4: REPORTES OFICIALES (CRUD Completo y Exportación PDF)     */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {activeTab === "reportes" && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Reportes Oficiales de Consumo</h2>
                  <p className="text-xs text-muted-foreground">
                    Genera y descarga en PDF reportes con desglose tarifario del INE y proyección de costos.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs rounded-sm gap-1.5"
                    onClick={() => handleDownloadDirectPdf(selectedCycleId)}
                  >
                    <FileDown className="size-3.5" />
                    <span>Descargar PDF Ciclo Actual</span>
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs rounded-sm gap-1.5"
                    onClick={() => {
                      setReportTitle("");
                      setReportCycleId(selectedCycleId ? String(selectedCycleId) : "all");
                      setReportDialogOpen(true);
                    }}
                  >
                    <Plus className="size-3.5" />
                    <span>Generar y Guardar Reporte</span>
                  </Button>
                </div>
              </div>

              {/* Tabla de Reportes Guardados */}
              <Card className="rounded-sm border-border bg-card">
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold">Reportes Emitidos</CardTitle>
                    <CardDescription className="text-xs">
                      Historial de reportes generados listos para descargar o imprimir.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-xs rounded-sm">
                    {reports.length} reportes
                  </Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-[11px]">
                        <TableHead className="h-8">Título</TableHead>
                        <TableHead className="h-8">Período</TableHead>
                        <TableHead className="h-8">Consumo (kWh)</TableHead>
                        <TableHead className="h-8">Costo Estimado</TableHead>
                        <TableHead className="h-8">Subsidio</TableHead>
                        <TableHead className="h-8 text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reports.length > 0 ? (
                        reports.map((rep) => (
                          <TableRow key={rep.id} className="text-xs">
                            <TableCell className="py-2 font-medium">
                              <div>{rep.title}</div>
                              <div className="text-[10px] text-muted-foreground">
                                Generado: {new Date(rep.created_at).toLocaleDateString("es-NI")}
                              </div>
                            </TableCell>
                            <TableCell className="py-2 font-mono text-muted-foreground">
                              {rep.start_date} a {rep.end_date}
                            </TableCell>
                            <TableCell className="py-2 font-mono font-semibold">
                              {rep.kwh_consumed.toFixed(1)} kWh
                            </TableCell>
                            <TableCell className="py-2 font-mono">
                              C$ {rep.total_cost.toFixed(2)}
                            </TableCell>
                            <TableCell className="py-2">
                              <Badge
                                variant={rep.subsidy_status.includes("Protegido") ? "outline" : "destructive"}
                                className="text-[10px] rounded-sm py-0"
                              >
                                {rep.subsidy_status}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-2 text-right space-x-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs rounded-sm gap-1 px-2"
                                onClick={() => {
                                  if (token) {
                                    window.open(getSavedReportPdfUrl(token, rep.id), "_blank");
                                  }
                                }}
                              >
                                <FileDown className="size-3" />
                                <span>PDF</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 rounded-sm text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                onClick={() => handleDeleteReport(rep.id)}
                                title="Eliminar reporte"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">
                            Aún no se han guardado reportes. Haz click en "Generar y Guardar Reporte".
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>

      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* MODAL: CREAR NUEVO CICLO                                          */}
      {/* ═════════════════════════════════════════════════════════════════ */}
      <Dialog open={cycleDialogOpen} onOpenChange={setCycleDialogOpen}>
        <DialogContent className="rounded-sm border-border bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Iniciar Nuevo Ciclo de Facturación</DialogTitle>
            <DialogDescription className="text-xs">
              La lectura inicial y fecha se sugieren automáticamente a partir del cierre del ciclo previo (pero son 100% editables).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCycle} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-start-date" className="text-xs">Fecha de Inicio</Label>
              <Input
                id="c-start-date"
                type="date"
                value={cycleStartDate}
                onChange={(e) => setCycleStartDate(e.target.value)}
                required
                className="h-9 text-xs rounded-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-start-read" className="text-xs">Lectura Inicial del Medidor (kWh)</Label>
              <Input
                id="c-start-read"
                type="number"
                step="0.01"
                value={cycleStartReading}
                onChange={(e) => setCycleStartReading(e.target.value)}
                required
                className="h-9 text-xs rounded-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Base sobre la que se calcularán los consumos diarios de este ciclo.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-notes" className="text-xs">Notas (Opcional)</Label>
              <Input
                id="c-notes"
                placeholder="Ej. Ciclo de Septiembre - Facturación Casa"
                value={cycleNotes}
                onChange={(e) => setCycleNotes(e.target.value)}
                className="h-9 text-xs rounded-sm"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" className="rounded-sm text-xs" onClick={() => setCycleDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="rounded-sm text-xs">
                Guardar Ciclo
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* MODAL: CERRAR CICLO (Corte de Luz / Fin de Facturación)          */}
      {/* ═════════════════════════════════════════════════════════════════ */}
      <Dialog open={closeCycleDialogOpen} onOpenChange={setCloseCycleDialogOpen}>
        <DialogContent className="rounded-sm border-border bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Cerrar Ciclo de Facturación</DialogTitle>
            <DialogDescription className="text-xs">
              Registra la fecha y lectura de corte. Opcionalmente puedes ingresar lo que vino en el recibo para comparar.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCloseCycle} className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Fecha de Cierre (Corte)</Label>
              <Input
                type="date"
                value={closeEndDate}
                onChange={(e) => setCloseEndDate(e.target.value)}
                required
                className="h-9 text-xs rounded-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Lectura Final del Medidor (kWh)</Label>
              <Input
                type="number"
                step="0.01"
                value={closeEndReading}
                onChange={(e) => setCloseEndReading(e.target.value)}
                required
                className="h-9 text-xs rounded-sm font-mono"
              />
            </div>

            <div className="pt-2 border-t border-border space-y-2">
              <p className="text-[11px] font-medium text-foreground">Datos del Recibo de la Distribuidora (Opcional):</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px]">kWh Facturados</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Ej. 145"
                    value={closeBilledKwh}
                    onChange={(e) => setCloseBilledKwh(e.target.value)}
                    className="h-8 text-xs rounded-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Monto Total (C$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Ej. 1020.50"
                    value={closeBilledAmount}
                    onChange={(e) => setCloseBilledAmount(e.target.value)}
                    className="h-8 text-xs rounded-sm font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Número de Factura / NIS</Label>
                <Input
                  placeholder="Ej. FAC-2026-0922"
                  value={closeInvoiceNum}
                  onChange={(e) => setCloseInvoiceNum(e.target.value)}
                  className="h-8 text-xs rounded-sm"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" className="rounded-sm text-xs" onClick={() => setCloseCycleDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="rounded-sm text-xs">
                Confirmar Cierre de Ciclo
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* MODAL: EDITAR CICLO                                              */}
      {/* ═════════════════════════════════════════════════════════════════ */}
      <Dialog open={editCycleDialogOpen} onOpenChange={setEditCycleDialogOpen}>
        <DialogContent className="rounded-sm border-border bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Editar Ciclo de Facturación</DialogTitle>
            <DialogDescription className="text-xs">
              Modifica las fechas, lecturas o datos de facturación asociados.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateCycle} className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Fecha Inicio</Label>
                <Input
                  type="date"
                  value={editCycleStartDate}
                  onChange={(e) => setEditCycleStartDate(e.target.value)}
                  required
                  className="h-8 text-xs rounded-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fecha Fin</Label>
                <Input
                  type="date"
                  value={editCycleEndDate}
                  onChange={(e) => setEditCycleEndDate(e.target.value)}
                  className="h-8 text-xs rounded-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Lectura Inicial (kWh)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editCycleStartReading}
                  onChange={(e) => setEditCycleStartReading(e.target.value)}
                  required
                  className="h-8 text-xs rounded-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Lectura Final (kWh)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editCycleEndReading}
                  onChange={(e) => setEditCycleEndReading(e.target.value)}
                  className="h-8 text-xs rounded-sm font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Estado del Ciclo</Label>
              <Select
                value={editCycleIsActive ? "active" : "closed"}
                onValueChange={(v) => setEditCycleIsActive(v === "active")}
              >
                <SelectTrigger className="h-8 text-xs rounded-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-sm text-xs">
                  <SelectItem value="active">Activo (En curso)</SelectItem>
                  <SelectItem value="closed">Cerrado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="pt-2 border-t border-border space-y-2">
              <p className="text-[11px] font-medium text-foreground">Datos del Recibo Distribuidora:</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px]">kWh Facturados</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editCycleBilledKwh}
                    onChange={(e) => setEditCycleBilledKwh(e.target.value)}
                    className="h-8 text-xs rounded-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Monto (C$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editCycleBilledAmount}
                    onChange={(e) => setEditCycleBilledAmount(e.target.value)}
                    className="h-8 text-xs rounded-sm font-mono"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">No. Factura</Label>
                <Input
                  value={editCycleInvoiceNum}
                  onChange={(e) => setEditCycleInvoiceNum(e.target.value)}
                  className="h-8 text-xs rounded-sm"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" className="rounded-sm text-xs" onClick={() => setEditCycleDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="rounded-sm text-xs">
                Guardar Cambios
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* MODAL: COMPARATIVA RECIBO VS MEDIDOR                             */}
      {/* ═════════════════════════════════════════════════════════════════ */}
      <Dialog open={comparisonDialogOpen} onOpenChange={setComparisonDialogOpen}>
        <DialogContent className="rounded-sm border-border bg-card max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Scale className="size-4" />
              <span>Comparativa: Medidor vs Recibo de Luz</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Auditoría entre las lecturas reales del medidor y lo cobrado por la empresa distribuidora.
            </DialogDescription>
          </DialogHeader>

          {loadingComparison ? (
            <div className="py-8 flex flex-col items-center justify-center text-xs text-muted-foreground space-y-2">
              <Loader2 className="size-5 animate-spin" />
              <span>Calculando comparativa...</span>
            </div>
          ) : comparisonData ? (
            <div className="space-y-4 pt-2">
              {/* Verdict banner */}
              <div className={`p-3 rounded-sm border text-xs space-y-1 ${
                comparisonData.status === "overcharged"
                  ? "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400"
                  : comparisonData.status === "exact"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted/40 border-border text-foreground"
              }`}>
                <div className="font-semibold flex items-center justify-between">
                  <span>Resultado de la Auditoría:</span>
                  <Badge variant="outline" className="text-[10px] rounded-sm py-0 uppercase">
                    {comparisonData.status === "overcharged" ? "Cobro Excesivo" : comparisonData.status === "exact" ? "Conforme" : "Pendiente"}
                  </Badge>
                </div>
                <p className="text-[11px] leading-relaxed">{comparisonData.verdict}</p>
              </div>

              {/* Grid de Comparación */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-sm border border-border bg-muted/20 space-y-1.5">
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground">Tu Medidor</p>
                  <p className="text-xl font-bold font-mono text-foreground">{comparisonData.real_kwh} kWh</p>
                  <div className="space-y-0.5 pt-1 text-[11px] font-mono border-t border-border/60">
                    <p className="font-semibold text-foreground">
                      C$ {comparisonData.calculated_amount.toFixed(2)} (Total Estimado)
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-sm border border-border bg-muted/20 space-y-1.5">
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground">Recibo Distribuidora</p>
                  <p className="text-xl font-bold font-mono text-foreground">
                    {comparisonData.billed_kwh !== null ? `${comparisonData.billed_kwh} kWh` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {comparisonData.billed_amount !== null ? `C$ ${comparisonData.billed_amount.toFixed(2)}` : "No registrado"}
                  </p>
                </div>
              </div>

              {/* Diferenciales */}
              {comparisonData.diff_kwh !== null && (
                <div className="p-2.5 rounded-sm border border-border bg-muted/10 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Diferencia neta:</span>
                  <span className={`font-mono font-bold ${comparisonData.diff_kwh > 0 ? "text-red-500" : "text-emerald-500"}`}>
                    {comparisonData.diff_kwh > 0 ? `+${comparisonData.diff_kwh}` : comparisonData.diff_kwh} kWh
                    {comparisonData.diff_amount !== null && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        ({comparisonData.diff_amount > 0 ? `+C$ ${comparisonData.diff_amount}` : `C$ ${comparisonData.diff_amount}`})
                      </span>
                    )}
                  </span>
                </div>
              )}

              <DialogFooter className="pt-2">
                <Button size="sm" className="rounded-sm text-xs" onClick={() => setComparisonDialogOpen(false)}>
                  Entendido
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* MODAL: EDITAR LECTURA                                            */}
      {/* ═════════════════════════════════════════════════════════════════ */}
      <Dialog open={editReadingDialogOpen} onOpenChange={setEditReadingDialogOpen}>
        <DialogContent className="rounded-sm border-border bg-card max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Editar Lectura</DialogTitle>
            <DialogDescription className="text-xs">
              Corrige el valor numérico de la lectura o la fecha de captura.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateReading} className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Lectura (kWh)</Label>
              <Input
                type="number"
                step="0.01"
                value={editReadingValue}
                onChange={(e) => setEditReadingValue(e.target.value)}
                required
                className="h-9 text-xs rounded-sm font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fecha de Lectura</Label>
              <Input
                type="date"
                value={editReadingDate}
                onChange={(e) => setEditReadingDate(e.target.value)}
                className="h-9 text-xs rounded-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notas</Label>
              <Input
                value={editReadingNotes}
                onChange={(e) => setEditReadingNotes(e.target.value)}
                placeholder="Aclaración opcional"
                className="h-9 text-xs rounded-sm"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" className="rounded-sm text-xs" onClick={() => setEditReadingDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="rounded-sm text-xs">
                Guardar Corrección
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* MODAL: REGISTRAR NUEVA LECTURA                                  */}
      {/* ═════════════════════════════════════════════════════════════════ */}
      <Dialog open={readingDialogOpen} onOpenChange={setReadingDialogOpen}>
        <DialogContent className="rounded-sm border-border bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Registrar Lectura del Medidor</DialogTitle>
            <DialogDescription className="text-xs">
              Puedes ingresar el número directamente o subir una foto para que el OCR autocomplete el valor.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateReading} className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Foto del Medidor (Opcional - OCR en tiempo real)</Label>
              <label className="flex items-center justify-center gap-2 h-9 px-3 border border-dashed border-border rounded-sm cursor-pointer hover:bg-muted/40 transition-colors text-xs text-muted-foreground">
                <Upload className="size-3.5" />
                <span className="truncate">{readingPhoto ? readingPhoto.name : "Seleccionar imagen..."}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoSelect}
                />
              </label>
              {ocrScanning && (
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" /> Analizando dígitos del medidor...
                </p>
              )}
              {ocrConfidence !== null && (
                <p className="text-[10px] text-emerald-500 font-medium">
                  Detectado por OCR (confianza {(ocrConfidence * 100).toFixed(0)}%)
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="modal-reading-val" className="text-xs">Lectura (kWh)</Label>
              <Input
                id="modal-reading-val"
                type="number"
                step="0.01"
                placeholder="Ej. 2265.4"
                value={readingValue}
                onChange={(e) => setReadingValue(e.target.value)}
                required
                className="h-9 text-xs rounded-sm font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="modal-reading-dt" className="text-xs">Fecha de Lectura (Hoy por defecto)</Label>
              <Input
                id="modal-reading-dt"
                type="date"
                value={readingDate}
                onChange={(e) => setReadingDate(e.target.value)}
                className="h-9 text-xs rounded-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="modal-reading-notes" className="text-xs">Notas (Opcional)</Label>
              <Input
                id="modal-reading-notes"
                placeholder="Ej. Lectura de fin de semana"
                value={readingNotes}
                onChange={(e) => setReadingNotes(e.target.value)}
                className="h-9 text-xs rounded-sm"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" className="rounded-sm text-xs" onClick={() => setReadingDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="rounded-sm text-xs" disabled={submittingReading || !readingValue}>
                {submittingReading ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1" />
                    Guardando...
                  </>
                ) : (
                  "Guardar Lectura"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═════════════════════════════════════════════════════════════════ */}
      {/* MODAL: GENERAR REPORTE OFICIAL                                   */}
      {/* ═════════════════════════════════════════════════════════════════ */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="rounded-sm border-border bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Emitir Reporte Oficial de Consumo</DialogTitle>
            <DialogDescription className="text-xs">
              Se creará un documento formal con desglose tarifario y cálculo de subsidio para el ciclo elegido.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGenerateReport} className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Ciclo a Reportar</Label>
              <Select
                value={reportCycleId}
                onValueChange={(val: string | null) => setReportCycleId(val || "all")}
              >
                <SelectTrigger className="h-9 text-xs rounded-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-sm text-xs">
                  {cycles.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      Ciclo {c.start_date} {c.end_date ? `a ${c.end_date}` : "(Activo)"}
                    </SelectItem>
                  ))}
                  {cycles.length === 0 && (
                    <SelectItem value="all">Todas las lecturas registradas</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Título del Reporte (Opcional)</Label>
              <Input
                placeholder="Ej. Reporte Mensual de Energía Eléctrica"
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                className="h-9 text-xs rounded-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Observaciones</Label>
              <Input
                placeholder="Notas adicionales para el reporte"
                value={reportNotes}
                onChange={(e) => setReportNotes(e.target.value)}
                className="h-9 text-xs rounded-sm"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" className="rounded-sm text-xs" onClick={() => setReportDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="rounded-sm text-xs" disabled={generatingReport}>
                {generatingReport ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1" />
                    Generando...
                  </>
                ) : (
                  "Generar Reporte"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Cambiar Contraseña */}
      <ChangePasswordModal
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
    </div>
  );
}
