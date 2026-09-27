"""Dashboard and analytics router."""
from datetime import date, datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import Reading, BillingCycle, User
from app.schemas import DashboardResponse, ReadingResponse
from app.routers.auth import get_current_user
from app.services.tariff import calculate_cost, get_subsidy_threshold

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/", response_model=DashboardResponse)
def get_dashboard(
    cycle_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Main dashboard data: current consumption, projections, costs for current user.
    Optionally accepts cycle_id to view any historic or active cycle.
    """
    selected_cycle = None
    if cycle_id:
        selected_cycle = (
            db.query(BillingCycle)
            .filter(BillingCycle.id == cycle_id, BillingCycle.user_id == current_user.id)
            .first()
        )
    if not selected_cycle:
        # Default to active cycle for user
        selected_cycle = (
            db.query(BillingCycle)
            .filter(BillingCycle.user_id == current_user.id, BillingCycle.is_active == True)
            .first()
        )
    if not selected_cycle:
        # Fallback to most recent cycle for user
        selected_cycle = (
            db.query(BillingCycle)
            .filter(BillingCycle.user_id == current_user.id)
            .order_by(BillingCycle.start_date.desc(), BillingCycle.id.desc())
            .first()
        )

    # Get readings for this user / cycle
    recent_query = db.query(Reading).filter(Reading.user_id == current_user.id)
    if selected_cycle:
        recent_query = recent_query.filter(
            (Reading.billing_cycle_id == selected_cycle.id) |
            ((Reading.created_at >= selected_cycle.start_date) & 
             ((Reading.created_at <= selected_cycle.end_date) if selected_cycle.end_date else True))
        )
    recent = recent_query.order_by(Reading.created_at.desc()).limit(30).all()

    if not selected_cycle:
        return DashboardResponse(
            recent_readings=[ReadingResponse.model_validate(r) for r in recent],
        )

    # Determine current reading
    if selected_cycle.end_reading is not None:
        current_reading = selected_cycle.end_reading
        previous_reading = recent[0].reading_kwh if recent else selected_cycle.start_reading
    elif recent:
        current_reading = recent[0].reading_kwh
        previous_reading = recent[1].reading_kwh if len(recent) > 1 else selected_cycle.start_reading
    else:
        current_reading = selected_cycle.start_reading
        previous_reading = selected_cycle.start_reading

    start_reading = selected_cycle.start_reading
    kwh_consumed = round(max(current_reading - start_reading, 0.0), 2)

    # Days calculation
    if selected_cycle.end_date:
        days_elapsed = max((selected_cycle.end_date - selected_cycle.start_date).days, 1)
        days_remaining = 0
    else:
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo("America/Managua")).date()
        days_elapsed = max((today - selected_cycle.start_date).days, 1)
        days_remaining = max(30 - days_elapsed, 0)

    daily_average = round(kwh_consumed / days_elapsed, 2) if days_elapsed > 0 else 0
    projected_monthly = kwh_consumed if not selected_cycle.is_active else round(daily_average * 30, 2)

    cost_data = calculate_cost(db, projected_monthly)
    current_cost_data = calculate_cost(db, kwh_consumed)
    subsidy_threshold = get_subsidy_threshold(db)

    return DashboardResponse(
        cycle_id=selected_cycle.id,
        cycle_is_active=selected_cycle.is_active,
        cycle_start_date=selected_cycle.start_date,
        cycle_end_date=selected_cycle.end_date,
        cycle_start_reading=selected_cycle.start_reading,
        cycle_end_reading=selected_cycle.end_reading,
        current_reading=current_reading,
        previous_reading=previous_reading,
        kwh_consumed=kwh_consumed,
        days_elapsed=days_elapsed,
        daily_average=daily_average,
        projected_monthly=projected_monthly,
        projected_cost=cost_data["total"],
        days_remaining=days_remaining,
        kwh_remaining_for_subsidy=round(max(subsidy_threshold - kwh_consumed, 0), 2),
        subsidy_at_risk=projected_monthly > subsidy_threshold,
        cost_breakdown=current_cost_data["breakdown"],
        energy_cost=current_cost_data["energy_cost"],
        fixed_charge=current_cost_data["fixed_charge"],
        alumbrado=current_cost_data.get("alumbrado", 0.0),
        regulacion_ine=current_cost_data.get("regulacion_ine", 0.0),
        iva=current_cost_data.get("iva", 0.0),
        current_cost=current_cost_data["total"],
        recent_readings=[ReadingResponse.model_validate(r) for r in recent],
        billed_kwh=selected_cycle.billed_kwh,
        billed_amount=selected_cycle.billed_amount,
    )


@router.get("/daily-consumption")
def get_daily_consumption(
    days: int = 30,
    cycle_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get daily consumption data for charts.
    Interpolates missing days by distributing the delta evenly across unrecorded days.
    Marks peak day of consumption.
    """
    cycle = None
    if cycle_id:
        cycle = db.query(BillingCycle).filter(BillingCycle.id == cycle_id, BillingCycle.user_id == current_user.id).first()
    if not cycle:
        cycle = db.query(BillingCycle).filter(BillingCycle.user_id == current_user.id, BillingCycle.is_active == True).first()

    query = db.query(Reading).filter(Reading.user_id == current_user.id)
    if cycle:
        query = query.filter(
            (Reading.billing_cycle_id == cycle.id) |
            ((Reading.created_at >= cycle.start_date) &
             ((Reading.created_at <= cycle.end_date) if cycle.end_date else True))
        )
    readings = query.order_by(Reading.created_at.asc()).limit(days + 1).all()

    # Prepend cycle baseline if available and first reading is after cycle start
    points = []
    if cycle and readings:
        first_r_date = readings[0].created_at.date()
        if first_r_date > cycle.start_date:
            points.append({
                "date": cycle.start_date,
                "reading_kwh": cycle.start_reading,
                "source": "ciclo_inicio",
            })
    for r in readings:
        points.append({
            "date": r.created_at.date(),
            "reading_kwh": r.reading_kwh,
            "source": r.source,
        })

    # If cycle is closed with end_reading and end_date, ensure end point is represented
    if cycle and cycle.end_reading is not None and cycle.end_date:
        if not points or points[-1]["date"] < cycle.end_date:
            points.append({
                "date": cycle.end_date,
                "reading_kwh": cycle.end_reading,
                "source": "corte_ciclo",
            })

    daily_data = []
    for i in range(1, len(points)):
        prev = points[i - 1]
        curr = points[i]
        delta_kwh = max(round(curr["reading_kwh"] - prev["reading_kwh"], 2), 0.0)
        delta_days = max((curr["date"] - prev["date"]).days, 1)
        daily_avg = round(delta_kwh / delta_days, 2)

        # Si pasaron varios días sin registro, repartir promedio diario equitativamente
        if delta_days > 1:
            for d in range(1, delta_days):
                missing_date = prev["date"] + timedelta(days=d)
                daily_data.append({
                    "date": missing_date.isoformat(),
                    "reading": round(prev["reading_kwh"] + (daily_avg * d), 2),
                    "delta_kwh": daily_avg,
                    "daily_avg": daily_avg,
                    "source": "promediado",
                    "is_interpolated": True,
                })

        daily_data.append({
            "date": curr["date"].isoformat(),
            "reading": curr["reading_kwh"],
            "delta_kwh": daily_avg if delta_days > 1 else delta_kwh,
            "daily_avg": daily_avg,
            "source": curr["source"],
            "is_interpolated": delta_days > 1,
        })

    # Determine peak day
    max_kwh = 0.0
    for d in daily_data:
        if d["delta_kwh"] > max_kwh:
            max_kwh = d["delta_kwh"]

    for d in daily_data:
        d["is_peak"] = (d["delta_kwh"] == max_kwh and max_kwh > 0)
        d["peak_kwh"] = max_kwh

    return daily_data
