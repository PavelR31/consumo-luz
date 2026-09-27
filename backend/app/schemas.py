from pydantic import BaseModel, field_validator
from datetime import datetime, date
from typing import Optional


# ── Auth ──────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserResponse(BaseModel):
    id: int
    username: str
    is_active: bool
    created_at: datetime
    telegram_chat_id: Optional[str] = None

    model_config = {"from_attributes": True}


class ChangePasswordRequest(BaseModel):
    """Used by logged-in user to change their own password (requires current password)."""
    current_password: str
    new_password: str
    confirm_password: str


class AdminResetPasswordRequest(BaseModel):
    """Used via curl by admin - requires the ADMIN_SECRET_KEY from .env."""
    admin_secret: str
    new_password: str


# ── Readings ──────────────────────────────────────────────────────────
class ReadingCreate(BaseModel):
    reading_kwh: float
    notes: Optional[str] = None
    reading_date: Optional[str] = None

    @field_validator("reading_kwh")
    @classmethod
    def validate_reading(cls, v):
        if v < 0:
            raise ValueError("La lectura no puede ser negativa")
        if v > 999999:
            raise ValueError("Lectura fuera de rango")
        return v

class ReadingUpdate(BaseModel):
    reading_kwh: Optional[float] = None
    notes: Optional[str] = None
    reading_date: Optional[str] = None
    billing_cycle_id: Optional[int] = None

class ReadingResponse(BaseModel):
    id: int
    reading_kwh: float
    photo_path: Optional[str] = None
    notes: Optional[str] = None
    source: str
    ocr_raw_value: Optional[str] = None
    ocr_confidence: Optional[float] = None
    billing_cycle_id: Optional[int] = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Billing Cycles ───────────────────────────────────────────────────
class BillingCycleCreate(BaseModel):
    start_date: date
    start_reading: float
    notes: Optional[str] = None

class BillingCycleUpdate(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    start_reading: Optional[float] = None
    end_reading: Optional[float] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None
    billed_kwh: Optional[float] = None
    billed_amount: Optional[float] = None
    utility_invoice_number: Optional[str] = None

class BillingCycleClose(BaseModel):
    end_date: date
    end_reading: float
    notes: Optional[str] = None
    billed_kwh: Optional[float] = None
    billed_amount: Optional[float] = None
    utility_invoice_number: Optional[str] = None

class BillingCycleResponse(BaseModel):
    id: int
    start_date: date
    end_date: Optional[date] = None
    start_reading: float
    end_reading: Optional[float] = None
    is_active: bool
    notes: Optional[str] = None
    billed_kwh: Optional[float] = None
    billed_amount: Optional[float] = None
    utility_invoice_number: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class CycleComparisonResponse(BaseModel):
    cycle_id: int
    start_date: date
    end_date: Optional[date] = None
    real_kwh: float
    calculated_amount: float
    billed_kwh: Optional[float] = None
    billed_amount: Optional[float] = None
    utility_invoice_number: Optional[str] = None
    diff_kwh: Optional[float] = None
    diff_amount: Optional[float] = None
    status: str  # 'exact', 'overcharged', 'undercharged', 'pending_bill'
    verdict: str


# ── Tariff ───────────────────────────────────────────────────────────
class TariffBlockCreate(BaseModel):
    name: str
    min_kwh: float
    max_kwh: float
    price_per_kwh: float
    is_subsidized: bool = True
    display_order: int = 0

class TariffBlockResponse(BaseModel):
    id: int
    name: str
    min_kwh: float
    max_kwh: float
    price_per_kwh: float
    is_subsidized: bool
    display_order: int
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Dashboard / Analytics ────────────────────────────────────────────
class DashboardResponse(BaseModel):
    cycle_id: Optional[int] = None
    cycle_is_active: Optional[bool] = None
    cycle_start_date: Optional[date] = None
    cycle_end_date: Optional[date] = None
    cycle_start_reading: Optional[float] = None
    cycle_end_reading: Optional[float] = None
    current_reading: Optional[float] = None
    previous_reading: Optional[float] = None
    kwh_consumed: float = 0
    days_elapsed: int = 0
    daily_average: float = 0
    projected_monthly: float = 0
    projected_cost: float = 0
    days_remaining: int = 0
    kwh_remaining_for_subsidy: float = 150
    subsidy_at_risk: bool = False
    cost_breakdown: list[dict] = []
    energy_cost: float = 0
    fixed_charge: float = 0
    alumbrado: float = 0
    regulacion_ine: float = 0
    iva: float = 0
    current_cost: float = 0
    recent_readings: list[ReadingResponse] = []
    billed_kwh: Optional[float] = None
    billed_amount: Optional[float] = None

class CostBreakdown(BaseModel):
    block_name: str
    kwh: float
    price_per_kwh: float
    subtotal: float


# ── OCR ──────────────────────────────────────────────────────────────
class OCRResult(BaseModel):
    detected_value: Optional[float] = None
    raw_text: str = ""
    confidence: float = 0.0
    success: bool = False
    message: str = ""


# ── Reports ───────────────────────────────────────────────────────────
class ReportCreate(BaseModel):
    billing_cycle_id: Optional[int] = None
    title: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    notes: Optional[str] = None


class ReportResponse(BaseModel):
    id: int
    user_id: int
    billing_cycle_id: Optional[int] = None
    title: str
    start_date: date
    end_date: date
    kwh_consumed: float
    total_cost: float
    daily_avg_kwh: float
    projected_kwh: float
    subsidy_status: str
    pdf_path: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
