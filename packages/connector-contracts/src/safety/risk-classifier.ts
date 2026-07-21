import type { ActionRisk, SafetyCatalogOperation } from "./types.ts";

const rank: Record<ActionRisk, number> = { read: 0, reversible_write: 1, critical_write: 2 };
export class ActionRiskClassifier {
  classify(operation: Pick<SafetyCatalogOperation, "risk_class">): ActionRisk { if (!(operation.risk_class in rank)) throw new Error("Die Katalog-Risikoklasse ist ungültig."); return operation.risk_class; }
  aggregate(operations: readonly Pick<SafetyCatalogOperation, "risk_class">[]): ActionRisk { if (operations.length === 0) throw new Error("Mindestens eine Katalogoperation ist erforderlich."); return operations.map((operation) => this.classify(operation)).reduce((highest, current) => rank[current] > rank[highest] ? current : highest); }
  requiresConfirmation(operation: Pick<SafetyCatalogOperation, "risk_class">): boolean { return this.classify(operation) === "critical_write"; }
}
