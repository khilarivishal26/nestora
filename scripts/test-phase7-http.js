/**
 * Phase 7: HTTP Route and Dashboard Verification
 * Tests the live Express server endpoints for dashboards and role protections.
 */

require("dotenv").config();
const http = require("http");

const BASE = "http://localhost:8080";

function fetchUrl(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = http.request(url, { method: "GET", timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function runHttpDashboardTests() {
  console.log("\n==========================================");
  console.log("--- Testing Phase 7 HTTP Dashboard Protections ---");
  console.log("==========================================");

  // 1. Profile / Guest Dashboard (Unauthenticated -> 302 to /login)
  const resProfile = await fetchUrl("/profile");
  console.log(`GET /profile (Unauth) -> Status: ${resProfile.statusCode} (Expected: 302)`);
  if (resProfile.statusCode !== 302) throw new Error("Expected 302 redirect for unauthenticated /profile");

  // 2. Host Dashboard (Unauthenticated -> 302 to /login)
  const resHost = await fetchUrl("/host/dashboard");
  console.log(`GET /host/dashboard (Unauth) -> Status: ${resHost.statusCode} (Expected: 302)`);
  if (resHost.statusCode !== 302) throw new Error("Expected 302 redirect for unauthenticated /host/dashboard");

  // 3. Admin Dashboard (Unauthenticated -> 302 to /login)
  const resAdmin = await fetchUrl("/admin");
  console.log(`GET /admin (Unauth) -> Status: ${resAdmin.statusCode} (Expected: 302)`);
  if (resAdmin.statusCode !== 302) throw new Error("Expected 302 redirect for unauthenticated /admin");

  console.log("\n==========================================");
  console.log("✅ ALL HTTP DASHBOARD ROUTE PROTECTIONS VERIFIED!");
  console.log("==========================================\n");
}

runHttpDashboardTests().catch((err) => {
  console.error("HTTP Dashboard test failed:", err.message);
  process.exit(1);
});
