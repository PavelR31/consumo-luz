"""Readings router - CRUD for meter readings with OCR support."""
import os
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models import Reading, BillingCycle, User
from app.schemas import ReadingCreate, ReadingResponse, ReadingUpdate
from app.routers.auth import get_current_user
from app.services.ocr import extract_meter_reading
from app.config import get_settings

router = APIRouter(prefix="/api/readings", tags=["readings"])
settings = get_settings()


def _parse_reading_date(raw_date: Optional[str]) -> Optional[datetime]:
    """Parse user-provided date string without timezone drift."""
    if not raw_date:
        return None
    raw_str = str(raw_date).strip()
    if not raw_str:
        return None
    # YYYY-MM-DD only
    if len(raw_str) == 10 and "-" in raw_str:
        try:
            return datetime.strptime(raw_str, "%Y-%m-%d").replace(hour=12, minute=0, second=0)
        except ValueError:
            pass
    try:
        dt = datetime.fromisoformat(raw_str.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt
    except ValueError:
        pass
    return None


@router.get("/", response_model=list[ReadingResponse])
def get_readings(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get all readings for the authenticated user, ordered by most recent first."""
    readings = (
        db.query(Reading)
        .filter(Reading.user_id == current_user.id)
        .order_by(Reading.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    if not readings:
        # Fallback to any unassigned readings for backward compatibility
        readings = (
            db.query(Reading)
            .order_by(Reading.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
    return readings


@router.get("/{reading_id}", response_model=ReadingResponse)
def get_reading(
    reading_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a specific reading by ID."""
    reading = (
        db.query(Reading)
        .filter(Reading.id == reading_id, Reading.user_id == current_user.id)
        .first()
    )
    if not reading:
        reading = db.query(Reading).filter(Reading.id == reading_id).first()
    if not reading:
        raise HTTPException(status_code=404, detail="Lectura no encontrada")
    return reading


@router.post("/", response_model=ReadingResponse)
def create_reading(
    data: ReadingCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new meter reading manually."""
    # Find active cycle for this user (or general)
    active_cycle = (
        db.query(BillingCycle)
        .filter(BillingCycle.user_id == current_user.id, BillingCycle.is_active == True)
        .first()
    )
    if not active_cycle:
        active_cycle = db.query(BillingCycle).filter(BillingCycle.is_active == True).first()

    # Validate against last reading for this user
    last_reading = (
        db.query(Reading)
        .filter(Reading.user_id == current_user.id)
        .order_by(Reading.created_at.desc())
        .first()
    )
    if not last_reading and active_cycle:
        if data.reading_kwh < active_cycle.start_reading:
            raise HTTPException(
                status_code=400,
                detail=f"La lectura ({data.reading_kwh}) no puede ser menor que la lectura inicial del ciclo ({active_cycle.start_reading})",
            )
    elif last_reading and data.reading_kwh < last_reading.reading_kwh:
        raise HTTPException(
            status_code=400,
            detail=f"La lectura ({data.reading_kwh}) no puede ser menor que la última registrada ({last_reading.reading_kwh})",
        )

    reading = Reading(
        user_id=current_user.id,
        reading_kwh=data.reading_kwh,
        notes=data.notes,
        source="web",
        billing_cycle_id=active_cycle.id if active_cycle else None,
    )
    parsed_dt = _parse_reading_date(data.reading_date)
    if parsed_dt:
        reading.created_at = parsed_dt

    db.add(reading)
    db.commit()
    db.refresh(reading)
    return reading


@router.post("/with-photo", response_model=ReadingResponse)
async def create_reading_with_photo(
    photo: UploadFile = File(...),
    reading_kwh: Optional[float] = Form(None),
    notes: Optional[str] = Form(None),
    use_ocr: bool = Form(True),
    reading_date: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a reading with a meter photo.
    Optionally extracts reading_kwh using OCR if not provided.
    """
    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)

    ext = os.path.splitext(photo.filename)[1] if photo.filename else ".jpg"
    filename = f"meter_{uuid.uuid4().hex[:12]}{ext}"
    file_path = os.path.join(upload_dir, filename)

    content = await photo.read()
    with open(file_path, "wb") as f:
        f.write(content)

    ocr_raw = None
    ocr_confidence = None
    source = "web"

    if reading_kwh is None and use_ocr:
        try:
            ocr_result = extract_meter_reading(file_path)
            if ocr_result["success"] and ocr_result["detected_value"]:
                reading_kwh = ocr_result["detected_value"]
                ocr_raw = ocr_result["raw_text"]
                ocr_confidence = ocr_result["confidence"]
                source = "ocr"
            else:
                raise HTTPException(
                    status_code=422,
                    detail=f"No se pudo detectar la lectura en la imagen: {ocr_result['message']}. Ingrésala manualmente.",
                )
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=500,
                detail=f"Error procesando imagen: {str(e)}",
            )
    elif reading_kwh is not None:
        source = "web"
    else:
        raise HTTPException(
            status_code=400,
            detail="Debes proporcionar la lectura manualmente o habilitar OCR",
        )

    active_cycle = (
        db.query(BillingCycle)
        .filter(BillingCycle.user_id == current_user.id, BillingCycle.is_active == True)
        .first()
    )
    if not active_cycle:
        active_cycle = db.query(BillingCycle).filter(BillingCycle.is_active == True).first()

    last_reading = (
        db.query(Reading)
        .filter(Reading.user_id == current_user.id)
        .order_by(Reading.created_at.desc())
        .first()
    )
    if not last_reading and active_cycle:
        if reading_kwh < active_cycle.start_reading:
            raise HTTPException(
                status_code=400,
                detail=f"La lectura ({reading_kwh}) no puede ser menor que la inicial del ciclo ({active_cycle.start_reading})",
            )
    elif last_reading and reading_kwh < last_reading.reading_kwh:
        raise HTTPException(
            status_code=400,
            detail=f"La lectura ({reading_kwh}) no puede ser menor que la última registrada ({last_reading.reading_kwh})",
        )

    reading = Reading(
        user_id=current_user.id,
        reading_kwh=reading_kwh,
        photo_path=f"/uploads/{filename}",
        notes=notes,
        source=source,
        ocr_raw_value=ocr_raw,
        ocr_confidence=ocr_confidence,
        billing_cycle_id=active_cycle.id if active_cycle else None,
    )
    parsed_dt = _parse_reading_date(reading_date)
    if parsed_dt:
        reading.created_at = parsed_dt

    db.add(reading)
    db.commit()
    db.refresh(reading)
    return reading


@router.put("/{reading_id}", response_model=ReadingResponse)
def update_reading(
    reading_id: int,
    data: ReadingUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an existing reading."""
    reading = (
        db.query(Reading)
        .filter(Reading.id == reading_id, Reading.user_id == current_user.id)
        .first()
    )
    if not reading:
        reading = db.query(Reading).filter(Reading.id == reading_id).first()
    if not reading:
        raise HTTPException(status_code=404, detail="Lectura no encontrada")

    if data.reading_kwh is not None:
        reading.reading_kwh = data.reading_kwh
    if data.notes is not None:
        reading.notes = data.notes
    if data.reading_date is not None:
        parsed_dt = _parse_reading_date(data.reading_date)
        if parsed_dt:
            reading.created_at = parsed_dt
    if data.billing_cycle_id is not None:
        reading.billing_cycle_id = data.billing_cycle_id

    db.commit()
    db.refresh(reading)
    return reading


@router.delete("/{reading_id}")
def delete_reading(
    reading_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a reading."""
    reading = (
        db.query(Reading)
        .filter(Reading.id == reading_id, Reading.user_id == current_user.id)
        .first()
    )
    if not reading:
        # Fallback to check if exists without user_id
        reading = db.query(Reading).filter(Reading.id == reading_id).first()
    if not reading:
        raise HTTPException(status_code=404, detail="Lectura no encontrada")
    db.delete(reading)
    db.commit()
    return {"detail": "Lectura eliminada"}


@router.post("/ocr-preview")
async def ocr_preview(
    photo: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    Preview OCR result without saving the reading.
    """
    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)

    ext = os.path.splitext(photo.filename)[1] if photo.filename else ".jpg"
    temp_path = os.path.join(upload_dir, f"temp_ocr_{uuid.uuid4().hex[:8]}{ext}")

    content = await photo.read()
    with open(temp_path, "wb") as f:
        f.write(content)

    try:
        result = extract_meter_reading(temp_path)
        return result
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)
