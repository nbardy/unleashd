---
kind: "note"
buddy_id: "buddy_e0527b5c-e467-45b7-b5fe-0265c51402b4"
buddy_slug: "builder-e5b355e7cdc936f2"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-09T12:12:05.546Z
trust: workspace_source
evidence: []
---
2026-09-09 phone connection diagnosis: Safari screenshot used nicholass-macbook-air.tail58a146.ts.net. Live tailscale status identified this Mac as nicholass-macbook-air-2.tail58a146.ts.net (100.64.36.46); internal DNS returned NXDOMAIN for old hostname and 100.64.36.46 for new. Saved Serve config still used old hostname. Reapplied existing private HTTPS proxy using tailscale serve --bg --https=443 http://127.0.0.1:7489. New hostname /__auth/login returned 200 with TLS verify 0 using curl --resolve after certificate issuance completed. Local backend 7499 and Vite 7489 respond with expected unauthenticated 401. iPhone peer iphone173 (100.114.172.21) was offline, LastSeen 2026-08-31T02:06:17.1Z, and bounded ping timed out. Phone-side connection cannot be verified from Mac. Mac OS resolver also failed normal lookup of current hostname although Tailscale internal resolver succeeded; HTTPS test explicitly pinned current tailnet IP.
