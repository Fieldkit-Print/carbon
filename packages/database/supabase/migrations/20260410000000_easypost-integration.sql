-- Add EasyPost to the integration registry so the verify_integration trigger passes
INSERT INTO "integration" ("id", "jsonschema")
VALUES (
  'easypost',
  '{"type":"object","properties":{"apiKey":{"type":"string"},"testApiKey":{"type":"string"},"webhookSecret":{"type":"string"}},"required":["apiKey"]}'::json
);
