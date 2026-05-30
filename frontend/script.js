const API_URL = "http://localhost:5000";
let lastQuestion = "";
let lastAnswer = "";
let currentUser = null;

function setStatus(message, tone = "idle") {
  const statusEl = document.getElementById("uploadStatus");
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message;

  const toneMap = {
    idle: "status-pill",
    success: "status-pill border-success text-success",
    warn: "status-pill border-warning text-warning",
    error: "status-pill border-danger text-danger"
  };

  statusEl.className = toneMap[tone] || toneMap.idle;
}

function setAuthStatus(message, tone = "idle") {
  const authStatusEl = document.getElementById("authStatus");
  if (!authStatusEl) {
    return;
  }

  authStatusEl.textContent = message;

  const toneMap = {
    idle: "status-pill",
    success: "status-pill border-success text-success",
    warn: "status-pill border-warning text-warning",
    error: "status-pill border-danger text-danger"
  };

  authStatusEl.className = toneMap[tone] || toneMap.idle;
}

function setAuthenticated(user) {
  currentUser = user;
  const authSection = document.getElementById("authSection");
  const appSection = document.getElementById("appSection");
  const profileArea = document.getElementById("profileArea");
  const profileBadge = document.getElementById("profileBadge");
  const uploadCard = document.getElementById("uploadCard");

  if (authSection) {
    authSection.classList.add("hidden");
  }
  if (appSection) {
    appSection.classList.remove("hidden");
  }
  if (profileArea) {
    profileArea.classList.remove("hidden");
  }
  if (uploadCard) {
    uploadCard.classList.remove("hidden");
  }
  if (profileBadge) {
    const letter = (user?.name || user?.email || "U").trim().charAt(0).toUpperCase();
    profileBadge.textContent = letter || "U";
  }
}

function setUnauthenticated() {
  currentUser = null;
  const authSection = document.getElementById("authSection");
  const appSection = document.getElementById("appSection");
  const profileArea = document.getElementById("profileArea");
  const uploadCard = document.getElementById("uploadCard");

  if (authSection) {
    authSection.classList.remove("hidden");
  }
  if (appSection) {
    appSection.classList.add("hidden");
  }
  if (profileArea) {
    profileArea.classList.add("hidden");
  }
  if (uploadCard) {
    uploadCard.classList.add("hidden");
  }
}

async function fetchJson(path, payload) {
  return fetch(`${API_URL}${path}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );
}

function renderSuggestions(topics) {
  const suggestionsEl = document.getElementById("suggestions");
  if (!suggestionsEl) {
    return;
  }

  suggestionsEl.innerHTML = "";

  if (!Array.isArray(topics) || topics.length === 0) {
    const placeholder = document.createElement("span");
    placeholder.className = "text-muted small";
    placeholder.textContent = "No suggestions yet.";
    suggestionsEl.appendChild(placeholder);
    return;
  }

  topics.forEach((topic) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-chip";
    button.textContent = topic;
    button.addEventListener("click", () => {
      const input = document.getElementById("question");
      input.value = topic;
      askQuestion();
    });
    suggestionsEl.appendChild(button);
  });
}

function renderMarkdown(targetEl, content) {
  if (!targetEl) {
    return;
  }

  if (!content) {
    targetEl.textContent = "";
    return;
  }

  const normalized = normalizeMarkdownContent(content);

  if (window.marked) {
    targetEl.innerHTML = window.marked.parse(normalized);
  } else {
    targetEl.textContent = normalized;
  }
}

function typeMarkdown(targetEl, content, speed = 12) {
  if (!targetEl) {
    return;
  }

  if (!content) {
    targetEl.textContent = "";
    return;
  }

  const normalized = normalizeMarkdownContent(content);

  if (targetEl._typingTimer) {
    clearInterval(targetEl._typingTimer);
  }

  let index = 0;
  targetEl.textContent = "";

  targetEl._typingTimer = setInterval(() => {
    targetEl.textContent += normalized[index];
    index += 1;

    if (index >= normalized.length) {
      clearInterval(targetEl._typingTimer);
      targetEl._typingTimer = null;
      renderMarkdown(targetEl, normalized);
    }
  }, speed);
}

function normalizeMarkdownContent(content) {
  return String(content)
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\r\n/g, "\n");
}

function scrollToExtraInfo(targetEl) {
  if (!targetEl) {
    return;
  }

  targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function uploadPDF() {

  const file =
    document.getElementById("pdf").files[0];

  if (!file) {
    setStatus("Please choose a PDF file first.", "warn");
    return;
  }

  const formData = new FormData();

  formData.append("pdf", file);

  const response = await fetch(
    `${API_URL}/upload`,
    {
      method: "POST",
      credentials: "include",
      body: formData
    }
  );

  const data = await response.json();
  if (response.status === 401) {
    setUnauthenticated();
    setAuthStatus("Please sign in to upload.", "warn");
    return;
  }
  if (!response.ok) {
    setStatus(data?.error || "Upload failed", "error");
    return;
  }

  setStatus(`Upload complete. Chunks: ${data.chunks}`, "success");
}

async function askQuestion() {

  const question =
    document.getElementById("question").value;

  if (!question.trim()) {
    const answerEl = document.getElementById("answer");
    const extraInfoEl = document.getElementById("extraInfo");
    answerEl.textContent = "Type a question to get an answer.";
    if (extraInfoEl) {
      extraInfoEl.textContent = "";
    }
    renderSuggestions([]);
    return;
  }

  lastQuestion = question.trim();

  const response = await fetchJson("/ask", { question });

  const data = await response.json();
  const answerEl = document.getElementById("answer");
  const extraInfoEl = document.getElementById("extraInfo");

  if (response.status === 401) {
    setUnauthenticated();
    setAuthStatus("Please sign in to continue.", "warn");
    return;
  }

  if (!response.ok) {
    const details = data?.details?.message || data?.error || "Request failed";
    typeMarkdown(answerEl, details);
    if (extraInfoEl) {
      typeMarkdown(extraInfoEl, "");
    }
    renderSuggestions([]);
    return;
  }

  lastAnswer = data.answer || "No answer returned.";
  typeMarkdown(answerEl, lastAnswer);
  if (extraInfoEl) {
    typeMarkdown(extraInfoEl, data.extra_info || "");
  }
  renderSuggestions(data.related_topics || []);
}

async function askFollowUp() {
  const followUp = document.getElementById("followUp").value;

  if (!lastQuestion || !lastAnswer) {
    const answerEl = document.getElementById("answer");
    const extraInfoEl = document.getElementById("extraInfo");
    renderMarkdown(answerEl, "Ask a first question before using follow-up.");
    renderMarkdown(extraInfoEl, "");
    renderSuggestions([]);
    return;
  }

  if (!followUp.trim()) {
    return;
  }

  const combinedQuestion = `Original question: ${lastQuestion}\nFollow-up question: ${followUp.trim()}`;

  const response = await fetchJson("/ask", {
    question: combinedQuestion,
    followUp: true
  });

  const data = await response.json();
  const answerEl = document.getElementById("answer");
  const extraInfoEl = document.getElementById("extraInfo");

  if (response.status === 401) {
    setUnauthenticated();
    setAuthStatus("Please sign in to continue.", "warn");
    return;
  }

  if (!response.ok) {
    const details = data?.details?.message || data?.error || "Request failed";
    typeMarkdown(answerEl, details);
    typeMarkdown(extraInfoEl, "");
    renderSuggestions([]);
    return;
  }

  const followUpAnswer = data.extra_info || data.answer || "No follow-up details returned.";
  if (!answerEl.innerHTML) {
    typeMarkdown(answerEl, lastAnswer);
  }
  typeMarkdown(extraInfoEl, `## Follow-up Details\n\n${followUpAnswer}`);
  scrollToExtraInfo(extraInfoEl);
  renderSuggestions(data.related_topics || []);
}

setStatus("Waiting for a file...");

function wireAuthTabs() {
  const tabs = document.querySelectorAll(".auth-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((btn) => btn.classList.remove("active"));
      tab.classList.add("active");

      const target = tab.getAttribute("data-target");
      document.querySelectorAll(".auth-form").forEach((form) => {
        if (form.id === target) {
          form.classList.remove("hidden");
        } else {
          form.classList.add("hidden");
        }
      });
    });
  });
}

async function checkAuth() {
  try {
    const response = await fetch(`${API_URL}/auth/me`, {
      credentials: "include"
    });

    if (!response.ok) {
      setUnauthenticated();
      return;
    }

    const data = await response.json();
    setAuthenticated(data.user);
  } catch (err) {
    setUnauthenticated();
  }
}

async function signup(event) {
  event.preventDefault();
  const name = document.getElementById("signupName").value;
  const email = document.getElementById("signupEmail").value;
  const password = document.getElementById("signupPassword").value;

  setAuthStatus("Creating your account...", "idle");

  const response = await fetchJson("/auth/signup", { name, email, password });
  const data = await response.json();

  if (!response.ok) {
    setAuthStatus(data?.error || "Signup failed", "error");
    return;
  }

  setAuthStatus("Account created.", "success");
  setAuthenticated(data.user);
}

async function login(event) {
  event.preventDefault();
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;

  setAuthStatus("Signing you in...", "idle");

  const response = await fetchJson("/auth/login", { email, password });
  const data = await response.json();

  if (!response.ok) {
    setAuthStatus(data?.error || "Login failed", "error");
    return;
  }

  setAuthStatus("Signed in.", "success");
  setAuthenticated(data.user);
}

async function logout() {
  await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    credentials: "include"
  });

  setAuthStatus("Signed out.", "idle");
  setUnauthenticated();
}

function wireAuthForms() {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");

  if (loginForm) {
    loginForm.addEventListener("submit", login);
  }
  if (signupForm) {
    signupForm.addEventListener("submit", signup);
  }
}

wireAuthTabs();
wireAuthForms();
checkAuth();