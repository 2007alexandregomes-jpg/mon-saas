import { spawn } from "node:child_process";

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "ProcessError";
  }
}

/**
 * Lance un binaire externe et attend sa sortie.
 *
 * Les arguments sont passés en TABLEAU, jamais concaténés dans une chaîne :
 * aucun shell n'est impliqué, donc une URL contenant `; rm -rf /` reste une
 * simple chaîne de caractères inoffensive.
 */
export function run(
  binary: string,
  args: string[],
  { timeoutMs = 120_000 }: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new ProcessError(`Impossible de lancer ${binary}`, String(error)));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new ProcessError(
            `${binary} a dépassé le délai de ${timeoutMs / 1000} s`,
            stderr,
          ),
        );
        return;
      }
      if (code !== 0) {
        // Les dernières lignes de stderr contiennent la vraie cause. Sans
        // elles, on ne voit qu'un code de sortie qui n'apprend rien.
        const tail = stderr.trim().split("\n").slice(-6).join("\n");
        reject(
          new ProcessError(
            `${binary.split("/").pop()} a échoué (code ${code})\n${tail}`,
            stderr.trim(),
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
