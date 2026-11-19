const status = document.getElementById("status");
const create = document.getElementById("create");
const pairing = document.getElementById("pairing");
const copy = document.getElementById("copy");
const storageKey = "supacode-review-invitation";
const parameters = new URLSearchParams(location.hash.slice(1));
let invitation = parameters.get("invite") ?? "";

try {
  if (invitation) sessionStorage.setItem(storageKey, invitation);
  else invitation = sessionStorage.getItem(storageKey) ?? "";
} catch {}

if (parameters.has("invite")) {
  history.replaceState(null, "", location.pathname + location.search);
}

async function createConnection() {
  create.disabled = true;
  status.textContent = "Preparing your connection…";
  document.getElementById("connection").hidden = true;
  document.getElementById("examples").hidden = true;
  try {
    const response = await fetch("/review/pairing", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${invitation}` },
      body: "{}",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    pairing.value = result.pairingUrl;
    document.getElementById("open").href = result.pairingUrl;
    document.getElementById("qr").src = result.qrImage;
    document.getElementById("expiry").textContent =
      `Use this link before ${new Date(result.expiresAt).toLocaleTimeString()}.`;
    document.getElementById("connection").hidden = false;
    document.getElementById("examples").hidden = false;
    copy.textContent = "Copy connection link";
    status.textContent = "Ready to connect.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Please try again.";
  } finally {
    create.disabled = false;
  }
}

create.addEventListener("click", createConnection);

if (invitation) void createConnection();
else status.textContent = "Open the full review link from your invitation.";

copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(pairing.value);
    copy.textContent = "Copied";
  } catch {
    pairing.focus();
    pairing.select();
    copy.textContent = "Select and copy the link above";
  }
});
