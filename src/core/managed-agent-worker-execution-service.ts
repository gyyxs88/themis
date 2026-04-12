import type { ManagedAgentExecutionOutcome } from "./managed-agent-execution-service.js";
import { ManagedAgentExecutionService } from "./managed-agent-execution-service.js";
import type {
  ManagedAgentWorkerAssignedRun,
  ManagedAgentWorkerService,
  PullManagedAgentAssignedRunInput,
} from "./managed-agent-worker-service.js";

export interface ManagedAgentWorkerExecutionServiceOptions {
  workerService: ManagedAgentWorkerService;
  executionService: ManagedAgentExecutionService;
}

export interface ManagedAgentWorkerExecutionResult {
  assigned: ManagedAgentWorkerAssignedRun;
  execution: ManagedAgentExecutionOutcome;
}

export class ManagedAgentWorkerExecutionService {
  private readonly workerService: ManagedAgentWorkerService;
  private readonly executionService: ManagedAgentExecutionService;

  constructor(options: ManagedAgentWorkerExecutionServiceOptions) {
    this.workerService = options.workerService;
    this.executionService = options.executionService;
  }

  async runNextAssigned(input: PullManagedAgentAssignedRunInput): Promise<ManagedAgentWorkerExecutionResult | null> {
    const assigned = this.workerService.pullAssignedRun(input);

    if (!assigned) {
      return null;
    }

    const execution = await this.executionService.executeClaim(assigned, {
      ...(input.now ? { now: input.now } : {}),
    });

    return {
      assigned,
      execution,
    };
  }
}
