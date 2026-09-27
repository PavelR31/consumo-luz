"""
Servicio de cálculo de tarifas eléctricas residenciales de Nicaragua (T-0).

Fuente: INE (Instituto Nicaragüense de Energía) - https://www.ine.gob.ni
Tarifa: DISNORTE/DISSUR Residencial T-0

Estructura escalonada con subsidio para consumo ≤ 150 kWh/mes.
Los bloques y precios son configurables desde la base de datos.
"""
from sqlalchemy.orm import Session
from app.models import TariffBlock, Setting
from datetime import datetime, timezone


# Default tariff blocks (as of Aug 2025, from INE pliego tarifario)
DEFAULT_BLOCKS = [
    {"name": "Primeros 25 kWh", "min_kwh": 0, "max_kwh": 25, "price_per_kwh": 1.2403, "is_subsidized": True, "display_order": 1},
    {"name": "Siguientes 25 kWh (26-50)", "min_kwh": 25, "max_kwh": 50, "price_per_kwh": 2.9669, "is_subsidized": True, "display_order": 2},
    {"name": "Siguientes 50 kWh (51-100)", "min_kwh": 50, "max_kwh": 100, "price_per_kwh": 3.4217, "is_subsidized": True, "display_order": 3},
    {"name": "Siguientes 25 kWh (101-125)", "min_kwh": 100, "max_kwh": 125, "price_per_kwh": 6.2020, "is_subsidized": True, "display_order": 4},
    {"name": "Siguientes 25 kWh (126-150)", "min_kwh": 125, "max_kwh": 150, "price_per_kwh": 6.2020, "is_subsidized": True, "display_order": 5},
    {"name": "Excedente (>150 kWh)", "min_kwh": 150, "max_kwh": 99999, "price_per_kwh": 7.5000, "is_subsidized": False, "display_order": 6},
]

DEFAULT_FIXED_CHARGE = 36.0473  # C$/mes - Cargo fijo de comercialización
SUBSIDY_THRESHOLD = 150  # kWh


def seed_tariff_blocks(db: Session):
    """Insert default tariff blocks if none exist."""
    existing = db.query(TariffBlock).count()
    if existing == 0:
        for block_data in DEFAULT_BLOCKS:
            block = TariffBlock(**block_data)
            db.add(block)

        # Seed fixed charge setting
        fixed_charge_setting = db.query(Setting).filter(Setting.key == "fixed_charge").first()
        if not fixed_charge_setting:
            db.add(Setting(
                key="fixed_charge",
                value=str(DEFAULT_FIXED_CHARGE),
                description="Cargo fijo de comercialización (C$/mes)"
            ))

        subsidy_setting = db.query(Setting).filter(Setting.key == "subsidy_threshold").first()
        if not subsidy_setting:
            db.add(Setting(
                key="subsidy_threshold",
                value=str(SUBSIDY_THRESHOLD),
                description="Umbral de subsidio en kWh/mes"
            ))

        db.commit()


def get_fixed_charge(db: Session) -> float:
    """Get the fixed monthly charge from settings."""
    setting = db.query(Setting).filter(Setting.key == "fixed_charge").first()
    return float(setting.value) if setting else DEFAULT_FIXED_CHARGE


def get_subsidy_threshold(db: Session) -> float:
    """Get the subsidy threshold from settings."""
    setting = db.query(Setting).filter(Setting.key == "subsidy_threshold").first()
    return float(setting.value) if setting else SUBSIDY_THRESHOLD


def calculate_cost(db: Session, kwh_consumed: float) -> dict:
    """
    Calculate the electricity cost based on tiered pricing.
    
    Returns a dict with:
    - total: total cost in C$
    - fixed_charge: fixed monthly charge
    - energy_cost: variable energy cost
    - breakdown: list of {block_name, kwh, price, subtotal}
    - is_subsidized: whether consumption qualifies for subsidy
    - subsidy_threshold: the kWh threshold
    """
    blocks = db.query(TariffBlock).order_by(TariffBlock.display_order).all()
    if not blocks:
        # Fallback to defaults
        blocks_data = DEFAULT_BLOCKS
    else:
        blocks_data = [
            {
                "name": b.name,
                "min_kwh": b.min_kwh,
                "max_kwh": b.max_kwh,
                "price_per_kwh": b.price_per_kwh,
                "is_subsidized": b.is_subsidized,
            }
            for b in blocks
        ]

    fixed_charge = get_fixed_charge(db)
    threshold = get_subsidy_threshold(db)
    is_subsidized = kwh_consumed <= threshold

    breakdown = []
    remaining = kwh_consumed
    energy_cost = 0.0

    for block in blocks_data:
        if remaining <= 0:
            break

        block_size = block["max_kwh"] - block["min_kwh"]
        kwh_in_block = min(remaining, block_size)

        if not is_subsidized and block.get("is_subsidized", True):
            non_sub_blocks = [b for b in blocks_data if not b.get("is_subsidized", True)]
            if non_sub_blocks:
                price = non_sub_blocks[0]["price_per_kwh"]
            else:
                price = block["price_per_kwh"]
        else:
            price = block["price_per_kwh"]

        subtotal = kwh_in_block * price
        energy_cost += subtotal

        breakdown.append({
            "block_name": block["name"],
            "kwh": round(kwh_in_block, 2),
            "price_per_kwh": round(price, 4),
            "subtotal": round(subtotal, 2),
        })

        remaining -= kwh_in_block

    # Calculate additional charges based on standard Nicaraguan billing
    # 1. Alumbrado Publico (~12.15% of energy cost or per kWh table, approx 12.15% from receipt)
    alumbrado = round(energy_cost * 0.1215, 2)
    
    # 2. Comercializacion (We use the fixed_charge setting for this)
    comercializacion = round(fixed_charge, 2)
    
    # 3. Regulacion INE (1% of Energy + Alumbrado + Comercializacion)
    subtotal_for_ine = energy_cost + alumbrado + comercializacion
    regulacion_ine = round(subtotal_for_ine * 0.01, 2)
    
    # 4. IVA (15% applied if consumption > subsidy threshold)
    # Applied to the sum of all previous items
    base_iva = subtotal_for_ine + regulacion_ine
    iva = round(base_iva * 0.15, 2) if not is_subsidized else 0.0

    total_amount = round(base_iva + iva, 2)

    return {
        "total": total_amount,
        "fixed_charge": comercializacion,
        "energy_cost": round(energy_cost, 2),
        "alumbrado": alumbrado,
        "regulacion_ine": regulacion_ine,
        "iva": iva,
        "breakdown": breakdown,
        "is_subsidized": is_subsidized,
        "subsidy_threshold": threshold,
        "kwh_consumed": round(kwh_consumed, 2),
    }
