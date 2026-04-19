INSERT INTO "integration" ("id", "jsonschema")
VALUES (
  'asana',
  '{"type":"object","properties":{"accessToken":{"type":"string"},"workspaceGid":{"type":"string"},"issuesProjectGid":{"type":"string"}},"required":["accessToken"]}'::json
);
