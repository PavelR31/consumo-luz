from app.database import engine, Base, SessionLocal
from app.models import User, BillingCycle, Reading, Report
from sqlalchemy import text

# Create all tables (e.g. reports)
Base.metadata.create_all(bind=engine)
print("Tables verified/created.")

# Check columns in MariaDB
with engine.connect() as conn:
    # Check if user_id exists in billing_cycles
    res = conn.execute(text("SHOW COLUMNS FROM billing_cycles LIKE 'user_id'")).fetchall()
    if not res:
        print("Adding user_id to billing_cycles...")
        conn.execute(text("ALTER TABLE billing_cycles ADD COLUMN user_id INT NULL, ADD CONSTRAINT fk_cycles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"))
        conn.commit()

    # Check if user_id exists in readings
    res = conn.execute(text("SHOW COLUMNS FROM readings LIKE 'user_id'")).fetchall()
    if not res:
        print("Adding user_id to readings...")
        conn.execute(text("ALTER TABLE readings ADD COLUMN user_id INT NULL, ADD CONSTRAINT fk_readings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"))
        conn.commit()

# Associate existing records to pavel (id=2) or admin (id=1)
db = SessionLocal()
pavel = db.query(User).filter(User.username == "pavel").first()
target_user_id = pavel.id if pavel else 1

active_cycle = db.query(BillingCycle).filter(BillingCycle.is_active == True).first()

# Update billing_cycles
for c in db.query(BillingCycle).all():
    if not c.user_id:
        c.user_id = target_user_id

# Update readings
for r in db.query(Reading).all():
    if not r.user_id:
        r.user_id = target_user_id
    if not r.billing_cycle_id and active_cycle:
        r.billing_cycle_id = active_cycle.id
    elif active_cycle and r.billing_cycle_id != active_cycle.id:
        r.billing_cycle_id = active_cycle.id

db.commit()
print("All database records successfully migrated and linked!")
print("Cycle count:", db.query(BillingCycle).count())
print("Readings in active cycle:", db.query(Reading).filter(Reading.billing_cycle_id == active_cycle.id).count() if active_cycle else 0)
db.close()
