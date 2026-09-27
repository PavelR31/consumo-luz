"""Authentication router - login, register, token management."""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from jose import JWTError, jwt
import bcrypt

from app.database import get_db
from app.models import User
from app.schemas import LoginRequest, TokenResponse, UserResponse, ChangePasswordRequest, AdminResetPasswordRequest
from app.config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Dependency: extract and validate user from JWT token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales inválidas",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Using parameterized query (SQLAlchemy ORM) - safe from SQL injection
    user = db.query(User).filter(User.username == username).first()
    if user is None or not user.is_active:
        raise credentials_exception
    return user


@router.post("/register", response_model=UserResponse)
def register(request: LoginRequest, db: Session = Depends(get_db)):
    """Register a new user. Only allows one user (personal app)."""
    existing_count = db.query(User).count()
    if existing_count >= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se permite un usuario en esta aplicación",
        )

    existing = db.query(User).filter(User.username == request.username).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El usuario ya existe",
        )

    user = User(
        username=request.username,
        hashed_password=hash_password(request.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Login with username and password, returns JWT token."""
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token({"sub": user.username})
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Get current authenticated user info."""
    return current_user


@router.post("/change-password")
def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change password for the currently authenticated user. Requires current password."""
    if not verify_password(request.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña actual es incorrecta",
        )
    if request.new_password != request.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Las contraseñas nuevas no coinciden",
        )
    if len(request.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe tener al menos 8 caracteres",
        )
    if request.new_password == request.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La nueva contraseña debe ser diferente a la actual",
        )

    current_user.hashed_password = hash_password(request.new_password)
    db.commit()
    return {"message": "Contraseña actualizada correctamente"}


@router.post("/admin/reset-password")
def admin_reset_password(
    request: AdminResetPasswordRequest,
    db: Session = Depends(get_db),
):
    """
    Admin CLI endpoint to reset the user password without knowing the current one.
    Protected by ADMIN_SECRET_KEY from .env — not by JWT.

    Usage:
        curl -X POST http://localhost:8000/api/auth/admin/reset-password \\
             -H 'Content-Type: application/json' \\
             -d '{"admin_secret": "<ADMIN_SECRET_KEY>", "new_password": "nueva123"}'
    """
    if not settings.ADMIN_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="El endpoint admin no está habilitado. Configura ADMIN_SECRET_KEY en .env",
        )
    if request.admin_secret != settings.ADMIN_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clave admin incorrecta",
        )
    if len(request.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La contraseña debe tener al menos 8 caracteres",
        )

    user = db.query(User).filter(User.is_active == True).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontró un usuario activo",
        )

    user.hashed_password = hash_password(request.new_password)
    db.commit()
    return {"message": f"Contraseña del usuario '{user.username}' reestablecida correctamente"}
