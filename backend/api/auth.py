import os
import secrets
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Cookie, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

router = APIRouter(prefix="/auth", tags=["auth"])

GITHUB_CLIENT_ID = os.environ.get("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.environ.get("GITHUB_CLIENT_SECRET", "")
GITHUB_REDIRECT_URI = os.environ.get("GITHUB_REDIRECT_URI", "http://localhost:8000/auth/github/callback")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
GITHUB_SCOPES = "read:user repo"
COOKIE_NAME = "synapsis_sid"
SESSION_TTL_SECONDS = 60 * 60 * 8  # 8 hours

SESSIONS: dict[str, dict] = {}
PENDING_STATES: dict[str, float] = {}


def _prune_expired() -> None:
    now = time.time()
    for sid, sess in list(SESSIONS.items()):
        if now - sess.get("created_at", 0) > SESSION_TTL_SECONDS:
            SESSIONS.pop(sid, None)
    for state, ts in list(PENDING_STATES.items()):
        if now - ts > 600:
            PENDING_STATES.pop(state, None)


def get_session(sid: str | None) -> dict | None:
    if not sid:
        return None
    sess = SESSIONS.get(sid)
    if sess is None:
        return None
    if time.time() - sess.get("created_at", 0) > SESSION_TTL_SECONDS:
        SESSIONS.pop(sid, None)
        return None
    return sess


def get_token_from_cookie(sid: str | None) -> str | None:
    sess = get_session(sid)
    return sess["access_token"] if sess else None


@router.get("/github/login")
def github_login():
    if not GITHUB_CLIENT_ID:
        raise HTTPException(500, "GITHUB_CLIENT_ID not configured on server")
    _prune_expired()
    state = secrets.token_urlsafe(24)
    PENDING_STATES[state] = time.time()
    params = {
        "client_id": GITHUB_CLIENT_ID,
        "redirect_uri": GITHUB_REDIRECT_URI,
        "scope": GITHUB_SCOPES,
        "state": state,
        "allow_signup": "true",
    }
    return {"url": f"https://github.com/login/oauth/authorize?{urlencode(params)}"}


@router.get("/github/callback")
def github_callback(code: str | None = None, state: str | None = None):
    if not code or not state:
        raise HTTPException(400, "Missing code or state")
    if PENDING_STATES.pop(state, None) is None:
        raise HTTPException(400, "Invalid or expired state")
    if not (GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET):
        raise HTTPException(500, "GitHub OAuth not configured")

    with httpx.Client(timeout=15) as client:
        token_resp = client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": GITHUB_REDIRECT_URI,
            },
        )
        token_resp.raise_for_status()
        payload = token_resp.json()
        access_token = payload.get("access_token")
        if not access_token:
            raise HTTPException(400, f"Token exchange failed: {payload.get('error_description', payload)}")

        user_resp = client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
        )
        user_resp.raise_for_status()
        user = user_resp.json()

    sid = secrets.token_urlsafe(32)
    SESSIONS[sid] = {
        "access_token": access_token,
        "user": {
            "login": user.get("login"),
            "name": user.get("name"),
            "avatar_url": user.get("avatar_url"),
        },
        "created_at": time.time(),
    }

    redirect = RedirectResponse(url=f"{FRONTEND_URL}/home?github=connected", status_code=302)
    redirect.set_cookie(
        key=COOKIE_NAME,
        value=sid,
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False,
    )
    return redirect


@router.get("/me")
def me(synapsis_sid: str | None = Cookie(default=None)):
    sess = get_session(synapsis_sid)
    if sess is None:
        raise HTTPException(401, "Not authenticated")
    return {"user": sess["user"]}


@router.post("/logout")
def logout(response: Response, synapsis_sid: str | None = Cookie(default=None)):
    if synapsis_sid:
        SESSIONS.pop(synapsis_sid, None)
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/github/repos")
def list_repos(synapsis_sid: str | None = Cookie(default=None)):
    sess = get_session(synapsis_sid)
    if sess is None:
        raise HTTPException(401, "Not authenticated")
    token = sess["access_token"]

    repos: list[dict] = []
    with httpx.Client(timeout=20) as client:
        # Paginate up to 3 pages * 100 = 300 repos. Plenty for hackathon.
        for page in range(1, 4):
            r = client.get(
                "https://api.github.com/user/repos",
                params={"per_page": 100, "page": page, "sort": "updated", "affiliation": "owner,collaborator,organization_member"},
                headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            )
            r.raise_for_status()
            batch = r.json()
            if not batch:
                break
            repos.extend(batch)
            if len(batch) < 100:
                break

    return {
        "repos": [
            {
                "full_name": r["full_name"],
                "name": r["name"],
                "private": r["private"],
                "description": r.get("description"),
                "updated_at": r.get("updated_at"),
                "default_branch": r.get("default_branch"),
                "html_url": r.get("html_url"),
            }
            for r in repos
        ]
    }
