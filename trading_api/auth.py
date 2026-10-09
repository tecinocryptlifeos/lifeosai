"""Verify Supabase access tokens; never accept user IDs from request bodies."""
from __future__ import annotations
import os
from dataclasses import dataclass
import jwt
from fastapi import Header, HTTPException, status

JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
JWT_AUDIENCE = os.environ.get("SUPABASE_JWT_AUDIENCE", "authenticated")
JWT_ALGORITHM = os.environ.get("SUPABASE_JWT_ALGORITHM", "HS256")

@dataclass(frozen=True)
class Caller:
    user_id: str
    token: str

def current_user(authorization: str = Header(default="")) -> Caller:
    if not JWT_SECRET:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Supabase JWT verification is not configured")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], audience=JWT_AUDIENCE)
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired access token") from None
    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token has no subject")
    return Caller(user_id=subject, token=token)
