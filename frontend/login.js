// frontend/login.js
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  try {
    const res = await fetch(`${window.API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) {
      alert(data?.error || "Login failed");
      return;
    }

    // Store with the shared key so auth-client.js can read it
    localStorage.setItem(window.TOKEN_KEY, data.token);

    // Redirect to ?next=... or home
    const u = new URL(location.href);
    location.href = u.searchParams.get("next") || "/index.html";
  } catch (err) {
    console.error(err);
    alert("Network error");
  }
});
