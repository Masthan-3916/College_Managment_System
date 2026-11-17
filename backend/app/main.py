import hashlib
import logging
import os
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

import httpx
import jwt
import pymysql
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from pwdlib import PasswordHash
from pymysql.cursors import Cursor, DictCursor
from pydantic import BaseModel, EmailStr, Field

from . import rag

load_dotenv()

MYSQL_HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER = os.getenv("MYSQL_USER", "campusflow")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "campusflow")
JWT_SECRET = os.getenv("JWT_SECRET", "local-development-secret-change-before-deploy")
if len(JWT_SECRET) < 32:
    raise ValueError("JWT_SECRET must be at least 32 characters long")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@campusflow.edu").strip().lower()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ChangeMe123!")
ALLOWED_DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".markdown"}
ACCESS_LEVELS = ("public", "student", "faculty", "admin")
ROLE_ACCESS_LEVELS = {
    "student": ("public", "student"),
    "faculty": ("public", "student", "faculty"),
    "admin": ACCESS_LEVELS,
}
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
COOKIE_NAME = "campusflow_session"
SESSION_HOURS = 12
password_hash = PasswordHash.recommended()
optional_bearer = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class StudentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    program: str = Field(min_length=2, max_length=100)
    year: int = Field(ge=1, le=8)


class StudentSignup(StudentCreate):
    pass


class CourseCreate(BaseModel):
    code: str = Field(min_length=2, max_length=20)
    title: str = Field(min_length=2, max_length=120)
    instructor: str = Field(min_length=2, max_length=100)
    credits: int = Field(ge=1, le=12)


class AssistantPrompt(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)


class AssistantSource(BaseModel):
    file_name: str
    page_number: int | None = None
    chunk_number: int | None = None
    department: str | None = None
    course: str | None = None
    excerpt: str


class AssistantResponse(BaseModel):
    answer: str
    sources: list[AssistantSource]


class DocumentResponse(BaseModel):
    document_id: str
    file_name: str
    department: str | None
    course: str | None
    access_level: str
    version: str
    uploaded_at: datetime


@contextmanager
def get_connection():
    connection = pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
        charset="utf8mb4",
        cursorclass=DictCursor,
        connect_timeout=5,
    )
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def execute(connection, query: str, params: tuple = ()) -> Cursor:
    cursor = connection.cursor()
    cursor.execute(query, params)
    return cursor


def initialize_database() -> None:
    with get_connection() as connection:
        execute(
            connection,
            """
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(254) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                role ENUM('admin', 'faculty', 'student') NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """,
        )
        execute(
            connection,
            """
            CREATE TABLE IF NOT EXISTS students (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                user_id BIGINT UNSIGNED NOT NULL UNIQUE,
                name VARCHAR(100) NOT NULL,
                program VARCHAR(100) NOT NULL,
                year TINYINT UNSIGNED NOT NULL,
                CONSTRAINT fk_students_user FOREIGN KEY (user_id)
                    REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """,
        )
        execute(
            connection,
            """
            CREATE TABLE IF NOT EXISTS courses (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                code VARCHAR(20) NOT NULL UNIQUE,
                title VARCHAR(120) NOT NULL,
                instructor VARCHAR(100) NOT NULL,
                credits TINYINT UNSIGNED NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """,
        )
        execute(
            connection,
            """
            CREATE TABLE IF NOT EXISTS rag_documents (
                document_id CHAR(64) NOT NULL PRIMARY KEY,
                identity_hash CHAR(64) NOT NULL UNIQUE,
                file_name VARCHAR(255) NOT NULL,
                department VARCHAR(100) NULL,
                course VARCHAR(100) NULL,
                access_level ENUM('public', 'student', 'faculty', 'admin') NOT NULL,
                version VARCHAR(64) NOT NULL,
                index_version CHAR(36) NOT NULL,
                uploaded_by BIGINT UNSIGNED NOT NULL,
                uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_rag_documents_access (access_level)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """,
        )
        existing_admin = execute(
            connection, "SELECT id FROM users WHERE email = %s", (ADMIN_EMAIL,)
        ).fetchone()
        if existing_admin is None:
            execute(
                connection,
                "INSERT INTO users (email, password_hash, role) VALUES (%s, %s, 'admin')",
                (ADMIN_EMAIL, password_hash.hash(ADMIN_PASSWORD)),
            )


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="GKR Royal Institutes of Agriculture API", version="1.0.0", lifespan=lifespan)
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


def current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(optional_bearer)],
) -> dict:
    token = credentials.credentials if credentials else request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (InvalidTokenError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")
    with get_connection() as connection:
        user = execute(
            connection,
            "SELECT id, email, role FROM users WHERE id = %s",
            (user_id,),
        ).fetchone()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account no longer exists")
    return user


def require_admin(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def require_staff(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] not in ("admin", "faculty"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff access required")
    return user


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def allowed_access_levels(user: dict) -> tuple[str, ...]:
    return ROLE_ACCESS_LEVELS[user["role"]]


def document_response(row: dict) -> dict:
    return {
        "document_id": row["document_id"],
        "file_name": row["file_name"],
        "department": row["department"],
        "course": row["course"],
        "access_level": row["access_level"],
        "version": row["version"],
        "uploaded_at": row["uploaded_at"],
    }


@app.get("/api/documents", response_model=list[DocumentResponse])
def list_documents(user: Annotated[dict, Depends(require_staff)]) -> list[dict]:
    levels = allowed_access_levels(user)
    placeholders = ", ".join(["%s"] * len(levels))
    with get_connection() as connection:
        rows = execute(
            connection,
            f"SELECT document_id, file_name, department, course, access_level, version, uploaded_at "
            f"FROM rag_documents WHERE access_level IN ({placeholders}) ORDER BY uploaded_at DESC",
            levels,
        ).fetchall()
    return [document_response(row) for row in rows]


@app.post("/api/documents", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def upload_document(
    user: Annotated[dict, Depends(require_staff)],
    file: Annotated[UploadFile, File()],
    access_level: Annotated[str, Form()] = "student",
    version: Annotated[str, Form(max_length=64)] = "1",
    department: Annotated[str | None, Form(max_length=100)] = None,
    course: Annotated[str | None, Form(max_length=100)] = None,
) -> dict:
    file_name = Path((file.filename or "").replace("\\", "/")).name
    suffix = Path(file_name).suffix.lower()
    if not file_name or len(file_name) > 255 or suffix not in ALLOWED_DOCUMENT_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a PDF, DOCX, TXT, or Markdown file")
    if access_level not in ACCESS_LEVELS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid document access level")
    if user["role"] == "faculty" and access_level == "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Faculty cannot upload admin-only documents")

    maximum_bytes = max(1, int(os.getenv("MAX_DOCUMENT_SIZE_MB", "10"))) * 1024 * 1024
    content = file.file.read(maximum_bytes + 1)
    if len(content) > maximum_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Document exceeds the upload size limit")
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The uploaded document is empty")

    try:
        chunks = rag.chunk_pages(rag.extract_pages(file_name, content))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not chunks:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The document contains no extractable text")
    maximum_chunks = max(1, int(os.getenv("MAX_DOCUMENT_CHUNKS", "500")))
    if len(chunks) > maximum_chunks:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Document creates too many chunks")

    normalized_identity = "\x1f".join(
        (file_name.casefold(), (department or "").strip().casefold(), (course or "").strip().casefold())
    )
    identity_hash = hashlib.sha256(normalized_identity.encode("utf-8")).hexdigest()
    document_id = identity_hash
    index_version = rag.new_index_version()
    department_value = (department or "").strip() or None
    course_value = (course or "").strip() or None
    metadata = {
        "access_level": access_level,
        "department": department_value or "",
        "course": course_value or "",
        "version": version.strip() or "1",
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    rag.index_document(document_id, index_version, file_name, chunks, metadata)

    with get_connection() as connection:
        execute(
            connection,
            """
            INSERT INTO rag_documents
                (document_id, identity_hash, file_name, department, course, access_level, version, index_version, uploaded_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), department = VALUES(department),
                course = VALUES(course), access_level = VALUES(access_level), version = VALUES(version),
                index_version = VALUES(index_version), uploaded_by = VALUES(uploaded_by), uploaded_at = CURRENT_TIMESTAMP
            """,
            (
                document_id,
                identity_hash,
                file_name,
                department_value,
                course_value,
                access_level,
                metadata["version"],
                index_version,
                user["id"],
            ),
        )
        row = execute(
            connection,
            "SELECT document_id, file_name, department, course, access_level, version, uploaded_at "
            "FROM rag_documents WHERE document_id = %s",
            (document_id,),
        ).fetchone()

    try:
        rag.remove_old_document_versions(document_id, index_version)
    except Exception:
        logger.exception("Could not clean stale RAG document chunks")
    return document_response(row)


@app.delete("/api/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: str, user: Annotated[dict, Depends(require_staff)]) -> Response:
    with get_connection() as connection:
        row = execute(
            connection,
            "SELECT document_id, access_level, uploaded_by FROM rag_documents WHERE document_id = %s",
            (document_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
        if user["role"] != "admin" and (row["access_level"] == "admin" or row["uploaded_by"] != user["id"]):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot delete this document")
        rag.delete_document_chunks(document_id)
        execute(connection, "DELETE FROM rag_documents WHERE document_id = %s", (document_id,))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def set_session_cookie(response: Response, user_id: int) -> None:
    token = jwt.encode(
        {
            "sub": str(user_id),
            "exp": datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS),
        },
        JWT_SECRET,
        algorithm="HS256",
    )
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_HOURS * 60 * 60,
        path="/",
    )


@app.post("/api/auth/login")
def login(data: LoginRequest, response: Response) -> dict:
    with get_connection() as connection:
        user = execute(
            connection,
            "SELECT id, email, password_hash, role FROM users WHERE email = %s",
            (str(data.email).lower(),),
        ).fetchone()
    if user is None or not password_hash.verify(data.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    set_session_cookie(response, user["id"])
    return {"user": {"id": user["id"], "email": user["email"], "role": user["role"]}}


@app.post("/api/auth/signup", status_code=status.HTTP_201_CREATED)
def signup(data: StudentSignup, response: Response) -> dict:
    try:
        with get_connection() as connection:
            user = execute(
                connection,
                "INSERT INTO users (email, password_hash, role) VALUES (%s, %s, 'student')",
                (str(data.email).lower(), password_hash.hash(data.password)),
            )
            student = execute(
                connection,
                "INSERT INTO students (user_id, name, program, year) VALUES (%s, %s, %s, %s)",
                (user.lastrowid, data.name.strip(), data.program.strip(), data.year),
            )
            user_id = user.lastrowid
            student_id = student.lastrowid
    except pymysql.err.IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists") from exc

    set_session_cookie(response, user_id)
    return {
        "user": {"id": user_id, "email": str(data.email).lower(), "role": "student"},
        "student": {
            "id": student_id,
            "name": data.name.strip(),
            "program": data.program.strip(),
            "year": data.year,
        },
    }


@app.post("/api/auth/logout")
def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(key=COOKIE_NAME, path="/", httponly=True, secure=COOKIE_SECURE, samesite="lax")
    return {"message": "Signed out"}


@app.get("/api/auth/me")
def who_am_i(user: Annotated[dict, Depends(current_user)]) -> dict:
    return {"user": user}


@app.get("/api/dashboard")
def dashboard(user: Annotated[dict, Depends(current_user)]) -> dict:
    with get_connection() as connection:
        student_count = execute(
            connection, "SELECT COUNT(*) AS total FROM students"
        ).fetchone()["total"]
        course_count = execute(
            connection, "SELECT COUNT(*) AS total FROM courses"
        ).fetchone()["total"]
        recent_students = execute(
            connection,
            """
            SELECT s.id, s.name, u.email, s.program, s.year
            FROM students s JOIN users u ON u.id = s.user_id
            ORDER BY s.id DESC LIMIT 5
            """,
        ).fetchall()
        student_profile = execute(
            connection,
            "SELECT name, program, year FROM students WHERE user_id = %s",
            (user["id"],),
        ).fetchone()
    return {
        "student_count": student_count,
        "course_count": course_count,
        "role": user["role"],
        "recent_students": recent_students,
        "student_profile": student_profile,
    }


@app.get("/api/students")
def list_students(_: Annotated[dict, Depends(require_staff)]) -> list[dict]:
    with get_connection() as connection:
        rows = execute(
            connection,
            """
            SELECT s.id, s.name, u.email, s.program, s.year
            FROM students s JOIN users u ON u.id = s.user_id
            ORDER BY s.name
            """,
        ).fetchall()
    return rows


@app.post("/api/students", status_code=status.HTTP_201_CREATED)
def create_student(data: StudentCreate, _: Annotated[dict, Depends(require_admin)]) -> dict:
    try:
        with get_connection() as connection:
            user = execute(
                connection,
                "INSERT INTO users (email, password_hash, role) VALUES (%s, %s, 'student')",
                (str(data.email).lower(), password_hash.hash(data.password)),
            )
            student = execute(
                connection,
                "INSERT INTO students (user_id, name, program, year) VALUES (%s, %s, %s, %s)",
                (user.lastrowid, data.name.strip(), data.program.strip(), data.year),
            )
            student_id = student.lastrowid
    except pymysql.err.IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists") from exc
    return {
        "id": student_id,
        "name": data.name.strip(),
        "email": str(data.email).lower(),
        "program": data.program.strip(),
        "year": data.year,
    }


@app.get("/api/courses")
def list_courses(_: Annotated[dict, Depends(current_user)]) -> list[dict]:
    with get_connection() as connection:
        rows = execute(
            connection,
            "SELECT id, code, title, instructor, credits FROM courses ORDER BY code",
        ).fetchall()
    return rows


@app.post("/api/assistant/chat", response_model=AssistantResponse)
def assistant_chat(data: AssistantPrompt, user: Annotated[dict, Depends(current_user)]) -> dict:
    levels = allowed_access_levels(user)
    placeholders = ", ".join(["%s"] * len(levels))
    with get_connection() as connection:
        documents = list(
            execute(
                connection,
                "SELECT document_id, index_version FROM rag_documents "
                f"WHERE access_level IN ({placeholders})",
                levels,
            ).fetchall()
        )
        courses = list(
            execute(
                connection,
                "SELECT id, code, title, instructor, credits FROM courses ORDER BY code LIMIT 1000",
            ).fetchall()
        )

    sources = rag.retrieve_chunks(data.prompt, documents, courses, levels)
    answer = rag.generate_answer(data.prompt, sources)
    return {
        "answer": answer,
        "sources": [
            {
                "file_name": source["file_name"],
                "page_number": source["page_number"],
                "chunk_number": source["chunk_number"],
                "department": source["department"],
                "course": source["course"],
                "excerpt": source["text"][:400],
            }
            for source in sources
        ],
    }


@app.post("/api/courses", status_code=status.HTTP_201_CREATED)
def create_course(data: CourseCreate, _: Annotated[dict, Depends(require_admin)]) -> dict:
    code = data.code.strip().upper()
    try:
        with get_connection() as connection:
            course = execute(
                connection,
                "INSERT INTO courses (code, title, instructor, credits) VALUES (%s, %s, %s, %s)",
                (code, data.title.strip(), data.instructor.strip(), data.credits),
            )
            course_id = course.lastrowid
    except pymysql.err.IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A course with this code already exists") from exc
    return {
        "id": course_id,
        "code": code,
        "title": data.title.strip(),
        "instructor": data.instructor.strip(),
        "credits": data.credits,
    }
