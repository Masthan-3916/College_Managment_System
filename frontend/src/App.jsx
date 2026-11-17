import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  FileUp,
  GraduationCap,
  Leaf,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Sprout,
  Trash2,
  Users,
  X,
} from "lucide-react";

async function api(path, options = {}) {
  const isMultipart = options.body instanceof FormData;
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body && !isMultipart ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.detail || "Something went wrong. Please try again.");
  return body;
}

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("Overview");
  const [dashboard, setDashboard] = useState(null);
  const [students, setStudents] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [publicPage, setPublicPage] = useState("home");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantReply, setAssistantReply] = useState("");
  const [assistantSources, setAssistantSources] = useState([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const isAdmin = user?.role === "admin";
  const isStaff = user?.role === "admin" || user?.role === "faculty";

  const refresh = useCallback(async () => {
    const [stats, subjects] = await Promise.all([api("/api/dashboard"), api("/api/courses")]);
    const people = stats.role === "student" ? [] : await api("/api/students");
    setDashboard(stats);
    setStudents(people);
    setCourses(subjects);
  }, []);

  const refreshDocuments = useCallback(async () => {
    setDocumentsLoading(true);
    try {
      setDocuments(await api("/api/documents"));
      setDocumentError("");
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  useEffect(() => {
    api("/api/auth/me")
      .then(({ user: current }) => {
        setUser(current);
        refresh().catch((error) => setToast(error.message));
      })
      .catch((error) => {
        if (!["Not authenticated", "Invalid or expired session"].includes(error.message)) {
          setToast(error.message);
        }
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (page === "Assistant" && isStaff) {
      refreshDocuments().catch((error) => setDocumentError(error.message));
    }
  }, [page, isStaff, refreshDocuments]);

  async function signIn(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const { user: current } = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      setUser(current);
      await refresh();
    } catch (error) {
      setToast(error.message);
    }
  }

  async function signUp(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    if (password !== form.get("confirmPassword")) {
      setToast("Passwords do not match");
      return;
    }

    try {
      const { user: current } = await api("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password,
          program: form.get("program"),
          year: Number(form.get("year")),
        }),
      });
      setUser(current);
      await refresh();
    } catch (error) {
      setToast(error.message);
    }
  }

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" });
    setUser(null);
    setPage("Overview");
  }

  async function createRecord(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (modal === "student") data.year = Number(data.year);
    if (modal === "course") data.credits = Number(data.credits);
    try {
      await api(`/api/${modal === "student" ? "students" : "courses"}`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      await refresh();
      setModal(null);
      setToast(modal === "student" ? "Student account created" : "Course added to catalog");
    } catch (error) {
      setToast(error.message);
    }
  }

  async function askAssistant(event) {
    event.preventDefault();
    const prompt = assistantQuestion.trim();
    if (!prompt) return;

    setAssistantLoading(true);
    setAssistantReply("");
    setAssistantSources([]);
    try {
      const { answer, sources } = await api("/api/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
      setAssistantReply(answer);
      setAssistantSources(sources);
      setAssistantQuestion("");
    } catch (error) {
      setAssistantReply(error.message);
      setAssistantSources([]);
    } finally {
      setAssistantLoading(false);
    }
  }

  async function uploadDocument(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setUploadingDocument(true);
    setDocumentError("");
    try {
      await api("/api/documents", { method: "POST", body: new FormData(form) });
      form.reset();
      await refreshDocuments();
    } catch (error) {
      setDocumentError(error.message);
    } finally {
      setUploadingDocument(false);
    }
  }

  async function deleteDocument(documentId) {
    if (!window.confirm("Delete this indexed document?")) return;
    setDeletingDocumentId(documentId);
    setDocumentError("");
    try {
      await api(`/api/documents/${documentId}`, { method: "DELETE" });
      await refreshDocuments();
    } catch (error) {
      setDocumentError(error.message);
    } finally {
      setDeletingDocumentId("");
    }
  }

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (loading) {
    return <div className="loading-screen"><span className="brand-mark"><GraduationCap size={22} /></span><span>Preparing your campus...</span></div>;
  }

  if (!user && publicPage === "home") {
    return <CollegeSite onOpenAuth={setPublicPage} />;
  }
  if (!user) {
    return (
      <Login
        mode={publicPage}
        setMode={setPublicPage}
        onSubmit={signIn}
        onSignup={signUp}
        message={toast}
        clearMessage={() => setToast("")}
        onHome={() => setPublicPage("home")}
      />
    );
  }

  const filteredStudents = students.filter((student) =>
    [student.name, student.email, student.program].some((value) => value.toLowerCase().includes(search.toLowerCase())),
  );
  const filteredCourses = courses.filter((course) =>
    [course.code, course.title, course.instructor].some((value) => value.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setPage("Overview")}>
          <span className="brand-mark"><GraduationCap size={23} strokeWidth={2.2} /></span>
          <span className="brand-name">GKR Royal<small>Institutes of Agriculture</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          <button className={`nav-item ${page === "Overview" ? "active" : ""}`} onClick={() => setPage("Overview")}><LayoutDashboard size={18} /> Overview</button>
          {user.role !== "student" && <button className={`nav-item ${page === "Students" ? "active" : ""}`} onClick={() => setPage("Students")}><Users size={18} /> Students <span className="nav-count">{students.length}</span></button>}
          <button className={`nav-item ${page === "Courses" ? "active" : ""}`} onClick={() => setPage("Courses")}><BookOpen size={18} /> Courses <span className="nav-count">{courses.length}</span></button>
          <button className={`nav-item ${page === "Assistant" ? "active" : ""}`} onClick={() => setPage("Assistant")}><Bot size={18} /> AI Assistant</button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="help-card">
          <div className="help-icon"><Sparkles size={16} /></div>
          <strong>Your campus, in sync.</strong>
          <p>Keep student records and courses organized in one place.</p>
        </div>
        <button className="profile-button" onClick={signOut}>
          <span className="avatar">{initials(user.email)}</span>
          <span className="profile-copy"><strong>{user.email.split("@")[0]}</strong><small>{capitalize(user.role)}</small></span>
          <LogOut size={16} className="profile-logout" />
        </button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">Campus <span>/</span> <strong>{page}</strong></div>
          <div className="topbar-actions">
            <label className="global-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search anything..." /><kbd>⌘ K</kbd></label>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <div className="topbar-divider" />
            <button className="user-chip" onClick={signOut}><span className="avatar small">{initials(user.email)}</span><ChevronDown size={14} /></button>
          </div>
        </header>

        <div className="content">
          {page === "Overview" && (user.role === "student"
            ? <StudentOverview dashboard={dashboard} courses={courses} setPage={setPage} />
            : <Overview dashboard={dashboard} students={students} setPage={setPage} setModal={setModal} isAdmin={isAdmin} />)}
          {page === "Students" && <StudentsPage students={filteredStudents} setModal={setModal} isAdmin={isAdmin} />}
          {page === "Courses" && <CoursesPage courses={filteredCourses} setModal={setModal} isAdmin={isAdmin} />}
          {page === "Assistant" && <AssistantPage
            question={assistantQuestion}
            setQuestion={setAssistantQuestion}
            reply={assistantReply}
            sources={assistantSources}
            onSubmit={askAssistant}
            loading={assistantLoading}
            isStaff={isStaff}
            isAdmin={isAdmin}
            documents={documents}
            documentsLoading={documentsLoading}
            documentError={documentError}
            uploadingDocument={uploadingDocument}
            deletingDocumentId={deletingDocumentId}
            onUpload={uploadDocument}
            onDelete={deleteDocument}
          />}
        </div>
      </main>

      {modal && <RecordModal kind={modal} onClose={() => setModal(null)} onSubmit={createRecord} />}
      {toast && <div className={`toast ${toast.toLowerCase().includes("wrong") || toast.toLowerCase().includes("already") ? "error" : ""}`}><Check size={17} />{toast}</div>}
    </div>
  );
}

function Login({ mode, setMode, onSubmit, onSignup, message, clearMessage, onHome }) {
  const signingUp = mode === "signup";

  function changeMode(nextMode) {
    setMode(nextMode);
    clearMessage();
  }

  return (
    <main className="login-page">
      <section className="login-visual">
        <button className="brand login-brand" onClick={onHome}><span className="brand-mark"><GraduationCap size={23} /></span><span className="brand-name">GKR Royal<small>Institutes of Agriculture</small></span></button>
        <div className="visual-copy">
          <div className="eyebrow"><span /> THE MODERN CAMPUS, CONNECTED</div>
          <h1>Everything your<br />campus needs.<br /><em>All in one place.</em></h1>
          <p>A calmer way to manage students, courses, and the details that keep your college moving forward.</p>
          <div className="visual-footer"><div className="avatar-stack"><span>JR</span><span>AM</span><span>SK</span><span>+</span></div><div><strong>One campus community</strong><small>Built for the people who make it thrive</small></div></div>
        </div>
        <div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" />
        <div className="visual-bottom">A LITTLE MORE ORGANIZED. A LOT MORE CONNECTED.</div>
      </section>
      <section className="login-panel">
        <div className={`login-card ${signingUp ? "signup-card" : ""}`}>
          <div className="login-icon"><ShieldCheck size={22} /></div>
          <div className="eyebrow dark">{signingUp ? "JOIN YOUR CAMPUS" : "WELCOME BACK"}</div>
          <h2>{signingUp ? <>Create your campus<br />account</> : <>Sign in to your<br />campus portal</>}</h2>
          <p className="login-subtitle">{signingUp ? "Sign up as a student to join your college community." : "Use your college account to continue."}</p>
          <form onSubmit={signingUp ? onSignup : onSubmit} className="login-form">
            {signingUp && <label>Full name<input name="name" type="text" placeholder="e.g. Alex Rivera" minLength="2" maxLength="100" autoComplete="name" required /></label>}
            <label>Email address<input name="email" type="email" placeholder="you@college.edu" autoComplete="username" required /></label>
            {signingUp && <div className="signup-row"><label>Program<input name="program" placeholder="e.g. Biology" minLength="2" maxLength="100" required /></label><label>Year<select name="year" defaultValue="1">{[1, 2, 3, 4, 5, 6, 7, 8].map((year) => <option key={year} value={year}>Year {year}</option>)}</select></label></div>}
            <label>Password<input name="password" type="password" placeholder={signingUp ? "At least 8 characters" : "Enter your password"} minLength={signingUp ? 8 : undefined} maxLength="128" autoComplete={signingUp ? "new-password" : "current-password"} required /></label>
            {signingUp && <label>Confirm password<input name="confirmPassword" type="password" placeholder="Enter your password again" minLength="8" maxLength="128" autoComplete="new-password" required /></label>}
            {message && <div className="form-error">{message}</div>}
            <button className="primary-button login-submit" type="submit">{signingUp ? "Create student account" : "Sign in"} <ArrowRight size={17} /></button>
          </form>
          <div className="login-secure"><ShieldCheck size={15} /> Your sign-in is protected and encrypted</div>
          <div className="auth-switch">{signingUp ? "Already have an account?" : "New to your campus?"}<button type="button" onClick={() => changeMode(signingUp ? "login" : "signup")}>{signingUp ? "Sign in" : "Create an account"}</button></div>
        </div>
        <div className="login-copyright">© 2026 GKR Royal Institutes of Agriculture <span>·</span> Student and campus portal</div>
      </section>
    </main>
  );
}

function CollegeSite({ onOpenAuth }) {
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="college-site">
      <div className="college-topline">
        <div className="college-topline-inner">
          <span><Leaf size={14} /> Learning rooted in agriculture</span>
          <a href="#contact">Admissions &amp; enquiries <ArrowRight size={13} /></a>
        </div>
      </div>
      <header className="college-header">
        <a className="college-brand" href="#home" onClick={closeMenu}>
          <span className="college-brand-mark"><GraduationCap size={27} /></span>
          <span><strong>GKR Royal</strong><small>Institutes of Agriculture</small></span>
        </a>
        <button className="college-menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Close menu" : "Open menu"}>
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        <nav className={`college-nav ${menuOpen ? "open" : ""}`} aria-label="College navigation">
          {[["About", "#about"], ["Academics", "#academics"], ["Achievements", "#achievements"], ["Contact", "#contact"]].map(([label, target]) => (
            <a key={target} href={target} onClick={closeMenu}>{label}</a>
          ))}
          <button className="college-login-link" onClick={() => { closeMenu(); onOpenAuth("login"); }}>Login</button>
          <button className="college-apply-button" onClick={() => { closeMenu(); onOpenAuth("signup"); }}>Student signup <ArrowRight size={15} /></button>
        </nav>
      </header>

      <main>
        <section className="college-hero" id="home">
          <div className="college-hero-image" />
          <div className="college-hero-shade" />
          <div className="college-hero-content">
            <div className="college-eyebrow"><span /> GROW KNOWLEDGE. CULTIVATE THE FUTURE.</div>
            <h1>Rooted in the land.<br />Growing <em>what’s next.</em></h1>
            <p>Discover an agriculture-focused learning community where knowledge meets the field and new ideas can take root.</p>
            <div className="college-hero-actions">
              <button className="college-cta-primary" onClick={() => onOpenAuth("signup")}>Join our student community <ArrowRight size={17} /></button>
              <a className="college-cta-secondary" href="#about">Discover GKR Royal <ChevronRight size={17} /></a>
            </div>
            <div className="college-hero-footnote"><Sprout size={16} /> Agriculture education for a changing world</div>
          </div>
          <a className="hero-scroll" href="#about"><span /> Scroll to explore</a>
          <div className="hero-index"><strong>01</strong><span> / 04</span></div>
        </section>

        <section className="college-intro-section" id="about">
          <div className="college-section-kicker">WELCOME TO GKR ROYAL</div>
          <div className="college-intro-grid">
            <h2>Education that<br />takes root <em>and grows.</em></h2>
            <div className="college-intro-copy">
              <p>GKR Royal Institutes of Agriculture brings the world of agriculture into the learning journey. Explore a place to build knowledge, develop practical understanding, and prepare to contribute to the future of food and farming.</p>
              <a className="college-text-link" href="#academics">Get to know our learning approach <ArrowRight size={16} /></a>
            </div>
          </div>
          <div className="college-values">
            <article><span>01</span><div><Leaf size={20} /><h3>Learn from nature</h3><p>Connect classroom concepts with the living systems that sustain us.</p></div></article>
            <article><span>02</span><div><Compass size={20} /><h3>Think with purpose</h3><p>Ask thoughtful questions and explore meaningful solutions.</p></div></article>
            <article><span>03</span><div><Sprout size={20} /><h3>Grow together</h3><p>Build your path alongside a community with shared curiosity.</p></div></article>
          </div>
        </section>

        <section className="college-academics-section" id="academics">
          <div className="college-academics-image" role="img" aria-label="Sunlight over a green agricultural field" />
          <div className="college-academics-copy">
            <div className="college-section-kicker">LEARNING AT GKR ROYAL</div>
            <h2>Bring your curiosity.<br /><em>Get your hands in.</em></h2>
            <p>Agriculture is connected to science, the environment, technology, and everyday life. Build a strong foundation and explore where your interests can lead.</p>
            <div className="academic-points">
              <div><span><Check size={15} /></span> Agriculture-centred learning</div>
              <div><span><Check size={15} /></span> Practical and field-oriented perspectives</div>
              <div><span><Check size={15} /></span> A community for curious learners</div>
            </div>
            <button className="college-dark-button" onClick={() => onOpenAuth("signup")}>Start your student profile <ArrowRight size={16} /></button>
          </div>
        </section>

        <section className="college-achievements-section" id="achievements">
          <div className="college-achievements-heading">
            <div><div className="college-section-kicker">A CULTURE OF POSSIBILITY</div><h2>Every season brings<br /><em>room to grow.</em></h2></div>
            <p>Achievement begins with curiosity, grows through practice, and takes shape in the goals each student chooses to pursue.</p>
          </div>
          <div className="achievement-grid">
            <article className="achievement-card achievement-feature">
              <div className="achievement-art"><Sprout size={54} strokeWidth={1.1} /><span className="achievement-sun" /></div>
              <div className="achievement-card-copy"><span>LEARNING IN ACTION</span><h3>Ideas with roots in the real world</h3><p>Explore agriculture through questions, observation, and practical perspectives.</p></div>
            </article>
            <article className="achievement-card">
              <div className="achievement-icon"><AwardIcon /></div>
              <span>PERSONAL GROWTH</span><h3>Progress worth celebrating</h3><p>Recognize the dedication behind each new skill, discovery, and milestone.</p>
            </article>
            <article className="achievement-card">
              <div className="achievement-icon green"><Users size={24} /></div>
              <span>COMMUNITY</span><h3>Better work, together</h3><p>Share perspectives and make room for collaboration across the campus.</p>
            </article>
          </div>
        </section>

        <section className="college-join-section" id="contact">
          <div className="join-leaf"><Leaf size={23} /></div>
          <div><div className="college-section-kicker">YOUR NEXT CHAPTER STARTS HERE</div><h2>Ready to grow with us?</h2><p>Create a student account to join the campus portal and explore your college community.</p></div>
          <button className="college-cta-primary" onClick={() => onOpenAuth("signup")}>Create a student account <ArrowRight size={17} /></button>
        </section>
      </main>

      <footer className="college-footer">
        <div className="college-footer-main">
          <div className="college-footer-about">
            <a className="college-brand footer-brand" href="#home"><span className="college-brand-mark"><GraduationCap size={27} /></span><span><strong>GKR Royal</strong><small>Institutes of Agriculture</small></span></a>
            <p>Growing knowledge and possibility through agriculture-focused education.</p>
          </div>
          <div className="college-footer-links"><strong>Explore</strong><a href="#about">About the college</a><a href="#academics">Academics</a><a href="#achievements">Achievements</a></div>
          <div className="college-footer-links"><strong>Campus portal</strong><button onClick={() => onOpenAuth("login")}>Student login</button><button onClick={() => onOpenAuth("signup")}>Student signup</button><a href="#contact">Contact &amp; enquiries</a></div>
          <div className="college-footer-contact"><strong>GKR Royal Institutes of Agriculture</strong><span><MapPin size={15} /> Agriculture-focused learning community</span><span><Mail size={15} /> Connect through the student portal</span></div>
        </div>
        <div className="college-footer-bottom"><span>© {new Date().getFullYear()} GKR Royal Institutes of Agriculture</span><a href="#home">Back to top ↑</a><span>Learn · Grow · Cultivate</span></div>
      </footer>
    </div>
  );
}

function AwardIcon() {
  return <Sparkles size={24} />;
}

function AssistantPage({ question, setQuestion, reply, sources, onSubmit, loading, isStaff, isAdmin, documents, documentsLoading, documentError, uploadingDocument, deletingDocumentId, onUpload, onDelete }) {
  return (
    <section className="panel assistant-panel">
      <div className="panel-heading assistant-heading">
        <div>
          <div className="eyebrow dark">AI HELP</div>
          <h2 className="page-title">Campus assistant</h2>
          <p>Ask about approved college policies, handbooks, and courses. Answers include the documents they came from.</p>
        </div>
      </div>

      <form className="assistant-form" onSubmit={onSubmit}>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask the campus AI assistant anything..."
          rows="3"
          required
        />
        <div className="assistant-actions">
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Searching documents..." : "Ask campus assistant"}
          </button>
        </div>
      </form>

      <div className="assistant-output">
        <div className="assistant-label">Answer</div>
        <div className={`assistant-bubble ${reply ? "filled" : "empty"}`}>
          {loading ? "Retrieving approved sources and preparing an answer..." : (reply || "Your answer will appear here.")}
        </div>
      </div>

      {!loading && sources.length > 0 && <div className="assistant-sources">
        <div className="assistant-label">Sources</div>
        <ul>{sources.map((source, index) => <li key={`${source.file_name}-${source.page_number}-${source.chunk_number}-${index}`}>
          <strong>{source.file_name}</strong>
          {source.page_number && <span>Page {source.page_number}</span>}
          {source.course && <span>{source.course}</span>}
          <p>{source.excerpt}</p>
        </li>)}</ul>
      </div>}

      {isStaff && <section className="rag-documents" aria-labelledby="rag-documents-title">
        <div className="panel-heading">
          <div>
            <div className="eyebrow dark">KNOWLEDGE BASE</div>
            <h3 id="rag-documents-title" className="page-title">College documents</h3>
            <p>Only upload approved policy, handbook, FAQ, and course documents. Never upload private student records.</p>
          </div>
        </div>
        <form className="document-upload-form" onSubmit={onUpload}>
          <label className="document-file-field">Document file <span>PDF, DOCX, TXT, or Markdown</span><input name="file" type="file" accept=".pdf,.docx,.txt,.md,.markdown" required /></label>
          <div className="document-metadata-fields">
            <label>Department<input name="department" maxLength="100" placeholder="Optional" /></label>
            <label>Course<input name="course" maxLength="100" placeholder="Optional" /></label>
            <label>Version<input name="version" maxLength="64" defaultValue="1" required /></label>
            <label>Access<select name="access_level" defaultValue="student">
              <option value="public">All signed-in users</option>
              <option value="student">Students and staff</option>
              <option value="faculty">Faculty and admins</option>
              {isAdmin && <option value="admin">Admins only</option>}
            </select></label>
          </div>
          <button className="primary-button" type="submit" disabled={uploadingDocument}>
            <FileUp size={16} />{uploadingDocument ? "Indexing..." : "Upload and index"}
          </button>
        </form>
        {documentError && <p className="document-error" role="alert">{documentError}</p>}
        <div className="document-list-heading"><strong>Indexed documents</strong><span>{documentsLoading ? "Loading..." : documents.length}</span></div>
        {documents.length > 0 ? <ul className="document-list">{documents.map((document) => <li key={document.document_id}>
          <div><strong>{document.file_name}</strong><small>{[document.department, document.course, document.access_level, `v${document.version}`].filter(Boolean).join(" · ")}</small></div>
          <button className="document-delete-button" type="button" title={`Delete ${document.file_name}`} aria-label={`Delete ${document.file_name}`} disabled={deletingDocumentId === document.document_id} onClick={() => onDelete(document.document_id)}><Trash2 size={16} /></button>
        </li>)}</ul> : !documentsLoading && <p className="document-empty">No college documents have been indexed.</p>}
      </section>}
    </section>
  );
}

function Overview({ dashboard, students, setPage, setModal, isAdmin }) {
  return (
    <>
      <div className="welcome-row">
        <div><div className="eyebrow dark">{todayLabel()}</div><h1>{greeting()} <span className="wave">✳</span></h1><p>Here’s what’s happening across your campus today.</p></div>
        {isAdmin && <button className="primary-button" onClick={() => setModal("student")}><Plus size={17} /> Add a student</button>}
      </div>
      <div className="stats-grid">
        <StatCard label="Total students" value={dashboard?.student_count ?? 0} icon={<Users size={19} />} note="Enrolled in your college" tone="blue" />
        <StatCard label="Active courses" value={dashboard?.course_count ?? 0} icon={<BookOpen size={19} />} note="In the course catalog" tone="violet" />
        <div className="stat-card term-card"><div className="term-top"><div><span className="stat-label">CURRENT TERM</span><div className="term-name">Fall semester</div></div><span className="term-badge"><span /> In progress</span></div><div className="term-line"><span /></div><div className="term-dates"><span>Aug 25, 2026</span><span>Dec 18, 2026</span></div></div>
      </div>
      <div className="dashboard-grid">
        <section className="panel recent-panel">
          <div className="panel-heading"><div><h2>Recently added students</h2><p>Your newest members of the community</p></div><button className="text-button" onClick={() => setPage("Students")}>View all <ArrowRight size={15} /></button></div>
          {students.length ? <div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>PROGRAM</th><th>YEAR</th><th>STATUS</th></tr></thead><tbody>{students.slice(0, 5).map((student, index) => <tr key={student.id}><td><div className="student-cell"><span className={`avatar table-avatar avatar-${index % 4}`}>{initials(student.name)}</span><span><strong>{student.name}</strong><small>{student.email}</small></span></div></td><td>{student.program}</td><td>Year {student.year}</td><td><span className="status-pill"><i /> Active</span></td></tr>)}</tbody></table></div> : <EmptyState title="Your student list starts here" text="Add a student to begin building your campus community." action={isAdmin ? <button className="secondary-button" onClick={() => setModal("student")}><Plus size={15} /> Add student</button> : null} />}
        </section>
        <aside className="panel quick-panel">
          <div className="panel-heading"><div><h2>Quick actions</h2><p>Good things start here</p></div></div>
          <button className="quick-action" onClick={() => setModal("student")} disabled={!isAdmin}><span className="quick-icon peach"><Users size={17} /></span><span><strong>Add a student</strong><small>Create a student record</small></span><ArrowRight size={16} /></button>
          <button className="quick-action" onClick={() => setModal("course")} disabled={!isAdmin}><span className="quick-icon lavender"><BookOpen size={17} /></span><span><strong>Add a course</strong><small>Grow your course catalog</small></span><ArrowRight size={16} /></button>
          <div className="quick-note"><Sparkles size={15} /><span>Your campus is looking good. Keep the momentum going.</span></div>
        </aside>
      </div>
    </>
  );
}

function StudentOverview({ dashboard, courses, setPage }) {
  const profile = dashboard?.student_profile;
  return (
    <>
      <div className="welcome-row">
        <div><div className="eyebrow dark">{todayLabel()} · STUDENT PORTAL</div><h1>Welcome, {profile?.name?.split(" ")[0] || "student"} <span className="wave">✳</span></h1><p>Your college information, all in one place.</p></div>
      </div>
      <div className="stats-grid">
        <StatCard label="Available courses" value={courses.length} icon={<BookOpen size={19} />} note="Explore your college catalog" tone="blue" />
        <section className="stat-card student-profile-card"><span className="stat-label">YOUR PROGRAM</span><div className="term-name">{profile?.program || "Profile not available"}</div><div className="stat-note">{profile ? `Year ${profile.year}` : "Contact your college administrator"}</div></section>
      </div>
      <section className="panel quick-panel student-courses"><div className="panel-heading"><div><h2>Explore courses</h2><p>Browse what’s available at your college</p></div><button className="text-button" onClick={() => setPage("Courses")}>View catalog <ArrowRight size={15} /></button></div>{courses.length ? <div className="course-grid">{courses.slice(0, 3).map((course, index) => <article className="course-card" key={course.id}><div className={`course-icon tone-${index % 4}`}><BookOpen size={19} /></div><div className="course-code">{course.code} <span>· {course.credits} credits</span></div><h3>{course.title}</h3><div className="course-instructor">{course.instructor}</div></article>)}</div> : <EmptyState title="Courses are on their way" text="Your college has not added any courses yet." />}</section>
    </>
  );
}

function StatCard({ label, value, icon, note, tone }) {
  return <section className="stat-card"><div className="stat-top"><span className={`stat-icon ${tone}`}>{icon}</span><span className="stat-label">{label}</span><button aria-label={`More about ${label}`} className="more-button">···</button></div><div className="stat-value">{value.toLocaleString()}</div><div className="stat-note">{note}</div></section>;
}

function StudentsPage({ students, setModal, isAdmin }) {
  return <section className="panel full-panel"><div className="panel-heading"><div><div className="eyebrow dark">YOUR CAMPUS COMMUNITY</div><h2 className="page-title">Students <span className="count-bubble">{students.length}</span></h2><p>Manage student records and their college accounts.</p></div>{isAdmin && <button className="primary-button" onClick={() => setModal("student")}><Plus size={17} /> Add a student</button>}</div>{students.length ? <div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>EMAIL</th><th>PROGRAM</th><th>YEAR</th><th>STATUS</th></tr></thead><tbody>{students.map((student, index) => <tr key={student.id}><td><div className="student-cell"><span className={`avatar table-avatar avatar-${index % 4}`}>{initials(student.name)}</span><strong>{student.name}</strong></div></td><td>{student.email}</td><td>{student.program}</td><td>Year {student.year}</td><td><span className="status-pill"><i /> Active</span></td></tr>)}</tbody></table></div> : <EmptyState title="No students found" text="Try another search, or add your first student." action={isAdmin ? <button className="secondary-button" onClick={() => setModal("student")}><Plus size={15} /> Add student</button> : null} />}</section>;
}

function CoursesPage({ courses, setModal, isAdmin }) {
  return <section className="panel full-panel"><div className="panel-heading"><div><div className="eyebrow dark">ACADEMIC PROGRAMS</div><h2 className="page-title">Course catalog <span className="count-bubble">{courses.length}</span></h2><p>Explore the courses offered at your college.</p></div>{isAdmin && <button className="primary-button" onClick={() => setModal("course")}><Plus size={17} /> Add a course</button>}</div>{courses.length ? <div className="course-grid">{courses.map((course, index) => <article className="course-card" key={course.id}><div className={`course-icon tone-${index % 4}`}><BookOpen size={19} /></div><div className="course-code">{course.code} <span>· {course.credits} credits</span></div><h3>{course.title}</h3><div className="course-instructor"><span className="avatar tiny">{initials(course.instructor)}</span> {course.instructor}</div></article>)}</div> : <EmptyState title="Your catalog is ready to grow" text="Add a course to start building your academic catalog." action={isAdmin ? <button className="secondary-button" onClick={() => setModal("course")}><Plus size={15} /> Add course</button> : null} />}</section>;
}

function EmptyState({ title, text, action }) {
  return <div className="empty-state"><div className="empty-icon"><GraduationCap size={24} /></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}

function RecordModal({ kind, onClose, onSubmit }) {
  const student = kind === "student";
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><div className="eyebrow dark">{student ? "CAMPUS COMMUNITY" : "ACADEMIC PROGRAMS"}</div><h2 id="modal-title">{student ? "Add a student" : "Add a course"}</h2><p>{student ? "Create a student profile and sign-in account." : "Add a new course to your college catalog."}</p></div><button className="icon-button close-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div><form className="record-form" onSubmit={onSubmit}>{student ? <><label>Full name<input name="name" placeholder="e.g. Alex Rivera" minLength="2" maxLength="100" required /></label><label>Email address<input name="email" type="email" placeholder="alex@college.edu" required /></label><label>Temporary password<input name="password" type="password" placeholder="At least 8 characters" minLength="8" maxLength="128" required /></label><div className="form-row"><label>Program<input name="program" placeholder="e.g. Computer Science" minLength="2" required /></label><label>Year<select name="year" defaultValue="1">{[1, 2, 3, 4, 5, 6, 7, 8].map((year) => <option key={year} value={year}>Year {year}</option>)}</select></label></div></> : <><label>Course code<input name="code" placeholder="e.g. CS101" minLength="2" maxLength="20" required /></label><label>Course title<input name="title" placeholder="e.g. Introduction to Computer Science" minLength="2" required /></label><label>Instructor<input name="instructor" placeholder="e.g. Dr. Jordan Lee" minLength="2" required /></label><label>Credits<select name="credits" defaultValue="3">{[1, 2, 3, 4, 5, 6].map((credit) => <option key={credit} value={credit}>{credit} credits</option>)}</select></label></>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">{student ? "Create student" : "Add course"} <ArrowRight size={16} /></button></div></form></section></div>;
}

function initials(value) {
  return value.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function todayLabel() {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date()).toUpperCase();
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default App;
