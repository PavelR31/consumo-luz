import os
import sys

from sqlalchemy import create_engine, MetaData
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

# Import your auth and models to create the admin user
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.routers.auth import hash_password
from app.models import User

mysql_source_url = "mysql+pymysql://root:12345@localhost:3306/consumo_luz"
mysql_url = "mysql+pymysql://root:12345@localhost:3307/consumo_luz"

sqlite_engine = create_engine(mysql_source_url)
mysql_engine = create_engine(mysql_url)

sqlite_meta = MetaData()
sqlite_meta.reflect(bind=sqlite_engine)

mysql_meta = MetaData()
mysql_meta.reflect(bind=mysql_engine)

sqlite_conn = sqlite_engine.connect()
mysql_conn = mysql_engine.connect()

mysql_conn.execute(text("SET FOREIGN_KEY_CHECKS=0;"))

for table in sqlite_meta.sorted_tables:
    if table.name in mysql_meta.tables:
        mysql_table = mysql_meta.tables[table.name]
        print(f"Migrating table {table.name}...")
        rows = sqlite_conn.execute(table.select()).fetchall()
        if rows:
            mysql_conn.execute(mysql_table.delete())
            # Use mappings instead of dict(row) to avoid issues with new SQLAlchemy 2.0
            mysql_conn.execute(mysql_table.insert(), [row._mapping for row in rows])

mysql_conn.execute(text("SET FOREIGN_KEY_CHECKS=1;"))
mysql_conn.commit()

# Ensure admin user
Session = sessionmaker(bind=mysql_engine)
session = Session()

admin = session.query(User).filter(User.username == "admin").first()
if admin:
    print("Actualizando contraseña de admin...")
    admin.hashed_password = hash_password("admin123")
else:
    print("Creando usuario admin...")
    admin = User(username="admin", hashed_password=hash_password("admin123"), is_active=True)
    session.add(admin)

session.commit()

print("¡Migración y configuración de admin completada!")
