//login.js
  const API_BASE = "http://localhost:3000";
  const TOKEN_KEY = "authToken";

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Login failed");
        return;
      }

      localStorage.setItem(TOKEN_KEY, data.token);
      location.href = "/index.html";
    } catch (err) {
      console.error(err);
      alert("Network error");
    }
  });
