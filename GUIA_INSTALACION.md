# Guía de Instalación y Despliegue a Producción (Docker)

Esta guía te ayudará a desplegar la aplicación "Consumo Luz" (Frontend, Backend, Base de Datos y Bot de Telegram) de forma automatizada usando Docker y actuando como servicios demonio (daemons) que correrán en segundo plano en tu servidor.

## Requisitos Previos

- Tener instalado [Docker](https://docs.docker.com/get-docker/)
- Tener instalado [Docker Compose](https://docs.docker.com/compose/install/)
- Un token de Telegram (obtenido de [@BotFather](https://t.me/BotFather))

## Pasos de Instalación

### 1. Preparar las Variables de Entorno
Copia el archivo de ejemplo para crear tu configuración real:
```bash
cp .env.example .env
```
Abre el archivo `.env` recién creado y configura tus secretos reales:
- `DB_PASSWORD`: Una contraseña fuerte para MariaDB.
- `SECRET_KEY`: Una cadena de texto larga para cifrar sesiones del API.
- `TELEGRAM_BOT_TOKEN`: El token de tu bot de Telegram.
- `NEXT_PUBLIC_API_URL`: Si despliegas en la web, cambia localhost por tu dominio real (ej. `https://api.midominio.com`).

### 2. Construir y Levantar los Servicios

Ejecuta el siguiente comando para construir las imágenes y levantar todo en modo "demonio" (background):
```bash
docker-compose up -d --build
```

Esto levantará 4 contenedores:
1. `consumoluz_db`: Tu base de datos MariaDB.
2. `consumoluz_api`: El backend (FastAPI) expuesto en el puerto `8000`. También ejecutará la migración de base de datos automáticamente al arrancar.
3. `consumoluz_bot`: El bot de Telegram corriendo permanentemente a la escucha de comandos.
4. `consumoluz_frontend`: El frontend (Next.js) expuesto en el puerto `3000`.

### 3. Verificar que todo funciona

Para ver que todos los contenedores estén corriendo (`Up`):
```bash
docker-compose ps
```

Para ver los logs de un servicio en específico (por ejemplo, el bot para asegurarte que conectó a Telegram):
```bash
docker-compose logs -f bot
```

### 4. Actualizar a Nuevas Versiones

Si haces cambios en el código y quieres mandarlos a producción sin afectar la base de datos:
```bash
docker-compose up -d --build
```
Docker sólo reconstruirá los contenedores necesarios e iniciará la nueva versión.

### 5. ¿Qué pasa con el Bot?
Al estar declarado dentro de `docker-compose.yml` con la regla `restart: always`, el bot (al igual que la API y la BD) funcionará como un proceso **daemon** permanente. Si tu servidor se reinicia o el bot tiene un error fatal y se cierra, Docker lo levantará automáticamente.
