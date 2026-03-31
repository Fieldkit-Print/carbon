import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PDFTOOLBOX_BIN = "/opt/callas/cli/pdfToolbox";
const PROCESS_PLANS_DIR = "/app/process-plans";

const LICENSE_SERVER =
  process.env.PDFTOOLBOX_LICENSE_SERVER || "licenseserver.callassoftware.com";
const LICENSE_MESSAGE = process.env.PDFTOOLBOX_LICENSE_MESSAGE || "";

const AUTH_TOKEN = process.env.PDFTOOLBOX_AUTH_TOKEN || "";

const fastify = Fastify({
  logger: true,
  bodyLimit: 100 * 1024 * 1024, // 100MB
});

await fastify.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

// Auth check for all routes except health
fastify.addHook("onRequest", async (request, reply) => {
  if (request.url === "/health") return;
  if (!AUTH_TOKEN) return; // no token configured = no auth required

  const header = request.headers.authorization;
  if (header !== `Bearer ${AUTH_TOKEN}`) {
    reply.code(401);
    throw new Error("Unauthorized");
  }
});

// Health check
fastify.get("/health", async () => ({ status: "ok" }));

/**
 * POST /process
 *
 * Multipart form:
 *   - file: the input PDF file
 *   - args: JSON string array of CLI arguments
 *   - processPlan: (optional) name of a .kfpx file in /app/process-plans/
 *   - outputExtension: (optional) output file extension (default: "pdf")
 *
 * Returns the processed file as application/octet-stream with headers:
 *   - X-Exit-Code: pdfToolbox exit code
 *   - X-Log: truncated CLI output
 */
fastify.post("/process", async (request, reply) => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ptb-"));

  try {
    const data = await request.file();
    if (!data) {
      reply.code(400);
      return { error: "No file uploaded" };
    }

    // Read the uploaded file
    const chunks = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const fileBuffer = Buffer.concat(chunks);

    // Parse fields from the multipart form
    const fields = {};
    for (const [key, field] of Object.entries(data.fields)) {
      if (field && typeof field === "object" && "value" in field) {
        fields[key] = field.value;
      }
    }

    const cliArgs = fields.args ? JSON.parse(fields.args) : [];
    const processPlan = fields.processPlan || null;
    const outputExtension = fields.outputExtension || "pdf";

    // Write input file
    const inputFile = path.join(tmpDir, `input.pdf`);
    const outputFile = path.join(tmpDir, `output.${outputExtension}`);
    await fs.writeFile(inputFile, fileBuffer);

    // Build CLI arguments
    const args = [];

    // Add license server flags
    if (LICENSE_MESSAGE) {
      args.push(`--licenseserver=${LICENSE_SERVER}`);
      args.push(`--lsmessage=${LICENSE_MESSAGE}`);
    }

    if (processPlan) {
      const planPath = path.join(PROCESS_PLANS_DIR, processPlan);
      args.push(planPath);
    }

    args.push(...cliArgs);
    args.push(inputFile);
    args.push(`-o=${outputFile}`);

    fastify.log.info({ args: args.filter((a) => !a.includes("lsmessage")) }, "Executing pdfToolbox");

    // Execute pdfToolbox
    const { exitCode, log } = await new Promise((resolve, reject) => {
      const proc = execFile(
        PDFTOOLBOX_BIN,
        args,
        {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 240_000,
          cwd: path.dirname(PDFTOOLBOX_BIN),
        },
        (error, stdout, stderr) => {
          const combined = [stdout, stderr].filter(Boolean).join("\n");

          if (error && error.killed) {
            reject(new Error("pdfToolbox timed out"));
            return;
          }

          resolve({
            exitCode: proc.exitCode ?? (error ? 2 : 0),
            log: combined,
          });
        }
      );
    });

    fastify.log.info({ exitCode }, "pdfToolbox completed");

    if (exitCode >= 100) {
      reply.code(500);
      return { error: `pdfToolbox failed with exit code ${exitCode}`, exitCode, log: log.slice(0, 2000) };
    }

    // Check if output file exists
    try {
      await fs.access(outputFile);
    } catch {
      // Some operations modify in-place or produce output differently
      // Try reading the input file as the output
      try {
        await fs.access(inputFile);
        const resultBuffer = await fs.readFile(inputFile);
        reply
          .header("X-Exit-Code", String(exitCode))
          .header("X-Log", log.slice(0, 1000))
          .type("application/octet-stream")
          .send(resultBuffer);
        return;
      } catch {
        reply.code(500);
        return { error: "No output file produced", exitCode, log: log.slice(0, 2000) };
      }
    }

    const resultBuffer = await fs.readFile(outputFile);

    reply
      .header("X-Exit-Code", String(exitCode))
      .header("X-Log", log.slice(0, 1000))
      .type("application/octet-stream")
      .send(resultBuffer);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

// Start server
const port = parseInt(process.env.PORT || "8080", 10);
try {
  await fastify.listen({ port, host: "0.0.0.0" });
  fastify.log.info(`pdfToolbox service listening on port ${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
