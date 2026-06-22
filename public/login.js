// Si ya hay sesión válida, saltar directo a la biblioteca.
fetch("/api/session").then((r) => { if (r.ok) location.href = "/library"; }).catch(() => {});

const form = document.getElementById("login");
const err = document.getElementById("err");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  err.hidden = true;
  const token = document.getElementById("token").value;
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (res.ok) location.href = "/library";
  else { err.textContent = "Token inválido."; err.hidden = false; }
});
