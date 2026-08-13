/**
 * JSON Schema copied into every managed Applet project. Keeping the schema
 * next to the project gives coding agents editor feedback without coupling a
 * user's source tree to the Amiba installation path.
 */
export const MANAGED_APP_MANIFEST_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://amiba.local/schemas/managed-applet-manifest-v1.json",
  title: "Amiba managed Applet manifest",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "id", "name", "kind", "runtime"],
  properties: {
    $schema: { type: "string" },
    schemaVersion: { const: 1 },
    id: { type: "string", pattern: "^[a-z0-9]+(?:[.-][a-z0-9-]+)+$" },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    icon: { type: "string" },
    kind: {
      enum: ["static-content", "interactive-ui", "tool-app", "registered-mcp"],
    },
    runtime: { enum: ["static-mcp-app", "node", "python", "registered"] },
    mcp: {
      type: "object",
      additionalProperties: false,
      required: ["providers"],
      properties: {
        providers: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["alias", "kind"],
            properties: {
              alias: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]*$" },
              kind: { enum: ["bundled", "registered"] },
              runtime: { enum: ["node", "python"] },
              entry: { type: "string" },
              command: { type: "string" },
              args: { type: "array", items: { type: "string" } },
              transport: { enum: ["stdio", "streamable-http"] },
              url: { type: "string" },
              providerId: { type: "string" },
              version: { type: "string" },
            },
          },
        },
      },
    },
    surfaces: {
      type: "object",
      additionalProperties: false,
      properties: {
        main: { $ref: "#/$defs/surface" },
        settings: { $ref: "#/$defs/surface" },
      },
    },
    mentions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "provider", "label"],
        properties: {
          id: { type: "string", minLength: 1 },
          provider: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          icon: { type: "string" },
          resourceUriTemplate: { type: "string" },
          searchTool: { type: "string" },
        },
        oneOf: [
          { required: ["resourceUriTemplate"], not: { required: ["searchTool"] } },
          { required: ["searchTool"], not: { required: ["resourceUriTemplate"] } },
        ],
      },
    },
    permissions: { type: "array", uniqueItems: true, items: { type: "string" } },
    dataSchemaVersion: { type: "integer", minimum: 1 },
    build: {
      type: "object",
      additionalProperties: false,
      properties: {
        commands: { $ref: "#/$defs/commands" },
        testCommands: { $ref: "#/$defs/commands" },
        outputDir: { type: "string" },
      },
    },
  },
  $defs: {
    surface: {
      type: "object",
      additionalProperties: false,
      required: ["resourceUri"],
      properties: {
        provider: { type: "string" },
        resourceUri: { type: "string", pattern: "^ui://" },
        entry: { type: "string" },
      },
    },
    commands: {
      type: "array",
      items: { type: "array", minItems: 1, items: { type: "string" } },
    },
  },
} as const

