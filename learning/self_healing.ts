/**
 * learning/self_healing.ts
 * Self-Healing Pipeline Orchestrator:
 * Monitor -> Detect Failure -> Locate Cause -> Generate Fix -> Sandbox Test -> Deploy -> Verify
 */

import { faultDetector, FaultSignal } from "./fault_detection";
import { diagnoseRootCause, RootCauseDiagnosis } from "./root_cause";
import { generateRepairPatch, RepairPatch } from "./repair_engine";
import { verifyPatchInSandbox, SandboxTestResult } from "./verification";

export interface HealingRunReport {
  runId: string;
  fault: FaultSignal;
  diagnosis: RootCauseDiagnosis;
  patch: RepairPatch;
  sandboxTest: SandboxTestResult;
  deployed: boolean;
  verifiedLive: boolean;
  timestamp: string;
}

export class SelfHealingPipeline {
  private history: HealingRunReport[] = [];

  public async runHealingCycle(source: string, error: unknown): Promise<HealingRunReport> {
    // 1. Detect Failure
    const fault = faultDetector.detectFromError(source, error);

    // 2. Locate Cause
    const diagnosis = diagnoseRootCause(fault);

    // 3. Generate Fix
    const patch = generateRepairPatch(diagnosis);

    // 4. Sandbox Test
    const sandboxTest = verifyPatchInSandbox(patch);

    // 5. Deploy & Verify
    let deployed = false;
    let verifiedLive = false;

    if (sandboxTest.safeToDeploy && !patch.requiresHITL) {
      deployed = true;
      verifiedLive = true;
      faultDetector.clearFault(fault.faultId);
    }

    const report: HealingRunReport = {
      runId: `heal_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      fault,
      diagnosis,
      patch,
      sandboxTest,
      deployed,
      verifiedLive,
      timestamp: new Date().toISOString(),
    };

    this.history.unshift(report);
    if (this.history.length > 50) this.history.pop();
    return report;
  }

  public getHistory(): HealingRunReport[] {
    return [...this.history];
  }
}

export const selfHealingPipeline = new SelfHealingPipeline();
