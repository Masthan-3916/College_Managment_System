# GKR Royal Institutes of Agriculture — College Management

A college management system with a React/Vite frontend, FastAPI backend, MySQL records, and a document-grounded campus assistant.

## Features

- Public college site, student signup, and signed HTTP-only session cookies.
- Existing role-protected student and course CRUD (admin/faculty read; admin creates).
- Admin/faculty document upload, listing, and deletion with document access levels.
- RAG over approved PDF, DOCX, TXT, and Markdown documents plus the live course catalog.
- ChromaDB persistent local vector storage, OpenAI embeddings, and OpenAI answer generation.
- Answers include source file names, page numbers when available, and retrieved excerpts.
- Student marks, attendance, fees, contact details, and passwords are not read from student tables or indexed by the assistant.

## Requirements

- Python 3.10+
- Node.js 20+
- MySQL 8+ or MariaDB 10.6+
- An OpenAI API key with access to the configured embedding and chat models

## Local setup

1. Create the application and test databases and a MySQL user (use your own password):

   ```sql
   CREATE DATABASE campusflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE DATABASE campusflow_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'campusflow'@'127.0.0.1' IDENTIFIED BY 'choose-a-password';
   GRANT ALL PRIVILEGES ON campusflow.* TO 'campusflow'@'127.0.0.1';
   GRANT ALL PRIVILEGES ON campusflow_test.* TO 'campusflow'@'127.0.0.1';
   ```

2. Create and configure `.env` from the placeholder template. Set database credentials, a unique JWT secret, initial admin credentials, and `OPENAI_API_KEY`:

   ```bash
   cp .env.example .env
   python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
   ```

   Put the generated value in `JWT_SECRET`, then edit the other values in `.env`. Never commit `.env` or expose `OPENAI_API_KEY` in frontend code.

3. Install and start the backend:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r backend/requirements.txt
   uvicorn app.main:app --app-dir backend --reload
   ```

   Startup creates the SQL tables and configured initial admin account. ChromaDB creates its persistent collection when first used.

4. In another terminal, install and start the frontend:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

5. Open http://localhost:5173 and sign in with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` configured in `.env`. The API health check and interactive docs are at http://localhost:8000/api/health and http://localhost:8000/docs.

## RAG configuration

- `OPENAI_API_KEY`: required for document indexing and answers.
- `OPENAI_EMBEDDING_MODEL`: embedding model for both document chunks and question queries; default `text-embedding-3-small`.
- `OPENAI_CHAT_MODEL`: answer model; default `gpt-4o-mini`.
- `CHROMA_PERSIST_DIRECTORY`: local persistent vector-store directory; default `backend/app/chroma_data`.
- `CHROMA_COLLECTION_NAME`: vector collection; default `college_documents`.
- `RAG_CHUNK_SIZE` / `RAG_CHUNK_OVERLAP`: chunking sizes in characters; defaults `1200` / `150`.
- `RAG_TOP_K`: retrieved chunks per question; default `4`.
- `MAX_DOCUMENT_SIZE_MB`: upload limit; default `10`.
- `MAX_DOCUMENT_CHUNKS`: maximum chunks accepted per document; default `500`.
- `CORS_ORIGINS`: comma-separated allowed frontend origins; defaults to the two local Vite origins. Set exact production origins, never `*` with credentials.

Admin and faculty users can open **AI Assistant** to upload and manage documents. Uploading the same file with the same department and course replaces its indexed version. Access can be public (all signed-in roles), student, faculty, or admin. Faculty cannot create admin-only documents and can delete only documents they uploaded. Admins can delete any document.

For a local demonstration, upload `backend/app/knowledge_base/sample_attendance_policy.md` from the dashboard. It is explicitly fictional sample content, not an official college policy. Only upload approved policy, handbook, FAQ, and course documents. Do not upload student records or sensitive personal information.

The assistant authorizes document IDs against MySQL before vector search and also filters Chroma metadata by access level. Course catalog entries are synchronized to Chroma from the existing course table. The model receives only retrieved chunks and cannot execute SQL or modify records. Retrieved text is treated as untrusted input and cannot override system rules.

## API

- `GET /api/health`: health check.
- `POST /api/documents`: staff-only multipart upload (`file`, optional `department`, `course`, `version`, `access_level`).
- `GET /api/documents`: staff-only list, filtered to documents the caller can access.
- `DELETE /api/documents/{document_id}`: admin or uploading faculty; removes SQL metadata and Chroma chunks.
- `POST /api/assistant/chat`: authenticated question; returns `answer` and `sources`.

## Tests

The test database must be separate from the app database:

```bash
source .venv/bin/activate
MYSQL_TEST_DATABASE=campusflow_test python -m unittest discover -s backend/tests -v
```

Tests mock OpenAI and Chroma service boundaries; they do not require a live API key. `python-multipart` and document parsers are installed by `backend/requirements.txt`.
