"""Billing cycles and tariff management router."""
from datetime import date, datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BillingCycle, TariffBlock, Setting, User, Reading, Report
from app.schemas import (
    BillingCycleCreate, BillingCycleUpdate, BillingCycleClose,
    BillingCycleResponse, CycleComparisonResponse,
    TariffBlockCreate, TariffBlockResponse,
)
from app.routers.auth import get_current_user
from app.services.tariff import calculate_cost

router = APIRouter(prefix="/api", tags=["billing", "tariffs"])


# ── Billing Cycles CRUD ──────────────────────────────────────────────
@router.get("/cycles", response_model=list[BillingCycleResponse])
def get_cycles(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get all billing cycles for the current user."""
    return (
        db.query(BillingCycle)
        .filter(BillingCycle.user_id == current_user.id)
        .order_by(BillingCycle.start_date.desc(), BillingCycle.id.desc())
        .all()
    )


@router.get("/cycles/suggested-start")
def get_suggested_start(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get suggested start values for a new cycle based on the last closed cycle or last reading.
    (Requirement 13: El final del consumo de un ciclo es automáticamente el nuevo inicio del otro).
    """
    # 1. Check last closed cycle
    last_cycle = (
        db.query(BillingCycle)
        .filter(BillingCycle.user_id == current_user.id)
        .order_by(BillingCycle.start_date.desc(), BillingCycle.id.desc())
        .first()
    )
    if last_cycle and last_cycle.end_reading is not None:
        return {
            "start_date": last_cycle.end_date.isoformat() if last_cycle.end_date else date.today().isoformat(),
            "start_reading": last_cycle.end_reading,
            "source": "last_cycle_end",
        }

    # 2. Check last reading
    last_reading = (
        db.query(Reading)
        .filter(Reading.user_id == current_user.id)
        .order_by(Reading.created_at.desc())
        .first()
    )
    if last_reading:
        return {
            "start_date": last_reading.created_at.date().isoformat(),
            "start_reading": last_reading.reading_kwh,
            "source": "last_reading",
        }

    # 3. Default fresh start
    return {
        "start_date": date.today().isoformat(),
        "start_reading": 0.0,
        "source": "default",
    }


@router.get("/cycles/{cycle_id}", response_model=BillingCycleResponse)
def get_cycle(
    cycle_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a specific cycle."""
    cycle = (
        db.query(BillingCycle)
        .filter(BillingCycle.id == cycle_id, BillingCycle.user_id == current_user.id)
        .first()
    )
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo no encontrado")
    return cycle


@router.post("/cycles", response_model=BillingCycleResponse)
def create_cycle(
    data: BillingCycleCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Start a new billing cycle.
    Rule: Solo se puede tener un ciclo activo a la vez.
    If an active cycle exists, it is closed at data.start_date / data.start_reading.
    """
    active_cycles = (
        db.query(BillingCycle)
        .filter(BillingCycle.user_id == current_user.id, BillingCycle.is_active == True)
        .all()
    )
    for act in active_cycles:
        act.is_active = False
        if not act.end_date:
            act.end_date = data.start_date
        if act.end_reading is None:
            act.end_reading = data.start_reading

    cycle = BillingCycle(
        user_id=current_user.id,
        start_date=data.start_date,
        start_reading=data.start_reading,
        notes=data.notes,
        is_active=True,
    )
    db.add(cycle)
    db.commit()
    db.refresh(cycle)

    # Link unlinked or subsequent readings of this user from start_date onwards
    readings = (
        db.query(Reading)
        .filter(
            Reading.user_id == current_user.id,
            Reading.created_at >= data.start_date
        )
        .all()
    )
    for r in readings:
        if r.billing_cycle_id is None or r.billing_cycle_id in [a.id for a in active_cycles]:
            r.billing_cycle_id = cycle.id
    db.commit()

    return cycle


@router.put("/cycles/{cycle_id}", response_model=BillingCycleResponse)
def update_cycle(
    cycle_id: int,
    data: BillingCycleUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Edit an existing cycle (dates, readings, status, notes, invoice comparison data).
    If marking this cycle as active, deactivates all other cycles for this user.
    """
    cycle = (
        db.query(BillingCycle)
        .filter(BillingCycle.id == cycle_id, BillingCycle.user_id == current_user.id)
        .first()
    )
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo no encontrado")

    if data.is_active is True and not cycle.is_active:
        # Deactivate all other cycles
        other_actives = (
            db.query(BillingCycle)
            .filter(BillingCycle.user_id == current_user.id, BillingCycle.id != cycle_id, BillingCycle.is_active == True)
            .all()
        )
        for other in other_actives:
            other.is_active = False

    if data.start_date is not None:
        cycle.start_date = data.start_date
    if data.end_date is not None:
        cycle.end_date = data.end_date
    if data.start_reading is not None:
        cycle.start_reading = data.start_reading
    if data.end_reading is not None:
        cycle.end_reading = data.end_reading
    if data.is_active is not None:
        cycle.is_active = data.is_active
    if data.notes is not None:
        cycle.notes = data.notes
    if data.billed_kwh is not None:
        cycle.billed_kwh = data.billed_kwh
    if data.billed_amount is not None:
        cycle.billed_amount = data.billed_amount
    if data.utility_invoice_number is not None:
        cycle.utility_invoice_number = data.utility_invoice_number

    db.commit()
    db.refresh(cycle)
    return cycle


@router.put("/cycles/{cycle_id}/close", response_model=BillingCycleResponse)
def close_cycle(
    cycle_id: int,
    data: BillingCycleClose,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Close an active billing cycle with end date, end reading, and optional utility bill data."""
    cycle = (
        db.query(BillingCycle)
        .filter(BillingCycle.id == cycle_id, BillingCycle.user_id == current_user.id)
        .first()
    )
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo no encontrado")

    if data.end_reading < cycle.start_reading:
        raise HTTPException(
            status_code=400,
            detail=f"La lectura de cierre ({data.end_reading}) no puede ser menor a la de inicio ({cycle.start_reading})"
        )

    cycle.end_date = data.end_date
    cycle.end_reading = data.end_reading
    cycle.is_active = False
    if data.notes is not None:
        cycle.notes = data.notes
    if data.billed_kwh is not None:
        cycle.billed_kwh = data.billed_kwh
    if data.billed_amount is not None:
        cycle.billed_amount = data.billed_amount
    if data.utility_invoice_number is not None:
        cycle.utility_invoice_number = data.utility_invoice_number

    db.commit()
    db.refresh(cycle)
    return cycle


@router.delete("/cycles/{cycle_id}")
def delete_cycle(
    cycle_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a billing cycle."""
    cycle = (
        db.query(BillingCycle)
        .filter(BillingCycle.id == cycle_id, BillingCycle.user_id == current_user.id)
        .first()
    )
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo no encontrado")

    # Unlink readings from this cycle
    db.query(Reading).filter(Reading.billing_cycle_id == cycle_id).update({"billing_cycle_id": None})
    # Remove reports linked to this cycle
    db.query(Report).filter(Report.billing_cycle_id == cycle_id).delete()

    db.delete(cycle)
    db.commit()
    return {"detail": "Ciclo eliminado correctamente"}


# ── Comparativa: Medidor vs Recibo de Luz ─────────────────────────────
@router.get("/cycles/{cycle_id}/comparison", response_model=CycleComparisonResponse)
def get_cycle_comparison(
    cycle_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Compara lo registrado por el medidor en el ciclo vs lo cobrado en el recibo de la distribuidora.
    """
    cycle = (
        db.query(BillingCycle)
        .filter(BillingCycle.id == cycle_id, BillingCycle.user_id == current_user.id)
        .first()
    )
    if not cycle:
        raise HTTPException(status_code=404, detail="Ciclo no encontrado")

    # Determine real consumption
    if cycle.end_reading is not None:
        real_kwh = round(max(cycle.end_reading - cycle.start_reading, 0.0), 2)
    else:
        # Get latest reading for cycle
        latest = (
            db.query(Reading)
            .filter(Reading.billing_cycle_id == cycle.id)
            .order_by(Reading.created_at.desc())
            .first()
        )
        if latest:
            real_kwh = round(max(latest.reading_kwh - cycle.start_reading, 0.0), 2)
        else:
            real_kwh = 0.0

    calc_data = calculate_cost(db, real_kwh)
    calculated_amount = calc_data["total"]

    diff_kwh = None
    diff_amount = None
    status = "pending_bill"
    verdict = "Pendiente de ingresar datos de la factura/recibo."

    if cycle.billed_kwh is not None:
        diff_kwh = round(cycle.billed_kwh - real_kwh, 2)
    if cycle.billed_amount is not None:
        diff_amount = round(cycle.billed_amount - calculated_amount, 2)

    if cycle.billed_kwh is not None or cycle.billed_amount is not None:
        if (diff_kwh is not None and diff_kwh > 2.0) or (diff_amount is not None and diff_amount > 15.0):
            status = "overcharged"
            verdict = f"La distribuidora cobró más que tu medidor ({abs(diff_kwh or 0)} kWh / C$ {abs(diff_amount or 0)} de más)."
        elif (diff_kwh is not None and diff_kwh < -2.0) or (diff_amount is not None and diff_amount < -15.0):
            status = "undercharged"
            verdict = f"La factura vino por debajo de tu medidor ({abs(diff_kwh or 0)} kWh menos)."
        else:
            status = "exact"
            verdict = "Consumo facturado conforme con la lectura del medidor."

    return CycleComparisonResponse(
        cycle_id=cycle.id,
        start_date=cycle.start_date,
        end_date=cycle.end_date,
        real_kwh=real_kwh,
        calculated_amount=calculated_amount,
        billed_kwh=cycle.billed_kwh,
        billed_amount=cycle.billed_amount,
        utility_invoice_number=cycle.utility_invoice_number,
        diff_kwh=diff_kwh,
        diff_amount=diff_amount,
        status=status,
        verdict=verdict,
    )


# ── Tariff Blocks ────────────────────────────────────────────────────
@router.get("/tariffs", response_model=list[TariffBlockResponse])
def get_tariffs(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get all tariff blocks."""
    return db.query(TariffBlock).order_by(TariffBlock.display_order).all()


@router.put("/tariffs/{tariff_id}", response_model=TariffBlockResponse)
def update_tariff(
    tariff_id: int,
    data: TariffBlockCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a tariff block (when INE publishes new rates)."""
    tariff = db.query(TariffBlock).filter(TariffBlock.id == tariff_id).first()
    if not tariff:
        raise HTTPException(status_code=404, detail="Bloque tarifario no encontrado")

    tariff.name = data.name
    tariff.min_kwh = data.min_kwh
    tariff.max_kwh = data.max_kwh
    tariff.price_per_kwh = data.price_per_kwh
    tariff.is_subsidized = data.is_subsidized
    tariff.display_order = data.display_order
    db.commit()
    db.refresh(tariff)
    return tariff
