from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..security import create_token, current_user, hash_password, verify_password
from ..seed import create_child

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    child_name: str = Field(default="My child", min_length=1, max_length=120)
    phone: str = Field(default="", max_length=32)


class LoginIn(BaseModel):
    email: str
    password: str


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=32)


def user_json(u: User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "phone": u.phone,
            "children": [{"id": c.id, "name": c.name} for c in u.children]}


@router.post("/register")
def register(body: RegisterIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, "Enter a valid email address")
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    user = User(email=email, name=body.name.strip(), phone=body.phone.strip(), password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    create_child(db, user, body.child_name.strip())
    db.refresh(user)
    return {"token": create_token(user.id), "user": user_json(user)}


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Wrong email or password")
    return {"token": create_token(user.id), "user": user_json(user)}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_json(user)


@router.patch("/me")
def update_me(body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.name is not None:
        user.name = body.name.strip() or user.name
    if body.phone is not None:
        user.phone = body.phone.strip()
    db.commit()
    return user_json(user)
