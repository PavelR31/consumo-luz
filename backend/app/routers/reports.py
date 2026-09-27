"""Reports router — CRUD for consumption reports and PDF generation."""
import os
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException, status, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import Reading, BillingCycle, User, Report
from app.schemas import ReportCreate, ReportResponse
from app.routers.auth import get_current_user
from app.config import get_settings
from app.services.tariff import calculate_cost, get_subsidy_threshold

router = APIRouter(prefix="/api/reports", tags=["reports"])
settings = get_settings()


def _get_cycle_data(db: Session, cycle: BillingCycle, user: User):
    """Collect all readings for a billing cycle and compute complete summary."""
    # Find all readings belonging to this cycle or within its date range for this user
    end_limit = cycle.end_date if cycle.end_date else date.today() + timedelta(days=1)
    readings = (
        db.query(Reading)
        .filter(
            Reading.user_id == user.id,
            (Reading.billing_cycle_id == cycle.id) |
            ((func.date(Reading.created_at) >= cycle.start_date) & (func.date(Reading.created_at) <= end_limit))
        )
        .order_by(Reading.created_at.asc())
        .all()
    )

    start_kwh = cycle.start_reading
    today = date.today()
    cycle_end = cycle.end_date if cycle.end_date else today
    days_elapsed = max((cycle_end - cycle.start_date).days, 1)

    if cycle.end_reading is not None:
        latest_kwh = cycle.end_reading
        kwh_consumed = round(max(latest_kwh - start_kwh, 0.0), 2)
    elif readings:
        latest_kwh = readings[-1].reading_kwh
        kwh_consumed = round(max(latest_kwh - start_kwh, 0.0), 2)
    else:
        latest_kwh = start_kwh
        kwh_consumed = 0.0

    daily_avg = round(kwh_consumed / days_elapsed, 2)
    projected = kwh_consumed if not cycle.is_active else round(daily_avg * 30, 2)
    cost_data = calculate_cost(db, kwh_consumed)
    subsidy_thr = get_subsidy_threshold(db)

    # Build daily series
    daily = []
    if len(readings) > 1:
        for i in range(1, len(readings)):
            prev = readings[i - 1]
            curr = readings[i]
            delta = round(curr.reading_kwh - prev.reading_kwh, 2)
            d_days = max((curr.created_at.date() - prev.created_at.date()).days, 1)
            d_avg = round(delta / d_days, 2)

            # Si hay huecos, rellenar con el promedio
            if d_days > 1:
                for d in range(1, d_days):
                    missing_date = prev.created_at.date() + timedelta(days=d)
                    daily.append({
                        "date": missing_date.isoformat(),
                        "reading": round(prev.reading_kwh + (d_avg * d), 2),
                        "delta_kwh": d_avg,
                        "daily_avg": d_avg,
                        "source": "estimado",
                    })

            daily.append({
                "date": curr.created_at.date().isoformat(),
                "reading": curr.reading_kwh,
                "delta_kwh": d_avg if d_days > 1 else delta,
                "daily_avg": d_avg,
                "source": curr.source,
            })
    elif readings:
        curr = readings[0]
        daily.append({
            "date": curr.created_at.date().isoformat(),
            "reading": curr.reading_kwh,
            "delta_kwh": kwh_consumed,
            "daily_avg": daily_avg,
            "source": curr.source,
        })
    else:
        # Fallback reading matching cycle start
        daily.append({
            "date": cycle.start_date.isoformat(),
            "reading": start_kwh,
            "delta_kwh": 0.0,
            "daily_avg": 0.0,
            "source": "inicial",
        })

    subsidy_status = "dentro_limite"
    if kwh_consumed > subsidy_thr:
        subsidy_status = "excedido"
    elif projected > subsidy_thr:
        subsidy_status = "en_riesgo"

    return {
        "cycle": cycle,
        "readings": readings,
        "daily": daily,
        "kwh_consumed": kwh_consumed,
        "days_elapsed": days_elapsed,
        "daily_avg": daily_avg,
        "projected": projected,
        "cost_data": cost_data,
        "subsidy_thr": subsidy_thr,
        "subsidy_status": subsidy_status,
        "at_risk": subsidy_status in ["en_riesgo", "excedido"],
    }


def _build_pdf(info: dict, username: str) -> BytesIO:
    """Build the PDF report using ReportLab and return a BytesIO buffer."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
    )
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title",
        parent=styles["Heading1"],
        fontSize=18,
        leading=22,
        spaceAfter=2,
        textColor=colors.HexColor("#09090b"),
    )
    subtitle_style = ParagraphStyle(
        "Subtitle",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#71717a"),
        spaceAfter=12,
    )
    section_style = ParagraphStyle(
        "Section",
        parent=styles["Heading2"],
        fontSize=11,
        leading=15,
        spaceBefore=14,
        spaceAfter=6,
        textColor=colors.HexColor("#09090b"),
    )
    normal = ParagraphStyle(
        "Body",
        parent=styles["Normal"],
        fontSize=8.5,
        textColor=colors.HexColor("#27272a"),
    )
    label_r = ParagraphStyle(
        "LabelR",
        parent=normal,
        alignment=TA_RIGHT,
    )
    kpi_val = ParagraphStyle(
        "KPIVal",
        parent=styles["Normal"],
        fontSize=13,
        leading=16,
        textColor=colors.HexColor("#09090b"),
    )
    kpi_sub = ParagraphStyle(
        "KPISub",
        parent=styles["Normal"],
        fontSize=7.5,
        textColor=colors.HexColor("#71717a"),
    )

    cycle: BillingCycle = info["cycle"]
    cost = info["cost_data"]
    story = []

    # Header
    story.append(Paragraph("Consumo Luz — Reporte Oficial de Consumo", title_style))
    story.append(
        Paragraph(
            f"Usuario: <b>{username}</b> &nbsp;|&nbsp; "
            f"Generado: {datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M UTC')} &nbsp;|&nbsp; "
            f"Normativa INE Nicaragua (T-0)",
            subtitle_style,
        )
    )
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e4e4e7"), spaceAfter=10))

    # Cycle details table
    cycle_end_str = cycle.end_date.strftime("%d/%m/%Y") if cycle.end_date else f"En curso ({info['days_elapsed']} días)"
    cycle_meta = [
        [
            Paragraph("<b>Inicio de Ciclo:</b>", normal),
            Paragraph(cycle.start_date.strftime("%d/%m/%Y"), normal),
            Paragraph("<b>Lectura Inicial:</b>", normal),
            Paragraph(f"{cycle.start_reading:,.2f} kWh", normal),
        ],
        [
            Paragraph("<b>Fin de Ciclo:</b>", normal),
            Paragraph(cycle_end_str, normal),
            Paragraph("<b>Lectura Actual:</b>", normal),
            Paragraph(
                f"{info['readings'][-1].reading_kwh:,.2f} kWh" if info["readings"] else f"{cycle.start_reading:,.2f} kWh",
                normal,
            ),
        ],
        [
            Paragraph("<b>Días Transcurridos:</b>", normal),
            Paragraph(f"{info['days_elapsed']} días", normal),
            Paragraph("<b>Estado de Subsidio:</b>", normal),
            Paragraph(
                "<font color='#dc2626'><b>Excedido (&gt; 150 kWh)</b></font>" if info["subsidy_status"] == "excedido"
                else "<font color='#d97706'><b>En riesgo</b></font>" if info["subsidy_status"] == "en_riesgo"
                else "<font color='#16a34a'><b>Dentro del límite (≤ 150 kWh)</b></font>",
                normal,
            ),
        ],
    ]
    t_meta = Table(cycle_meta, colWidths=[3.2 * cm, 4.5 * cm, 3.5 * cm, 4.5 * cm])
    t_meta.setStyle(
        TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#f1f5f9")),
        ])
    )
    story.append(t_meta)
    story.append(Spacer(1, 10))

    # KPI summary row
    kpi_data = [
        [
            Paragraph(f"<b>{info['kwh_consumed']} kWh</b>", kpi_val),
            Paragraph(f"<b>{info['daily_avg']} kWh/d</b>", kpi_val),
            Paragraph(f"<b>{info['projected']} kWh</b>", kpi_val),
            Paragraph(f"<b>C${cost['total']:,.2f}</b>", kpi_val),
        ],
        [
            Paragraph("Consumo acumulado", kpi_sub),
            Paragraph("Promedio diario", kpi_sub),
            Paragraph("Proyección 30 días", kpi_sub),
            Paragraph("Costo estimado total", kpi_sub),
        ],
    ]
    t_kpi = Table(kpi_data, colWidths=[4.2 * cm, 4.2 * cm, 4.2 * cm, 4.2 * cm])
    t_kpi.setStyle(
        TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f4f4f5")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e4e4e7")),
        ])
    )
    story.append(t_kpi)
    story.append(Spacer(1, 10))

    # Cost breakdown table
    story.append(Paragraph("Desglose Tarifario Oficial", section_style))
    cost_rows = [
        [
            Paragraph("<b>Bloque</b>", normal),
            Paragraph("<b>Rango kWh</b>", normal),
            Paragraph("<b>Consumo</b>", label_r),
            Paragraph("<b>Tarifa (C$/kWh)</b>", label_r),
            Paragraph("<b>Subtotal (C$)</b>", label_r),
        ]
    ]
    for b in cost["breakdown"]:
        cost_rows.append([
            Paragraph(b["block_name"], normal),
            Paragraph(b.get("range", "—"), normal),
            Paragraph(f"{b['kwh']:.2f}", label_r),
            Paragraph(f"C${b['price_per_kwh']:.4f}", label_r),
            Paragraph(f"C${b['subtotal']:,.2f}", label_r),
        ])

    cost_rows.append([
        Paragraph("Alumbrado Público (Aprox.)", normal),
        Paragraph("Estimado", normal),
        Paragraph("—", label_r),
        Paragraph("—", label_r),
        Paragraph(f"C${cost.get('alumbrado', 0.0):,.2f}", label_r),
    ])
    cost_rows.append([
        Paragraph("Cargo de Comercialización", normal),
        Paragraph("Mensual", normal),
        Paragraph("—", label_r),
        Paragraph("—", label_r),
        Paragraph(f"C${cost['fixed_charge']:,.2f}", label_r),
    ])
    cost_rows.append([
        Paragraph("Regulación INE (1%)", normal),
        Paragraph("INE", normal),
        Paragraph("—", label_r),
        Paragraph("—", label_r),
        Paragraph(f"C${cost.get('regulacion_ine', 0.0):,.2f}", label_r),
    ])
    if cost.get("iva", 0.0) > 0:
        cost_rows.append([
            Paragraph("IVA (15%)", normal),
            Paragraph("Impuesto", normal),
            Paragraph("—", label_r),
            Paragraph("—", label_r),
            Paragraph(f"C${cost['iva']:,.2f}", label_r),
        ])
    cost_rows.append([
        Paragraph("<b>Total Estimado Factura</b>", normal),
        Paragraph("", normal),
        Paragraph(f"<b>{info['kwh_consumed']:.2f} kWh</b>", label_r),
        Paragraph("", label_r),
        Paragraph(f"<b>C${cost['total']:,.2f}</b>", label_r),
    ])

    t_cost = Table(cost_rows, colWidths=[4.5 * cm, 3.2 * cm, 2.8 * cm, 3.2 * cm, 3.1 * cm])
    t_cost.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f4f4f5")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("LINEBELOW", (0, 0), (-1, 0), 1, colors.HexColor("#71717a")),
            ("LINEABOVE", (0, -1), (-1, -1), 1, colors.HexColor("#09090b")),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#fafafa")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e4e4e7")),
            ("INNERGRID", (0, 0), (-1, -2), 0.5, colors.HexColor("#f4f4f5")),
        ])
    )
    story.append(t_cost)
    story.append(Spacer(1, 10))

    # Visual Pie Chart for Cost & Consumption Breakdown
    active_blocks = [b for b in cost["breakdown"] if b["kwh"] > 0]
    if active_blocks:
        story.append(Paragraph("Distribución de Consumo por Bloque Tarifario (INE)", section_style))
        from reportlab.graphics.shapes import Drawing
        from reportlab.graphics.charts.piecharts import Pie
        from reportlab.graphics.charts.legends import Legend

        d = Drawing(480, 140)
        pc = Pie()
        pc.x = 20
        pc.y = 10
        pc.width = 120
        pc.height = 120
        pc.data = [b["kwh"] for b in active_blocks]
        pc.labels = [f"{b['kwh']:.1f} kWh" for b in active_blocks]
        
        palette = [
            colors.HexColor("#18181b"),
            colors.HexColor("#3f3f46"),
            colors.HexColor("#71717a"),
            colors.HexColor("#a1a1aa"),
            colors.HexColor("#d4d4d8"),
        ]
        for i, color in enumerate(palette[:len(active_blocks)]):
            pc.slices[i].fillColor = color
            pc.slices[i].strokeColor = colors.white
            pc.slices[i].strokeWidth = 1

        legend = Legend()
        legend.x = 180
        legend.y = 110
        legend.dx = 8
        legend.dy = 8
        legend.fontName = "Helvetica"
        legend.fontSize = 8
        legend.boxAnchor = "nw"
        legend.columnMaximum = 6
        legend.colorNamePairs = [(palette[i % len(palette)], f"{b['block_name']} ({b['kwh']:.1f} kWh — C${b['subtotal']:.2f})") for i, b in enumerate(active_blocks)]

        d.add(pc)
        d.add(legend)
        story.append(d)
        story.append(Spacer(1, 10))

    # Daily Readings History Table
    story.append(Paragraph("Registro de Consumo Diario (kWh/día)", section_style))
    read_rows = [
        [
            Paragraph("<b>Fecha</b>", normal),
            Paragraph("<b>Lectura (kWh)</b>", label_r),
            Paragraph("<b>Consumo Día</b>", label_r),
            Paragraph("<b>Tipo</b>", normal),
            Paragraph("<b>Detalle</b>", normal),
        ]
    ]

    max_delta = max([d["delta_kwh"] for d in info["daily"]], default=0.0)

    for d in info["daily"]:
        is_peak = (d["delta_kwh"] == max_delta and max_delta > 0)
        tipo = "Promediado" if d["source"] == "estimado" or d["source"] == "promediado" else "Medidor"
        detalle = "<b>Día de mayor consumo (Pico)</b>" if is_peak else ("Interpolación de días sin toma" if tipo == "Promediado" else "Registro real")
        read_rows.append([
            Paragraph(d["date"], normal),
            Paragraph(f"{d['reading']:,.2f}", label_r),
            Paragraph(f"{d['delta_kwh']:.2f} kWh", label_r),
            Paragraph(tipo, normal),
            Paragraph(detalle, normal),
        ])

    t_read = Table(read_rows, colWidths=[3.8 * cm, 3.2 * cm, 3.2 * cm, 2.8 * cm, 3.8 * cm])
    t_read.setStyle(
        TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f4f4f5")),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("LINEBELOW", (0, 0), (-1, 0), 0.8, colors.HexColor("#71717a")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e4e4e7")),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#f4f4f5")),
        ])
    )
    story.append(t_read)

    doc.build(story)
    buf.seek(0)
    return buf


# ── CRUD DE REPORTES ──────────────────────────────────────────────────

@router.get("/", response_model=list[ReportResponse])
def list_reports(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all saved reports for the authenticated user."""
    reports = (
        db.query(Report)
        .filter(Report.user_id == current_user.id)
        .order_by(Report.created_at.desc())
        .all()
    )
    return reports


@router.post("/", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
def create_report(
    data: ReportCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Generate and save a new consumption report.
    Calculates metrics, generates PDF buffer, and saves metadata into DB.
    """
    if data.billing_cycle_id:
        cycle = (
            db.query(BillingCycle)
            .filter(BillingCycle.id == data.billing_cycle_id, BillingCycle.user_id == current_user.id)
            .first()
        )
        if not cycle:
            raise HTTPException(404, "Ciclo de facturación no encontrado")
    else:
        cycle = (
            db.query(BillingCycle)
            .filter(BillingCycle.user_id == current_user.id, BillingCycle.is_active == True)
            .first()
        )
        if not cycle:
            raise HTTPException(404, "No hay ciclo de facturación activo para este usuario")

    info = _get_cycle_data(db, cycle, current_user)
    title = data.title or f"Reporte Consumo Ciclo {cycle.start_date}"
    start_date = data.start_date or cycle.start_date
    end_date = data.end_date or (cycle.end_date if cycle.end_date else date.today())

    report = Report(
        user_id=current_user.id,
        billing_cycle_id=cycle.id,
        title=title,
        start_date=start_date,
        end_date=end_date,
        kwh_consumed=info["kwh_consumed"],
        total_cost=info["cost_data"]["total"],
        daily_avg_kwh=info["daily_avg"],
        projected_kwh=info["projected"],
        subsidy_status=info["subsidy_status"],
        notes=data.notes,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


# ── STATIC ENDPOINTS ──────────────────────────────────────────────────

@router.get("/pdf")
def generate_pdf_report(
    request: Request,
    cycle_id: Optional[int] = Query(None, description="ID del ciclo. Si no se envía, usa el activo."),
    _token: Optional[str] = Query(None, description="JWT token"),
    db: Session = Depends(get_db),
):
    """Generate and download a PDF consumption report for a billing cycle directly."""
    from jose import JWTError, jwt
    from app.models import User as UserModel

    token_str = _token
    auth_header = request.headers.get("authorization")
    if not token_str and auth_header and auth_header.startswith("Bearer "):
        token_str = auth_header.split(" ")[1]

    if not token_str:
        raise HTTPException(status_code=401, detail="No autenticado")

    try:
        payload = jwt.decode(token_str, settings.SECRET_KEY, algorithms=["HS256"])
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(401, "Token inválido")
    except JWTError:
        raise HTTPException(401, "Token inválido o expirado")

    user = db.query(UserModel).filter(UserModel.username == username, UserModel.is_active == True).first()
    if not user:
        raise HTTPException(401, "Usuario no encontrado")

    if cycle_id:
        cycle = db.query(BillingCycle).filter(BillingCycle.id == cycle_id, BillingCycle.user_id == user.id).first()
        if not cycle:
            cycle = db.query(BillingCycle).filter(BillingCycle.id == cycle_id).first()
    else:
        cycle = db.query(BillingCycle).filter(BillingCycle.user_id == user.id, BillingCycle.is_active == True).first()
        if not cycle:
            cycle = db.query(BillingCycle).filter(BillingCycle.is_active == True).first()

    if not cycle:
        raise HTTPException(404, "No hay ciclo de facturación registrado")

    info = _get_cycle_data(db, cycle, user)
    buf = _build_pdf(info, user.username)
    filename = f"consumo_luz_{cycle.start_date}.pdf"

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/cycles")
def list_reportable_cycles(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all billing cycles available for reporting for current user."""
    cycles = (
        db.query(BillingCycle)
        .filter(BillingCycle.user_id == current_user.id)
        .order_by(BillingCycle.start_date.desc())
        .all()
    )
    if not cycles:
        cycles = db.query(BillingCycle).order_by(BillingCycle.start_date.desc()).all()
    return cycles


# ── REPORT INSTANCE ENDPOINTS ─────────────────────────────────────────

@router.get("/{report_id}/pdf")
def download_saved_report_pdf(
    report_id: int,
    request: Request,
    _token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Download the PDF for a saved report."""
    from jose import JWTError, jwt
    from app.models import User as UserModel

    token_str = _token
    auth_header = request.headers.get("authorization")
    if not token_str and auth_header and auth_header.startswith("Bearer "):
        token_str = auth_header.split(" ")[1]

    if not token_str:
        raise HTTPException(401, "No autenticado")

    try:
        payload = jwt.decode(token_str, settings.SECRET_KEY, algorithms=["HS256"])
        username = payload.get("sub")
        user = db.query(UserModel).filter(UserModel.username == username).first()
    except JWTError:
        raise HTTPException(401, "Token inválido")

    if not user:
        raise HTTPException(401, "Usuario no autenticado")

    report = db.query(Report).filter(Report.id == report_id, Report.user_id == user.id).first()
    if not report:
        raise HTTPException(404, "Reporte no encontrado")

    cycle = db.query(BillingCycle).filter(BillingCycle.id == report.billing_cycle_id).first()
    if not cycle:
        cycle = BillingCycle(
            id=0,
            start_date=report.start_date,
            end_date=report.end_date,
            start_reading=0.0,
            user_id=user.id,
        )

    info = _get_cycle_data(db, cycle, user)
    buf = _build_pdf(info, user.username)
    filename = f"reporte_{report.id}_{report.start_date}.pdf"

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{report_id}", response_model=ReportResponse)
def get_report(
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get details of a specific saved report."""
    report = (
        db.query(Report)
        .filter(Report.id == report_id, Report.user_id == current_user.id)
        .first()
    )
    if not report:
        raise HTTPException(404, "Reporte no encontrado")
    return report


@router.delete("/{report_id}")
def delete_report(
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a saved report."""
    report = (
        db.query(Report)
        .filter(Report.id == report_id, Report.user_id == current_user.id)
        .first()
    )
    if not report:
        raise HTTPException(404, "Reporte no encontrado")
    db.delete(report)
    db.commit()
    return {"detail": "Reporte eliminado correctamente"}

