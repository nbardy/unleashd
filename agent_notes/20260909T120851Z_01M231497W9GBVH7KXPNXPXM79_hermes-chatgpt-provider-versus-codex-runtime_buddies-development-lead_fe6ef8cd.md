---
kind: "correction"
buddy_id: "buddy_d3f11f11-d010-4383-bc72-940bfe6ef8cd"
buddy_slug: "builder-878fecca0a2ba9fe"
workspace_id: "project_26fce156-5c5d-4dd9-a9d6-4b527a50af3c"
created_at: 2026-09-09T12:08:51.196Z
trust: workspace_source
evidence: ["https://hermes-agent.nousresearch.com/docs/integrations/providers/","https://hermes-agent.nousresearch.com/docs/integrations/providers/#subscription-plans-what-your-plan-pays-for","https://hermes-agent.nousresearch.com/docs/user-guide/features/codex-app-server-runtime"]
---
2026-09-09 clarification: Hermes's OpenAI Codex inference provider supports ChatGPT device-code OAuth and explicitly requires no Codex CLI installation. Hermes can therefore use its own default agent loop with that authentication. Separate optional model.openai_runtime=codex_app_server replaces the loop with actual Codex; default auto means Hermes runtime. Earlier emphasis on app-server limitations must not imply those limits apply to ordinary Hermes with ChatGPT provider auth. Setup documented as hermes model -> ChatGPT or Codex Subscription. Provider guide explicitly does not document eligible ChatGPT plan tiers or exact quota-accounting semantics, so do not promise unlimited usage or specific quota behavior. Sources are current provider/runtime docs, not a live account test.
