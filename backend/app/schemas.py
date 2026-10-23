from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class Register(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    name: str = Field(min_length=1, max_length=120)


class Login(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class Preferences(BaseModel):
    role: str = Field(default="", max_length=160)
    company: str = Field(default="", max_length=80)
    language: str = Field(default="English", max_length=80)
    answer_style: Literal["concise", "balanced", "detailed"] = "concise"
    answer_tone: Literal["professional", "friendly", "casual"] = "professional"
    english_level: Literal["simple", "everyday", "advanced"] = "everyday"
    response_delivery: Literal["natural", "talking_points", "structured"] = "natural"
    include_simple_example: bool = True
    personalization: Literal["grounded", "technical"] = "grounded"
    grounding: Literal["balanced", "strict"] = "balanced"
    reading_mode: Literal["auto", "speech", "paced", "off"] = "auto"
    reading_wpm: int = Field(default=130, ge=60, le=240)
    answer_text_size: int = Field(default=17, ge=14, le=24)
    answer_font: Literal["system", "serif", "readable"] = "system"
    answer_theme: Literal["default", "easy", "contrast"] = "default"
    job_description: str = Field(default="", max_length=12000)


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    github_username: str | None = Field(default=None, max_length=39, pattern=r"^[a-zA-Z0-9-]*$")
    preferences: Preferences | None = None


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)


class GithubImport(BaseModel):
    url: str = Field(min_length=15, max_length=300)


class SessionCreate(BaseModel):
    consent: bool
    audio_mode: Literal["microphone", "tab"] = "microphone"
    title: str = Field(default="Live conversation", min_length=1, max_length=200)
    retention: bool = True


class ResetRequest(BaseModel):
    email: EmailStr


class ResetConfirm(BaseModel):
    token: str = Field(min_length=32, max_length=100)
    password: str = Field(min_length=12, max_length=128)


class SupabaseSession(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    email: EmailStr
    name: str = Field(default="", max_length=120)
    access_token: str = Field(default="", max_length=4096)
