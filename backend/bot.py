"""
Telegram Bot para Consumo Luz con Menús Interactivos y Calendario.
"""
import os
import sys
import logging
import asyncio
import calendar as cal_module
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ConversationHandler,
    ContextTypes,
    filters,
)
from telegram.error import BadRequest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.config import get_settings
from app.database import SessionLocal, init_db
from app.models import Reading, BillingCycle, User
from app.services.tariff import calculate_cost, seed_tariff_blocks, get_subsidy_threshold
from app.services.ocr import extract_meter_reading
from app.routers.auth import verify_password

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()

TZ_NI = ZoneInfo("America/Managua")

MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
DIAS_SEMANA = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do']

# Estados de la conversación
(
    CHOOSING_ACTION,
    WAITING_FOR_YEAR,
    WAITING_FOR_MONTH,
    WAITING_FOR_DAY,
    WAITING_FOR_VALUE,
) = range(5)


def get_current_date():
    return datetime.now(TZ_NI).date()


def is_authorized(user_id: int) -> bool:
    allowed = settings.allowed_telegram_users
    if not allowed:
        return True
    return user_id in allowed


def get_user_for_telegram(db, telegram_user_id: int):
    user = db.query(User).filter(User.telegram_chat_id == str(telegram_user_id)).first()
    if not user:
        user = db.query(User).filter(User.is_active == True).first()
    return user


# ========== Calendario manual con InlineKeyboard ==========

def build_year_keyboard():
    """Construir teclado para seleccionar año."""
    today = get_current_date()
    years = [today.year - 1, today.year, today.year + 1]
    buttons = [InlineKeyboardButton(str(y), callback_data=f"cal_year_{y}") for y in years]
    return InlineKeyboardMarkup([
        buttons,
        [InlineKeyboardButton("❌ Cancelar", callback_data="cal_cancel")]
    ])


def build_month_keyboard(year):
    """Construir teclado para seleccionar mes."""
    rows = []
    for i in range(0, 12, 4):
        row = []
        for j in range(4):
            idx = i + j
            row.append(InlineKeyboardButton(MESES[idx], callback_data=f"cal_month_{year}_{idx+1}"))
        rows.append(row)
    rows.append([InlineKeyboardButton("⬅️ Volver", callback_data="cal_back_year")])
    return InlineKeyboardMarkup(rows)


def build_day_keyboard(year, month):
    """Construir teclado para seleccionar día."""
    rows = []
    # Encabezado días de la semana
    rows.append([InlineKeyboardButton(d, callback_data="cal_noop") for d in DIAS_SEMANA])
    
    # Días del mes (semana empieza en lunes)
    month_cal = cal_module.monthcalendar(year, month)
    for week in month_cal:
        row = []
        for day in week:
            if day == 0:
                row.append(InlineKeyboardButton(" ", callback_data="cal_noop"))
            else:
                row.append(InlineKeyboardButton(str(day), callback_data=f"cal_day_{year}_{month}_{day}"))
        rows.append(row)
    
    rows.append([InlineKeyboardButton("⬅️ Volver", callback_data=f"cal_back_month_{year}")])
    return InlineKeyboardMarkup(rows)


# ========== Menú principal ==========

def build_main_menu(user_id: int | None = None, is_linked: bool | None = None):
    if is_linked is None:
        if user_id is not None:
            is_linked = get_is_linked(user_id)
        else:
            is_linked = False

    keyboard = [
        [InlineKeyboardButton("📊 Ver Resumen", callback_data="menu_resumen")],
        [
            InlineKeyboardButton("📝 Nueva Lectura", callback_data="menu_lectura"),
            InlineKeyboardButton("🔄 Nuevo Ciclo", callback_data="menu_ciclo")
        ],
        [InlineKeyboardButton("✏️ Editar Inicio de Ciclo", callback_data="menu_editar_ciclo")],
        [InlineKeyboardButton("💰 Calcular Costo", callback_data="menu_costo")],
    ]
    if is_linked:
        keyboard.append([
            InlineKeyboardButton("👤 Mi Cuenta", callback_data="menu_mi_cuenta"),
            InlineKeyboardButton("🔓 Desvincular", callback_data="menu_desvincular"),
        ])
    else:
        keyboard.append([InlineKeyboardButton("🔗 Vincular Cuenta", callback_data="menu_vincular")])
    return InlineKeyboardMarkup(keyboard)


def get_is_linked(telegram_user_id: int) -> bool:
    """Check if this Telegram user has an explicitly linked account."""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.telegram_chat_id == str(telegram_user_id)).first()
        return user is not None
    finally:
        db.close()


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_authorized(update.effective_user.id):
        if update.message:
            await update.message.reply_text("⛔ No estás autorizado.")
        return ConversationHandler.END

    msg = "⚡ *Menú Principal de Consumo Luz*\nSelecciona una opción:"
    markup = build_main_menu(user_id=update.effective_user.id)
    if update.message:
        await update.message.reply_text(msg, parse_mode="Markdown", reply_markup=markup)
    elif update.callback_query:
        await update.callback_query.edit_message_text(msg, parse_mode="Markdown", reply_markup=markup)
    return CHOOSING_ACTION


async def cancel_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message:
        await update.message.reply_text("Operación cancelada. Escribe /start para volver al menú.")
    return ConversationHandler.END


# ========== Manejo del menú ==========

async def handle_menu_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data
    user_id = update.effective_user.id
    is_linked = get_is_linked(user_id)

    if data == "menu_resumen":
        await show_resumen(update, context)
        return CHOOSING_ACTION

    elif data in ("menu_lectura", "menu_ciclo", "menu_editar_ciclo"):
        action_map = {
            "menu_lectura": "lectura",
            "menu_ciclo": "ciclo",
            "menu_editar_ciclo": "editar_ciclo",
        }
        context.user_data['action'] = action_map[data]
        
        labels = {
            "menu_lectura": "📝 Selecciona el *año* de la lectura:",
            "menu_ciclo": "🔄 Selecciona el *año* de inicio del ciclo:",
            "menu_editar_ciclo": "✏️ Selecciona el *año* de la nueva fecha:",
        }
        await query.edit_message_text(labels[data], parse_mode="Markdown", reply_markup=build_year_keyboard())
        return WAITING_FOR_YEAR

    elif data == "menu_costo":
        await query.edit_message_text("💰 Escribe la cantidad de kWh para calcular el costo:\nEj: `120`", parse_mode="Markdown")
        context.user_data['action'] = 'costo'
        return WAITING_FOR_VALUE

    elif data == "menu_vincular":
        if is_linked:
            await query.edit_message_text(
                "ℹ️ Ya tienes una cuenta vinculada. Puedes verla en *👤 Mi Cuenta* o gestionarla desde el menú.",
                parse_mode="Markdown",
                reply_markup=build_main_menu(is_linked=True)
            )
            return CHOOSING_ACTION
        await query.edit_message_text(
            "🔗 Para vincular tu cuenta, escribe tu usuario y contraseña separados por un espacio:\n"
            "Ej: `admin micontraseña`",
            parse_mode="Markdown"
        )
        context.user_data['action'] = 'vincular'
        return WAITING_FOR_VALUE

    elif data == "menu_mi_cuenta":
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.telegram_chat_id == str(user_id)).first()
            if user:
                created = user.created_at.strftime('%d/%m/%Y') if user.created_at else 'N/A'
                msg = (
                    f"👤 *Mi Cuenta Vinculada*\n"
                    f"━━━━━━━━━━━━━━━━━━━━\n"
                    f"🆔 Usuario: `{user.username}`\n"
                    f"📅 Cuenta creada: {created}\n"
                    f"✅ Estado: {'Activa' if user.is_active else 'Inactiva'}\n"
                    f"🔗 Telegram ID: `{user.telegram_chat_id}`"
                )
            else:
                msg = "⚠️ No tienes una cuenta vinculada."
        finally:
            db.close()
        try:
            await query.edit_message_text(msg, parse_mode="Markdown", reply_markup=build_main_menu(is_linked=is_linked))
        except BadRequest as e:
            if "Message is not modified" not in str(e):
                raise
        return CHOOSING_ACTION

    elif data == "menu_desvincular":
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.telegram_chat_id == str(user_id)).first()
            if user:
                username = user.username
                user.telegram_chat_id = None
                db.commit()
                msg = f"🔓 Cuenta *{username}* desvinculada correctamente.\nPuedes volver a vincularla cuando quieras."
            else:
                msg = "⚠️ No tenías una cuenta vinculada."
        finally:
            db.close()
        await query.edit_message_text(msg, parse_mode="Markdown", reply_markup=build_main_menu(is_linked=False))
        return CHOOSING_ACTION

    return CHOOSING_ACTION


# ========== Manejo del calendario ==========

async def handle_year_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "cal_cancel":
        await query.edit_message_text("Operación cancelada. Escribe /start para volver al menú.")
        return ConversationHandler.END

    if data.startswith("cal_year_"):
        year = int(data.split("_")[2])
        context.user_data['cal_year'] = year
        await query.edit_message_text(
            f"📅 Año: *{year}*\nSelecciona el *mes*:",
            parse_mode="Markdown",
            reply_markup=build_month_keyboard(year)
        )
        return WAITING_FOR_MONTH

    return WAITING_FOR_YEAR


async def handle_month_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "cal_back_year":
        await query.edit_message_text("📅 Selecciona el *año*:", parse_mode="Markdown", reply_markup=build_year_keyboard())
        return WAITING_FOR_YEAR

    if data.startswith("cal_month_"):
        parts = data.split("_")
        year = int(parts[2])
        month = int(parts[3])
        context.user_data['cal_month'] = month
        await query.edit_message_text(
            f"📅 {MESES[month-1]} {year}\nSelecciona el *día*:",
            parse_mode="Markdown",
            reply_markup=build_day_keyboard(year, month)
        )
        return WAITING_FOR_DAY

    return WAITING_FOR_MONTH


async def handle_day_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "cal_noop":
        return WAITING_FOR_DAY

    if data.startswith("cal_back_month_"):
        year = int(data.split("_")[3])
        await query.edit_message_text(
            f"📅 Año: *{year}*\nSelecciona el *mes*:",
            parse_mode="Markdown",
            reply_markup=build_month_keyboard(year)
        )
        return WAITING_FOR_MONTH

    if data.startswith("cal_day_"):
        parts = data.split("_")
        year = int(parts[2])
        month = int(parts[3])
        day = int(parts[4])
        selected = date(year, month, day)
        context.user_data['selected_date'] = selected
        
        action = context.user_data.get('action')
        prompts = {
            'lectura': f"📅 Fecha: *{selected}*\n\nEscribe el valor de la lectura del medidor (kWh):",
            'ciclo': f"📅 Fecha: *{selected}*\n\nEscribe la lectura inicial del nuevo ciclo (kWh):",
            'editar_ciclo': f"📅 Nueva fecha: *{selected}*\n\nEscribe la lectura inicial corregida (kWh):",
        }
        await query.edit_message_text(prompts.get(action, "Escribe el valor:"), parse_mode="Markdown")
        return WAITING_FOR_VALUE

    return WAITING_FOR_DAY


# ========== Manejo de valor ==========

async def handle_value_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text:
        return WAITING_FOR_VALUE

    text = update.message.text.strip()
    action = context.user_data.get('action')

    # Vincular cuenta
    if action == 'vincular':
        parts = text.split(maxsplit=1)
        if len(parts) < 2:
            await update.message.reply_text("❌ Escribe usuario y contraseña separados por espacio.\nEj: `admin micontraseña`", parse_mode="Markdown")
            return WAITING_FOR_VALUE
        
        username, password = parts
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.username == username).first()
            if not user or not verify_password(password, user.hashed_password):
                await update.message.reply_text("❌ Credenciales inválidas.")
                await update.message.reply_text("⚡ ¿Qué más deseas hacer?", reply_markup=build_main_menu(user_id=update.effective_user.id))
                return CHOOSING_ACTION
            
            # Limpiar vínculo previo de este chat id si existía
            db.query(User).filter(User.telegram_chat_id == str(update.effective_user.id)).update({User.telegram_chat_id: None})
            user.telegram_chat_id = str(update.effective_user.id)
            db.commit()
            await update.message.reply_text(f"✅ ¡Cuenta *{user.username}* vinculada con éxito!", parse_mode="Markdown")
            await update.message.reply_text("⚡ ¿Qué más deseas hacer?", reply_markup=build_main_menu(is_linked=True))
            return CHOOSING_ACTION
        finally:
            db.close()

    # Calcular costo
    if action == 'costo':
        try:
            kwh = float(text)
        except ValueError:
            await update.message.reply_text("❌ Número inválido. Intenta de nuevo:")
            return WAITING_FOR_VALUE
        
        db = SessionLocal()
        try:
            result = calculate_cost(db, kwh)
            msg = f"💰 *Cálculo para {kwh} kWh*\n━━━━━━━━━━━━━━━━━━━━\n"
            for block in result["breakdown"]:
                msg += f"• {block['block_name']}: {block['kwh']} kWh × C${block['price_per_kwh']} = C${block['subtotal']}\n"
            msg += f"━━━━━━━━━━━━━━━━━━━━\n"
            msg += f"⚡ Energía: C$ {result['energy_cost']}\n"
            msg += f"📋 Cargo fijo: C$ {result['fixed_charge']}\n"
            msg += f"💡 Alumbrado: C$ {result.get('alumbrado', 0)}\n"
            msg += f"📊 Regulación INE: C$ {result.get('regulacion_ine', 0)}\n"
            msg += f"🧾 IVA: C$ {result.get('iva', 0)}\n"
            msg += f"💰 *TOTAL: C$ {result['total']}*\n"
            if not result["is_subsidized"]:
                msg += f"\n🚨 _Sin subsidio (excede {result['subsidy_threshold']} kWh)_"
            else:
                msg += f"\n✅ _Con subsidio aplicado_"
            await update.message.reply_text(msg, parse_mode="Markdown")
        finally:
            db.close()
        
        await update.message.reply_text("⚡ ¿Qué más deseas hacer?", reply_markup=build_main_menu(user_id=update.effective_user.id))
        return CHOOSING_ACTION

    # Lectura / Ciclo / Editar ciclo
    try:
        value = float(text)
    except ValueError:
        await update.message.reply_text("❌ Por favor envía un número válido:")
        return WAITING_FOR_VALUE

    selected_date = context.user_data.get('selected_date', get_current_date())
    
    db = SessionLocal()
    try:
        user = get_user_for_telegram(db, update.effective_user.id)
        user_id = user.id if user else None

        if action == 'lectura':
            cycle = db.query(BillingCycle).filter(
                BillingCycle.is_active == True,
                BillingCycle.user_id == user_id
            ).first()
            
            reading = Reading(
                user_id=user_id,
                reading_kwh=value,
                source="telegram",
                billing_cycle_id=cycle.id if cycle else None,
            )
            reading.created_at = datetime.combine(selected_date, datetime.min.time()).replace(tzinfo=TZ_NI)
            db.add(reading)
            db.commit()
            await update.message.reply_text(f"✅ Lectura de *{value} kWh* registrada para el *{selected_date}*.", parse_mode="Markdown")

        elif action == 'ciclo':
            active = db.query(BillingCycle).filter(BillingCycle.is_active == True, BillingCycle.user_id == user_id).first()
            if active:
                active.is_active = False
                active.end_date = selected_date
                active.end_reading = value
            
            cycle = BillingCycle(
                user_id=user_id,
                start_date=selected_date,
                start_reading=value,
            )
            db.add(cycle)
            db.commit()
            await update.message.reply_text(f"✅ Nuevo ciclo iniciado el *{selected_date}* con *{value} kWh*.", parse_mode="Markdown")

        elif action == 'editar_ciclo':
            active = db.query(BillingCycle).filter(BillingCycle.is_active == True, BillingCycle.user_id == user_id).first()
            if not active:
                await update.message.reply_text("❌ No hay un ciclo activo para editar.")
            else:
                active.start_date = selected_date
                active.start_reading = value
                db.commit()
                await update.message.reply_text(f"✅ Ciclo actualizado: Inicio *{selected_date}* con *{value} kWh*.", parse_mode="Markdown")

        await update.message.reply_text("⚡ ¿Qué más deseas hacer?", reply_markup=build_main_menu(user_id=update.effective_user.id))
        return CHOOSING_ACTION

    finally:
        db.close()


# ========== Resumen ==========

async def show_resumen(update: Update, context: ContextTypes.DEFAULT_TYPE):
    db = SessionLocal()
    try:
        user = get_user_for_telegram(db, update.effective_user.id)
        user_id = user.id if user else None

        active_cycle = db.query(BillingCycle).filter(BillingCycle.is_active == True, BillingCycle.user_id == user_id).first()
        
        if not active_cycle:
            msg = "⚠️ No hay un ciclo de facturación activo.\nUsá el botón 🔄 Nuevo Ciclo para crear uno."
        else:
            latest = db.query(Reading).filter(
                Reading.user_id == user_id,
                Reading.billing_cycle_id == active_cycle.id
            ).order_by(Reading.created_at.desc()).first()
            
            if not latest:
                msg = "⚠️ No hay lecturas registradas en este ciclo."
            else:
                consumed = round(latest.reading_kwh - active_cycle.start_reading, 2)
                today_date = get_current_date()
                days_diff = (today_date - active_cycle.start_date).days
                days = max(days_diff, 1)
                
                daily_avg = round(consumed / days, 2)
                projected = round(daily_avg * 30, 2)
                threshold = get_subsidy_threshold(db)

                cost_current = calculate_cost(db, consumed)
                cost_projected = calculate_cost(db, projected)

                msg = (
                    f"⚡ *RESUMEN DE CONSUMO*\n"
                    f"━━━━━━━━━━━━━━━━━━━━\n"
                    f"📅 Inicio ciclo: {active_cycle.start_date}\n"
                    f"🔢 Lectura inicial: {active_cycle.start_reading} kWh\n"
                    f"🔢 Lectura actual: {latest.reading_kwh} kWh\n"
                    f"━━━━━━━━━━━━━━━━━━━━\n"
                    f"⚡ Consumido: *{consumed} kWh*\n"
                    f"📅 Días transcurridos: {days_diff}\n"
                    f"📈 Promedio diario: *{daily_avg} kWh*\n"
                    f"🔮 Proyección 30 días: *{projected} kWh*\n"
                    f"━━━━━━━━━━━━━━━━━━━━\n"
                    f"💰 Costo actual: *C$ {cost_current['total']}*\n"
                    f"💰 Costo proyectado: *C$ {cost_projected['total']}*\n"
                )

                if projected > threshold:
                    msg += f"\n🚨 *¡ALERTA!* Proyección supera {threshold} kWh. ¡Perderías el subsidio!"
                else:
                    remaining = round(threshold - consumed, 2)
                    msg += f"\n✅ Margen de subsidio: {remaining} kWh restantes"

        menu_markup = build_main_menu(user_id=update.effective_user.id)
        if update.callback_query:
            try:
                await update.callback_query.edit_message_text(msg, parse_mode="Markdown", reply_markup=menu_markup)
            except BadRequest as e:
                if "Message is not modified" not in str(e):
                    raise
        else:
            await update.message.reply_text(msg, parse_mode="Markdown", reply_markup=menu_markup)

    finally:
        db.close()


# ========== Main ==========

def main():
    if not settings.TELEGRAM_BOT_TOKEN:
        logger.error("❌ TELEGRAM_BOT_TOKEN no configurado en .env")
        return

    init_db()
    db = SessionLocal()
    try:
        seed_tariff_blocks(db)
    finally:
        db.close()

    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    app = Application.builder().token(settings.TELEGRAM_BOT_TOKEN).build()

    conv_handler = ConversationHandler(
        entry_points=[
            CommandHandler("start", start_command),
            CommandHandler("menu", start_command),
        ],
        states={
            CHOOSING_ACTION: [
                CallbackQueryHandler(handle_menu_selection),
            ],
            WAITING_FOR_YEAR: [
                CallbackQueryHandler(handle_year_selection),
            ],
            WAITING_FOR_MONTH: [
                CallbackQueryHandler(handle_month_selection),
            ],
            WAITING_FOR_DAY: [
                CallbackQueryHandler(handle_day_selection),
            ],
            WAITING_FOR_VALUE: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_value_input),
            ],
        },
        fallbacks=[
            CommandHandler("start", start_command),
            CommandHandler("cancelar", cancel_command),
        ],
        per_message=False,
    )

    app.add_handler(conv_handler)

    logger.info("🤖 Bot de Telegram interactivo iniciado")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
