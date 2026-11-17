import os
import sys
import unittest
from pathlib import Path
from importlib import reload
from unittest.mock import Mock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class CollegeApiTests(unittest.TestCase):
    def setUp(self):
        self.run_id = uuid4().hex[:10]
        self.admin_email = f"admin-{self.run_id}@test.com"
        self.student_email = f"student-{self.run_id}@test.com"
        self.signup_email = f"signup-{self.run_id}@test.com"
        self.course_code = f"T{self.run_id[:8].upper()}"
        self.environment = patch.dict(
            os.environ,
            {
                "MYSQL_DATABASE": os.getenv("MYSQL_TEST_DATABASE", "campusflow_test"),
                "JWT_SECRET": "test-secret-for-unit-tests-at-least-32-chars",
                "ADMIN_EMAIL": self.admin_email,
                "ADMIN_PASSWORD": "TestAdmin123!",
                "OPENAI_API_KEY": "test-openai-key",
                "OPENAI_EMBEDDING_MODEL": "test-embedding-model",
                "OPENAI_CHAT_MODEL": "test-chat-model",
            },
        )
        self.environment.start()
        from app import main

        reload(main)

        self.main = main
        self.client = TestClient(main.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        with self.main.get_connection() as connection:
            self.main.execute(
                connection,
                "DELETE FROM courses WHERE code = %s",
                (self.course_code,),
            )
            self.main.execute(
                connection,
                "DELETE FROM users WHERE email IN (%s, %s, %s)",
                (self.admin_email, self.student_email, self.signup_email),
            )
        self.environment.stop()

    def test_auth_and_admin_record_creation(self):
        unauthorized = self.client.get("/api/students")
        self.assertEqual(unauthorized.status_code, 401)

        login = self.client.post(
            "/api/auth/login",
            json={"email": self.admin_email, "password": "TestAdmin123!"},
        )
        self.assertEqual(login.status_code, 200)
        self.assertIn("httponly", login.headers["set-cookie"].lower())

        student = self.client.post(
            "/api/students",
            json={
                "name": "Alex Rivera",
                "email": self.student_email,
                "password": "Student123!",
                "program": "Computer Science",
                "year": 2,
            },
        )
        self.assertEqual(student.status_code, 201)
        self.assertEqual(student.json()["name"], "Alex Rivera")

        course = self.client.post(
            "/api/courses",
            json={"code": self.course_code.lower(), "title": "Foundations", "instructor": "Dr. Lee", "credits": 3},
        )
        self.assertEqual(course.status_code, 201)
        self.assertEqual(course.json()["code"], self.course_code.upper())

        dashboard = self.client.get("/api/dashboard")
        self.assertEqual(dashboard.json()["student_count"], 1)
        self.assertEqual(dashboard.json()["course_count"], 1)

    def test_student_cannot_create_records(self):
        self.client.post(
            "/api/auth/login",
            json={"email": self.admin_email, "password": "TestAdmin123!"},
        )
        self.client.post(
            "/api/students",
            json={
                "name": "Sam Taylor",
                "email": self.student_email,
                "password": "Student123!",
                "program": "Biology",
                "year": 1,
            },
        )
        self.client.post(
            "/api/courses",
            json={"code": self.course_code, "title": "Biology", "instructor": "Dr. Lee", "credits": 3},
        )
        self.client.post("/api/auth/logout")
        self.client.post(
            "/api/auth/login",
            json={"email": self.student_email, "password": "Student123!"},
        )
        dashboard = self.client.get("/api/dashboard")
        self.assertEqual(dashboard.status_code, 200)
        self.assertEqual(dashboard.json()["student_profile"]["name"], "Sam Taylor")
        self.assertEqual(len(self.client.get("/api/courses").json()), 1)
        self.assertEqual(self.client.get("/api/students").status_code, 403)
        denied = self.client.post(
            "/api/courses",
            json={"code": self.course_code, "title": "Biology", "instructor": "Dr. Lee", "credits": 3},
        )
        self.assertEqual(denied.status_code, 403)

    def test_assistant_retrieves_relevant_campus_and_course_sources(self):
        self.client.post(
            "/api/auth/login",
            json={"email": self.admin_email, "password": "TestAdmin123!"},
        )
        self.client.post(
            "/api/courses",
            json={
                "code": self.course_code,
                "title": "Soil Ecology",
                "instructor": "Dr. Lee",
                "credits": 3,
            },
        )
        retrieved = [
            {
                "text": "Soil Ecology is a three-credit course.",
                "file_name": "Course catalog",
                "page_number": None,
                "chunk_number": 1,
                "department": None,
                "course": "Soil Ecology",
                "similarity": 0.9,
            }
        ]
        with (
            patch.object(self.main.rag, "retrieve_chunks", return_value=retrieved) as retrieve,
            patch.object(self.main.rag, "generate_answer", return_value="Soil Ecology is available.") as answer,
        ):
            response = self.client.post(
                "/api/assistant/chat",
                json={"prompt": "Tell me about Soil Ecology credits"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["answer"], "Soil Ecology is available.")
        self.assertEqual(response.json()["sources"][0]["file_name"], "Course catalog")
        self.assertEqual(response.json()["sources"][0]["excerpt"], retrieved[0]["text"])
        allowed_documents = retrieve.call_args.args[1]
        self.assertIsInstance(allowed_documents, list)
        self.assertEqual(retrieve.call_args.args[3], ("public", "student", "faculty", "admin"))
        self.assertEqual(answer.call_args.args, ("Tell me about Soil Ecology credits", retrieved))

    def test_chunking_has_configured_overlap(self):
        chunks = self.main.rag.chunk_text("0123456789" * 30, chunk_size=100, overlap=20)

        self.assertGreater(len(chunks), 1)
        self.assertEqual(chunks[0][-20:], chunks[1][:20])

    def test_retrieval_returns_sources_and_filters_by_access(self):
        collection = Mock()
        collection.get.return_value = {"ids": [], "metadatas": []}
        collection.query.return_value = {
            "documents": [["Attendance is recorded daily."]],
            "metadatas": [[
                {
                    "source_type": "document",
                    "document_id": "doc-1",
                    "index_version": "version-1",
                    "file_name": "attendance-policy.pdf",
                    "page_number": 2,
                    "chunk_number": 3,
                    "access_level": "student",
                }
            ]],
            "distances": [[0.1]],
        }
        document_rows = [{"document_id": "doc-1", "index_version": "version-1"}]
        with (
            patch.object(self.main.rag, "_collection", return_value=collection),
            patch.object(self.main.rag, "embed_texts", return_value=[[0.2, 0.8]]),
        ):
            sources = self.main.rag.retrieve_chunks(
                "attendance policy", document_rows, [], ("public", "student")
            )

        self.assertEqual(sources[0]["file_name"], "attendance-policy.pdf")
        self.assertEqual(sources[0]["page_number"], 2)
        self.assertEqual(sources[0]["text"], "Attendance is recorded daily.")
        self.assertEqual(
            collection.query.call_args.kwargs["where"],
            {
                "$and": [
                    {"document_id": {"$in": ["doc-1"]}},
                    {"access_level": {"$in": ["public", "student"]}},
                ]
            },
        )

    def test_staff_upload_replaces_and_deletes_document(self):
        self.client.post(
            "/api/auth/login",
            json={"email": self.admin_email, "password": "TestAdmin123!"},
        )
        with (
            patch.object(self.main.rag, "index_document") as index_document,
            patch.object(self.main.rag, "remove_old_document_versions") as cleanup,
            patch.object(self.main.rag, "delete_document_chunks") as delete_chunks,
        ):
            first = self.client.post(
                "/api/documents",
                data={"access_level": "student", "version": "1"},
                files={"file": ("attendance.txt", b"Approved attendance rules.", "text/plain")},
            )
            second = self.client.post(
                "/api/documents",
                data={"access_level": "student", "version": "2"},
                files={"file": ("attendance.txt", b"Updated attendance rules.", "text/plain")},
            )
            listed = self.client.get("/api/documents")
            deleted = self.client.delete(f"/api/documents/{first.json()['document_id']}")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.json()["document_id"], second.json()["document_id"])
        self.assertEqual(second.json()["version"], "2")
        self.assertEqual(len([item for item in listed.json() if item["file_name"] == "attendance.txt"]), 1)
        self.assertEqual(deleted.status_code, 204)
        index_document.assert_called()
        cleanup.assert_called()
        delete_chunks.assert_called_once_with(first.json()["document_id"])

    def test_document_api_errors_and_student_authorization(self):
        self.client.post(
            "/api/auth/login",
            json={"email": self.admin_email, "password": "TestAdmin123!"},
        )
        invalid_file = self.client.post(
            "/api/documents",
            files={"file": ("records.csv", b"private", "text/csv")},
        )
        self.assertEqual(invalid_file.status_code, 400)

        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            missing_key = self.client.post(
                "/api/documents",
                files={"file": ("policy.txt", b"Approved policy text", "text/plain")},
            )
        self.assertEqual(missing_key.status_code, 503)
        self.assertEqual(missing_key.json()["detail"], "OPENAI_API_KEY is not configured")

        self.client.post(
            "/api/students",
            json={
                "name": "Private Test Student",
                "email": self.student_email,
                "password": "Student123!",
                "program": "Biology",
                "year": 1,
            },
        )
        self.client.post("/api/auth/logout")
        self.client.post(
            "/api/auth/login",
            json={"email": self.student_email, "password": "Student123!"},
        )
        self.assertEqual(self.client.get("/api/documents").status_code, 403)
        denied_upload = self.client.post(
            "/api/documents",
            files={"file": ("policy.txt", b"No access", "text/plain")},
        )
        self.assertEqual(denied_upload.status_code, 403)

    def test_student_signup_creates_student_account_and_starts_session(self):
        registration = {
            "name": "Jordan Park",
            "email": self.signup_email,
            "password": "Student123!",
            "program": "Environmental Science",
            "year": 3,
            "role": "admin",
        }
        response = self.client.post("/api/auth/signup", json=registration)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["user"]["role"], "student")
        self.assertIn("httponly", response.headers["set-cookie"].lower())
        dashboard = self.client.get("/api/dashboard")
        self.assertEqual(dashboard.status_code, 200)
        self.assertEqual(dashboard.json()["student_profile"]["name"], "Jordan Park")
        self.assertEqual(self.client.get("/api/students").status_code, 403)

        duplicate = self.client.post("/api/auth/signup", json=registration)
        self.assertEqual(duplicate.status_code, 409)

        self.client.post("/api/auth/logout")
        login = self.client.post(
            "/api/auth/login",
            json={"email": self.signup_email, "password": "Student123!"},
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["user"]["role"], "student")


if __name__ == "__main__":
    unittest.main()
