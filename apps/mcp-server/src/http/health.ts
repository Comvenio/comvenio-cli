import type {
  ReadinessDependency,
  ReadinessInspection,
} from "./types.ts";

export const MCP_COLD_START_BUDGET_MS = 10_000;
export const MCP_READINESS_CHECK_TIMEOUT_MS = 1_500;

export class HealthReadinessProbe {
  readonly #dependencies: ReadinessDependency[];
  #draining = false;

  constructor(dependencies: readonly ReadinessDependency[]) {
    const names = dependencies.map((dependency) => dependency.name);
    if (names.some((name) => !/^[a-z][a-z0-9_-]{1,63}$/u.test(name))
      || new Set(names).size !== names.length) {
      throw new Error("Readiness-Abhängigkeiten sind ungültig oder doppelt.");
    }
    this.#dependencies = [...dependencies];
  }

  health(): { status: "ok" } {
    return { status: "ok" };
  }

  setDraining(draining: boolean): void {
    this.#draining = draining;
  }

  async inspect(): Promise<ReadinessInspection> {
    const dependencies = await Promise.all(this.#dependencies.map(async (dependency) => {
      let available = false;
      try {
        available = await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => resolve(false), MCP_READINESS_CHECK_TIMEOUT_MS);
          void dependency.check()
            .then((result) => resolve(result))
            .catch(() => resolve(false))
            .finally(() => clearTimeout(timeout));
        });
      } catch {
        available = false;
      }
      return {
        name: dependency.name,
        required: dependency.required,
        available,
      };
    }));
    return {
      ready: !this.#draining
        && dependencies.every((dependency) => !dependency.required || dependency.available),
      dependencies,
    };
  }

  async readiness(): Promise<{ status: "ready" | "not_ready" }> {
    return { status: (await this.inspect()).ready ? "ready" : "not_ready" };
  }
}
