from sqlalchemy import (
    Column, Integer, Float, String, Text, DateTime, Boolean, Date,
    ForeignKey, func
)
from sqlalchemy.orm import relationship
from app.database import Base
from datetime import datetime, timezone


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    telegram_chat_id = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationships
    cycles = relationship("BillingCycle", back_populates="user", cascade="all, delete-orphan")
    readings = relationship("Reading", back_populates="user", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="user", cascade="all, delete-orphan")


class BillingCycle(Base):
    __tablename__ = "billing_cycles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)
    start_reading = Column(Float, nullable=False)
    end_reading = Column(Float, nullable=True)
    is_active = Column(Boolean, default=True)
    notes = Column(Text, nullable=True)
    billed_kwh = Column(Float, nullable=True)
    billed_amount = Column(Float, nullable=True)
    utility_invoice_number = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationships
    user = relationship("User", back_populates="cycles")
    readings = relationship("Reading", back_populates="billing_cycle", order_by="Reading.created_at")
    reports = relationship("Report", back_populates="billing_cycle")


class Reading(Base):
    __tablename__ = "readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reading_kwh = Column(Float, nullable=False)
    photo_path = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    source = Column(String(20), default="web")  # 'web', 'telegram', 'ocr'
    ocr_raw_value = Column(String(50), nullable=True)  # Raw OCR result for audit
    ocr_confidence = Column(Float, nullable=True)
    billing_cycle_id = Column(Integer, ForeignKey("billing_cycles.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationships
    user = relationship("User", back_populates="readings")
    billing_cycle = relationship("BillingCycle", back_populates="readings")


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    billing_cycle_id = Column(Integer, ForeignKey("billing_cycles.id"), nullable=True)
    title = Column(String(150), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    kwh_consumed = Column(Float, default=0.0)
    total_cost = Column(Float, default=0.0)
    daily_avg_kwh = Column(Float, default=0.0)
    projected_kwh = Column(Float, default=0.0)
    subsidy_status = Column(String(50), default="dentro_limite")  # 'dentro_limite', 'en_riesgo', 'excedido'
    pdf_path = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationships
    user = relationship("User", back_populates="reports")
    billing_cycle = relationship("BillingCycle", back_populates="reports")


class TariffBlock(Base):
    """Configurable tariff blocks - user can update when INE publishes new rates."""
    __tablename__ = "tariff_blocks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    min_kwh = Column(Float, nullable=False)
    max_kwh = Column(Float, nullable=False)
    price_per_kwh = Column(Float, nullable=False)
    is_subsidized = Column(Boolean, default=True)
    display_order = Column(Integer, default=0)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Setting(Base):
    """Key-value settings for the app."""
    __tablename__ = "settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False)
    description = Column(String(255), nullable=True)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
