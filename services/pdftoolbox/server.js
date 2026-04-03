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
    // Parse multipart form — supports multiple file parts
    let fileBuffer = null;
    let processPlanBuffer = null;
    const fields = {};

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const chunks = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        const buf = Buffer.concat(chunks);

        if (part.fieldname === "processPlanFile") {
          processPlanBuffer = buf;
        } else {
          fileBuffer = buf;
        }
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    if (!fileBuffer) {
      reply.code(400);
      return { error: "No file uploaded" };
    }

    const cliArgs = fields.args ? JSON.parse(fields.args) : [];
    const processPlan = fields.processPlan || null;
    const outputExtension = fields.outputExtension || "pdf";

    // Write input file
    const inputFile = path.join(tmpDir, `input.pdf`);
    const outputFile = path.join(tmpDir, `output.${outputExtension}`);
    await fs.writeFile(inputFile, fileBuffer);

    // Build CLI arguments
    // Syntax: pdfToolbox [options] <profile> <input files>
    const args = [];

    // Options first
    args.push(...cliArgs);
    args.push(`-o=${outputFile}`);

    // Add license server flags as options (before profile)
    if (LICENSE_MESSAGE) {
      args.push(`--licenseserver=${LICENSE_SERVER}`);
      args.push(`--lsmessage=${LICENSE_MESSAGE}`);
    }

    // Profile (process plan) - required positional arg
    if (processPlanBuffer) {
      // Inline process plan file uploaded in the request
      const inlinePlanPath = path.join(tmpDir, "plan.kfpx");
      await fs.writeFile(inlinePlanPath, processPlanBuffer);
      args.push(inlinePlanPath);
    } else if (processPlan) {
      // Filename lookup from baked-in process plans directory
      const planPath = path.join(PROCESS_PLANS_DIR, processPlan);
      args.push(planPath);
    }

    // Input file - required positional arg
    args.push(inputFile);

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

    // Find the output file — pdfToolbox may not use our exact -o path
    let resultFile = null;

    // First check the exact output path we specified
    try {
      await fs.access(outputFile);
      resultFile = outputFile;
    } catch {
      // Scan tmpDir for any new files that aren't the input
      const allFiles = await fs.readdir(tmpDir, { recursive: true });
      fastify.log.info({ allFiles }, "Files in tmpDir after pdfToolbox");

      // Find files matching the output extension, or any non-input file
      const candidates = allFiles
        .map(f => typeof f === 'string' ? f : f.toString())
        .filter(f => f !== "input.pdf")
        .map(f => path.join(tmpDir, f));

      // Prefer files with the right extension
      const extMatch = candidates.find(f => f.endsWith(`.${outputExtension}`));
      resultFile = extMatch || candidates[0] || null;
    }

    if (!resultFile) {
      reply.code(500);
      return { error: "No output file produced", exitCode, log: log.slice(0, 2000) };
    }

    fastify.log.info({ resultFile }, "Returning output file");
    const resultBuffer = await fs.readFile(resultFile);

    reply
      .header("X-Exit-Code", String(exitCode))
      .header("X-Log", encodeURIComponent(log.slice(0, 1000)))
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
